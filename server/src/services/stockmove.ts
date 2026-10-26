import type { Request } from 'express';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { HttpError } from '../util.js';

export type Cx = Parameters<Parameters<typeof tx>[0]>[0];

export interface Mv {
  productId: string; type: 'entrada' | 'saida' | 'ajuste'; quantity: number; date: string; reason: string;
  unitCost?: number | null; docNumber?: string | null; supplierId?: number | null; destination?: string | null; notes?: string | null;
  key: string | null; newQuantity?: number;
  /** Produtos controlados por lote: entrada informa batchCode (e a validade); saída pode escolher batchId (senão sai primeiro o que vence antes); ajuste exige batchId. */
  batchCode?: string | null; expiresAt?: string | null; batchId?: number | null;
}
export interface MvResult { id: number; balanceBefore: number; balanceAfter: number; batches: { batchId: number; code: string; delta: number }[] }

export const allowNegative = async (c: { query: typeof pool.query }) =>
  (await c.query(`SELECT value FROM settings WHERE key='allow_negative_stock'`)).rows[0]?.value === true;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Aplica uma movimentação sob lock da linha do produto; saldo, lotes e histórico mudam juntos (mesma transação).
 * É a única porta de escrita do saldo: telas, inventário e recebimento de compras passam por aqui.
 */
export async function applyMovement(c: Cx, req: Request, m: Mv): Promise<MvResult> {
  const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [m.productId])).rows[0];
  if (!p) throw new HttpError(404, 'Produto não encontrado');
  if (!p.active) throw new HttpError(409, 'Produto inativo não pode ser movimentado.');
  const before = Number(p.quantity);
  const tracked = !!p.tracks_batches;
  const alloc: { batchId: number; code: string; delta: number }[] = [];
  let delta: number;

  if (m.type === 'entrada') {
    delta = m.quantity;
    if (tracked) {
      const code = (m.batchCode ?? '').trim();
      if (!code) throw new HttpError(422, 'Informe o lote desta entrada.', { batchCode: 'Informe o lote' });
      let b = (await c.query('SELECT * FROM stock_batches WHERE product_id=$1 AND code=$2 FOR UPDATE', [p.id, code])).rows[0];
      if (b && m.expiresAt && b.expires_at && String(b.expires_at).slice(0, 10) !== m.expiresAt) throw new HttpError(422, `O lote ${code} já existe com outra validade.`, { expiresAt: 'Diferente da validade já cadastrada para este lote' });
      if (!b) b = (await c.query('INSERT INTO stock_batches (product_id, code, expires_at, quantity) VALUES ($1,$2,$3,0) RETURNING *', [p.id, code, m.expiresAt ?? null])).rows[0];
      else if (m.expiresAt && !b.expires_at) await c.query('UPDATE stock_batches SET expires_at=$2 WHERE id=$1', [b.id, m.expiresAt]);
      await c.query('UPDATE stock_batches SET quantity = quantity + $2 WHERE id=$1', [b.id, delta]);
      alloc.push({ batchId: Number(b.id), code, delta });
    }
  } else if (m.type === 'saida') {
    delta = -m.quantity;
    if (tracked) {
      const rows = m.batchId
        ? (await c.query('SELECT * FROM stock_batches WHERE id=$1 AND product_id=$2 FOR UPDATE', [m.batchId, p.id])).rows
        : (await c.query('SELECT * FROM stock_batches WHERE product_id=$1 AND quantity > 0 ORDER BY expires_at NULLS LAST, id FOR UPDATE', [p.id])).rows;
      if (m.batchId && !rows.length) throw new HttpError(422, 'Lote inválido para este produto.', { batchId: 'Lote inválido' });
      let left = m.quantity;
      for (const b of rows) {
        if (left <= 0) break;
        const take = r3(Math.min(left, Number(b.quantity)));
        if (take <= 0) continue;
        await c.query('UPDATE stock_batches SET quantity = quantity - $2 WHERE id=$1', [b.id, take]);
        alloc.push({ batchId: Number(b.id), code: b.code, delta: -take });
        left = r3(left - take);
      }
      if (left > 0) {
        const have = r3(rows.reduce((s: number, b: { quantity: string }) => s + Number(b.quantity), 0));
        throw new HttpError(409, `Saldo insuficiente nos lotes: disponível ${have}, solicitado ${m.quantity}.`, { quantity: `Saldo insuficiente nos lotes (disponível: ${have})` });
      }
    }
  } else {
    if (tracked) {
      if (!m.batchId) throw new HttpError(422, 'Informe o lote que será ajustado.', { batchId: 'Selecione o lote' });
      const b = (await c.query('SELECT * FROM stock_batches WHERE id=$1 AND product_id=$2 FOR UPDATE', [m.batchId, p.id])).rows[0];
      if (!b) throw new HttpError(422, 'Lote inválido para este produto.', { batchId: 'Lote inválido' });
      delta = r3(m.newQuantity! - Number(b.quantity));
      if (delta !== 0) { await c.query('UPDATE stock_batches SET quantity = quantity + $2 WHERE id=$1', [b.id, delta]); alloc.push({ batchId: Number(b.id), code: b.code, delta }); }
    } else delta = r3(m.newQuantity! - before);
  }

  if (m.type === 'ajuste' && delta === 0) throw new HttpError(422, 'A quantidade informada é igual ao saldo atual.', { newQuantity: 'Igual ao saldo atual' });
  const after = r3(before + delta);
  if (after < 0 && !(await allowNegative(c))) {
    throw new HttpError(409, `Saldo insuficiente: disponível ${before}, solicitado ${m.quantity}.`, { quantity: `Saldo insuficiente (disponível: ${before})` });
  }
  let newCost = Number(p.cost);
  if (m.type === 'entrada' && m.unitCost != null) {
    newCost = before > 0 ? (before * Number(p.cost) + m.quantity * m.unitCost) / (before + m.quantity) : m.unitCost;
    newCost = Math.round(newCost * 10000) / 10000;
  }
  await c.query('UPDATE products SET quantity=$2, cost=$3, updated_at=now() WHERE id=$1', [p.id, after, newCost]);
  const mv = (await c.query(
    `INSERT INTO stock_movements (product_id,type,quantity,delta,balance_before,balance_after,unit_cost,reason,doc_number,supplier_id,destination,notes,movement_date,user_id,user_name,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [p.id, m.type, Math.abs(delta), delta, before, after, m.type === 'entrada' ? (m.unitCost ?? null) : Number(p.cost), m.reason, m.docNumber ?? null, m.supplierId ?? null, m.destination ?? null, m.notes ?? null,
     m.date, req.user!.id, req.user!.name, m.key])).rows[0];
  for (const a of alloc) await c.query('INSERT INTO stock_movement_batches (movement_id, batch_id, delta) VALUES ($1,$2,$3)', [mv.id, a.batchId, a.delta]);
  await audit(req, {
    action: m.type, module: 'estoque', entity: 'movement', entityId: mv.id,
    summary: `${m.type === 'entrada' ? 'Entrada' : m.type === 'saida' ? 'Saída' : 'Ajuste'} de estoque: ${p.code} ${p.name} (${delta > 0 ? '+' : ''}${delta}) — ${m.reason}`,
    details: { saldoAnterior: before, saldoPosterior: after, ...(alloc.length ? { lotes: alloc.map((a) => `${a.code}: ${a.delta > 0 ? '+' : ''}${a.delta}`) } : {}) },
  }, c);
  return { id: mv.id as number, balanceBefore: before, balanceAfter: after, batches: alloc };
}
