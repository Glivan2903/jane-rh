import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { BATCH_STATUS } from '../services/batches.js';
import { TODAY_SQL } from '../services/finance.js';
import { applyMovement } from '../services/stockmove.js';
import { HttpError, Where, h, likeEsc, listParams, optDate, optInt, optStr, parse, qstr, qty, reqDate, reqInt, reqStr, sendReport, today } from '../util.js';

/** Fase 4 do estoque: lotes e validade, leitura de código de barras, inventário e pedidos de compra. */
export const estxRouter = Router();

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------------ código de barras ------------------------------------------------------------ */
// Leitor USB funciona como teclado: a tela envia o código lido e recebe o produto (por código de barras ou código interno).
estxRouter.get('/products/lookup', requireAuth('est.view'), h(async (req, res) => {
  const code = qstr(req, 'code');
  if (!code) throw new HttpError(422, 'Informe o código.');
  const r = (await pool.query(
    `SELECT p.id, p.code, p.name, p.barcode, p.quantity, p.active, p.tracks_batches AS "tracksBatches", u.code AS unit
       FROM products p JOIN units_of_measure u ON u.id = p.unit_id WHERE lower(p.barcode) = lower($1) OR lower(p.code) = lower($1) ORDER BY p.active DESC LIMIT 1`, [code])).rows[0];
  if (!r) throw new HttpError(404, 'Nenhum produto com este código.');
  res.json(r);
}));

/* ---------------------------------------------------------------- lotes ---------------------------------------------------------------- */
const B_COLS = `b.id, b.code, b.expires_at::text AS "expiresAt", b.quantity, b.product_id AS "productId", p.code AS "productCode", p.name AS product, u.code AS unit, ${BATCH_STATUS} AS status,
  CASE WHEN b.expires_at IS NULL THEN NULL ELSE (b.expires_at - ${TODAY_SQL})::int END AS "daysLeft"`;
const B_FROM = `FROM stock_batches b JOIN products p ON p.id = b.product_id JOIN units_of_measure u ON u.id = p.unit_id`;

estxRouter.get('/products/:id/batches', requireAuth('est.view'), h(async (req, res) => {
  const all = req.query.all === 'true';
  res.json((await pool.query(`SELECT ${B_COLS} ${B_FROM} WHERE b.product_id = $1 ${all ? '' : 'AND b.quantity > 0'} ORDER BY b.expires_at NULLS LAST, b.id`, [req.params.id])).rows);
}));

estxRouter.get('/batches/summary', requireAuth('est.view'), h(async (_req, res) => {
  res.json((await pool.query(
    `SELECT count(*) FILTER (WHERE s = 'vencido')::int AS vencidos, count(*) FILTER (WHERE s = 'a_vencer')::int AS "aVencer", count(*)::int AS total
       FROM (SELECT ${BATCH_STATUS} AS s ${B_FROM} WHERE b.quantity > 0 AND p.active) x`)).rows[0]);
}));

estxRouter.get('/batches', requireAuth('est.view'), h(async (req, res) => {
  const p = listParams(req, { expiresAt: 'b.expires_at', product: 'lower(p.name)', quantity: 'b.quantity', code: 'lower(b.code)' }, 'expiresAt');
  const w = new Where().add('b.quantity > 0').add('p.active');
  const st = qstr(req, 'status') ?? 'atencao';
  if (st === 'atencao') w.add(`${BATCH_STATUS} IN ('vencido','a_vencer')`); else if (st !== 'todos') w.add(`${BATCH_STATUS} = ?`, st);
  const pr = qstr(req, 'productId'); if (pr) w.add('b.product_id = ?', pr);
  if (p.q) w.add('(p.name ILIKE ? OR p.code ILIKE ? OR b.code ILIKE ?)', likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const total = (await pool.query(`SELECT count(*)::int n ${B_FROM} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${B_COLS} ${B_FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir} NULLS LAST, b.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

/* -------------------------------------------------------------- inventário -------------------------------------------------------------- */
const COUNT_PERM = 'est.adjust';
const CUR = `(CASE WHEN i.batch_id IS NULL THEN p.quantity ELSE b.quantity END)`;
const ITEM_FROM = `FROM stock_count_items i JOIN products p ON p.id = i.product_id LEFT JOIN stock_batches b ON b.id = i.batch_id JOIN units_of_measure u ON u.id = p.unit_id`;

estxRouter.get('/counts', requireAuth('est.view'), h(async (_req, res) => {
  res.json((await pool.query(
    `SELECT c.id, c.title, c.status, c.notes, pc.name AS category, c.created_by_name AS "createdBy", c.created_at AS "createdAt", c.finalized_at AS "finalizedAt",
            (SELECT count(*)::int FROM stock_count_items i WHERE i.count_id = c.id) AS items,
            (SELECT count(*)::int FROM stock_count_items i WHERE i.count_id = c.id AND i.counted_qty IS NOT NULL) AS counted
       FROM stock_counts c LEFT JOIN product_categories pc ON pc.id = c.category_id ORDER BY c.id DESC LIMIT 100`)).rows);
}));

estxRouter.post('/counts', requireAuth(COUNT_PERM), h(async (req, res) => {
  const d = parse(z.object({ title: reqStr(120, 'Informe o nome da contagem'), categoryId: optInt, notes: optStr(500) }), req.body);
  const id = await tx(async (c) => {
    if (d.categoryId && !(await c.query('SELECT 1 FROM product_categories WHERE id=$1', [d.categoryId])).rowCount) throw new HttpError(422, 'Categoria inválida', { categoryId: 'Categoria inválida' });
    const id = (await c.query('INSERT INTO stock_counts (title, category_id, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5) RETURNING id', [d.title, d.categoryId ?? null, d.notes ?? null, req.user!.id, req.user!.name])).rows[0].id as number;
    const cat = d.categoryId ? 'AND p.category_id = $2' : ''; const params: unknown[] = d.categoryId ? [id, d.categoryId] : [id];
    // foto do saldo agora: produtos comuns por produto; produtos com lote, um item por lote com saldo
    await c.query(`INSERT INTO stock_count_items (count_id, product_id, batch_id, system_qty) SELECT $1, p.id, NULL, p.quantity FROM products p WHERE p.active AND NOT p.tracks_batches ${cat}`, params);
    await c.query(`INSERT INTO stock_count_items (count_id, product_id, batch_id, system_qty) SELECT $1, p.id, b.id, b.quantity FROM products p JOIN stock_batches b ON b.product_id = p.id WHERE p.active AND p.tracks_batches AND b.quantity > 0 ${cat}`, params);
    const n = (await c.query('SELECT count(*)::int n FROM stock_count_items WHERE count_id=$1', [id])).rows[0].n;
    if (!n) throw new HttpError(422, 'Nenhum produto ativo para contar neste filtro.', { categoryId: 'Sem produtos' });
    await audit(req, { action: 'criar', module: 'estoque', entity: 'stock_count', entityId: id, summary: `Inventário aberto: ${d.title} (${n} item(ns))` }, c);
    return id;
  });
  res.status(201).json({ id });
}));

estxRouter.get('/counts/:id', requireAuth('est.view'), h(async (req, res) => {
  const c = (await pool.query(
    `SELECT c.id, c.title, c.status, c.notes, c.category_id AS "categoryId", pc.name AS category, c.created_by_name AS "createdBy", c.created_at AS "createdAt", c.finalized_at AS "finalizedAt", c.finalized_by_name AS "finalizedBy"
       FROM stock_counts c LEFT JOIN product_categories pc ON pc.id = c.category_id WHERE c.id = $1`, [req.params.id])).rows[0];
  if (!c) throw new HttpError(404, 'Inventário não encontrado');
  const stats = (await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE i.counted_qty IS NOT NULL)::int AS counted,
            count(*) FILTER (WHERE i.counted_qty IS NOT NULL AND i.counted_qty <> ${CUR})::int AS divergent,
            count(*) FILTER (WHERE i.counted_qty IS NOT NULL AND i.system_qty <> ${CUR})::int AS "movedSince"
       ${ITEM_FROM} WHERE i.count_id = $1`, [c.id])).rows[0];
  const p = listParams(req, { name: 'lower(p.name)', code: 'p.code' }, 'name');
  const w = new Where().add('i.count_id = ?', c.id);
  const only = qstr(req, 'only');
  if (only === 'pendentes') w.add('i.counted_qty IS NULL'); else if (only === 'contados') w.add('i.counted_qty IS NOT NULL'); else if (only === 'divergentes') w.add(`i.counted_qty IS NOT NULL AND i.counted_qty <> ${CUR}`);
  if (p.q) w.add('(p.name ILIKE ? OR p.code ILIKE ? OR p.barcode ILIKE ? OR b.code ILIKE ?)', likeEsc(p.q), likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const total = (await pool.query(`SELECT count(*)::int n ${ITEM_FROM} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT i.id, p.id AS "productId", p.code, p.name, p.barcode, u.code AS unit, i.batch_id AS "batchId", b.code AS "batchCode", b.expires_at::text AS "expiresAt",
            i.system_qty AS "systemQty", i.counted_qty AS "countedQty", ${CUR} AS "currentQty", i.note, i.counted_at AS "countedAt", i.counted_by_name AS "countedBy", i.applied_delta AS "appliedDelta"
       ${ITEM_FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir}, b.code NULLS FIRST, i.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ ...c, stats, rows, total, page: p.page, pageSize: p.pageSize });
}));

estxRouter.put('/counts/:id/items', requireAuth(COUNT_PERM), h(async (req, res) => {
  const d = parse(z.object({ items: z.array(z.object({ id: reqInt, countedQty: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0, 'Não pode ser negativa').max(999999999).nullable()), note: optStr(200) })).min(1).max(500) }), req.body);
  await tx(async (c) => {
    const cnt = (await c.query('SELECT id, status FROM stock_counts WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cnt) throw new HttpError(404, 'Inventário não encontrado');
    if (cnt.status !== 'aberto') throw new HttpError(409, 'Este inventário já foi encerrado.');
    for (const it of d.items) {
      const q = it.countedQty == null ? null : r3(it.countedQty);
      const r = await c.query(
        `UPDATE stock_count_items SET counted_qty=$3, note=$4, counted_by_name = CASE WHEN $3::numeric IS NULL THEN NULL ELSE $5 END, counted_at = CASE WHEN $3::numeric IS NULL THEN NULL ELSE now() END WHERE id=$1 AND count_id=$2`,
        [it.id, cnt.id, q, it.note ?? null, req.user!.name]);
      if (!r.rowCount) throw new HttpError(422, 'Item não pertence a este inventário.');
    }
  });
  res.json({ ok: true });
}));

estxRouter.post('/counts/:id/finalize', requireAuth(COUNT_PERM), h(async (req, res) => {
  const out = await tx(async (c) => {
    const cnt = (await c.query('SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cnt) throw new HttpError(404, 'Inventário não encontrado');
    if (cnt.status !== 'aberto') throw new HttpError(409, 'Este inventário já foi encerrado.');
    const items = (await c.query(
      `SELECT i.*, p.active, p.tracks_batches, p.code, p.name FROM stock_count_items i JOIN products p ON p.id = i.product_id WHERE i.count_id = $1 AND i.counted_qty IS NOT NULL ORDER BY p.name, i.batch_id NULLS FIRST, i.id`, [cnt.id])).rows;
    if (!items.length) throw new HttpError(422, 'Nenhum item foi contado.');
    const sum = { adjusted: 0, unchanged: 0, skipped: 0, entries: 0, exits: 0, totalDelta: 0 };
    for (const it of items) {
      // produto inativado ou que mudou o controle por lote desde a abertura: não mexe no saldo
      if (!it.active || (it.batch_id == null) === !!it.tracks_batches) { sum.skipped++; continue; }
      const cur = it.batch_id == null
        ? Number((await c.query('SELECT quantity FROM products WHERE id=$1 FOR UPDATE', [it.product_id])).rows[0].quantity)
        : Number((await c.query('SELECT quantity FROM stock_batches WHERE id=$1 FOR UPDATE', [it.batch_id])).rows[0].quantity);
      const counted = Number(it.counted_qty);
      if (r3(counted - cur) === 0) { await c.query('UPDATE stock_count_items SET applied_delta=0 WHERE id=$1', [it.id]); sum.unchanged++; continue; }
      const mv = await applyMovement(c, req, { productId: it.product_id, type: 'ajuste', quantity: 0, newQuantity: counted, batchId: it.batch_id, date: today(), reason: `Inventário #${cnt.id}: ${cnt.title}`.slice(0, 300), notes: it.note, key: null });
      const delta = r3(mv.balanceAfter - mv.balanceBefore);
      await c.query('UPDATE stock_count_items SET applied_delta=$2, movement_id=$3 WHERE id=$1', [it.id, delta, mv.id]);
      sum.adjusted++; sum.totalDelta = r3(sum.totalDelta + delta); if (delta > 0) sum.entries++; else sum.exits++;
    }
    await c.query(`UPDATE stock_counts SET status='finalizado', finalized_at=now(), finalized_by_name=$2 WHERE id=$1`, [cnt.id, req.user!.name]);
    await audit(req, { action: 'finalizar', module: 'estoque', entity: 'stock_count', entityId: cnt.id, summary: `Inventário finalizado: ${cnt.title} — ${sum.adjusted} ajuste(s), ${sum.unchanged} sem diferença`, details: sum }, c);
    return sum;
  });
  res.json(out);
}));

estxRouter.post('/counts/:id/cancel', requireAuth(COUNT_PERM), h(async (req, res) => {
  await tx(async (c) => {
    const cnt = (await c.query('SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cnt) throw new HttpError(404, 'Inventário não encontrado');
    if (cnt.status !== 'aberto') throw new HttpError(409, 'Este inventário já foi encerrado.');
    await c.query(`UPDATE stock_counts SET status='cancelado', finalized_at=now(), finalized_by_name=$2 WHERE id=$1`, [cnt.id, req.user!.name]);
    await audit(req, { action: 'cancelar', module: 'estoque', entity: 'stock_count', entityId: cnt.id, summary: `Inventário cancelado: ${cnt.title}` }, c);
  });
  res.json({ ok: true });
}));

estxRouter.get('/counts/:id/report', requireAuth('est.view'), h(async (req, res) => {
  if (req.query.format === 'csv') {
    if (!hasPerm(req, 'est.export')) throw new HttpError(403, 'Sem permissão para exportar.');
    await audit(req, { action: 'exportar', module: 'estoque', entity: 'report', summary: `Relatório de inventário exportado (CSV): #${req.params.id}` });
  }
  const c = (await pool.query('SELECT id, title, status FROM stock_counts WHERE id=$1', [req.params.id])).rows[0];
  if (!c) throw new HttpError(404, 'Inventário não encontrado');
  const rows = (await pool.query(
    `SELECT p.code, p.name, b.code AS batch, i.system_qty, i.counted_qty, ${CUR} AS cur, i.applied_delta, i.note ${ITEM_FROM} WHERE i.count_id = $1 AND i.counted_qty IS NOT NULL ORDER BY p.name, b.code NULLS FIRST`, [c.id])).rows;
  const num = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fin = c.status === 'finalizado';
  sendReport(req, res, `inventario-${c.id}`,
    [{ key: 'code', label: 'Código' }, { key: 'name', label: 'Produto' }, { key: 'batch', label: 'Lote' }, { key: 'sys', label: 'Saldo na abertura' }, { key: 'counted', label: 'Contado' },
     { key: 'diff', label: fin ? 'Diferença ajustada' : 'Diferença atual' }, { key: 'note', label: 'Observação' }],
    rows.map((r) => ({ code: r.code, name: r.name, batch: r.batch ?? '', sys: num(r.system_qty), counted: num(r.counted_qty), diff: num(fin ? r.applied_delta : Number(r.counted_qty) - Number(r.cur)), note: r.note ?? '' })),
    { title: `Inventário #${c.id}: ${c.title}`, note: fin ? 'Diferenças já aplicadas ao estoque como ajustes.' : 'Inventário em aberto: as diferenças só entram no estoque ao finalizar.' });
}));

/* -------------------------------------------------------- pedidos de compra -------------------------------------------------------- */
const orderItems = z.array(z.object({ productId: z.string({ required_error: 'Selecione o produto' }).uuid('Selecione o produto'), quantity: qty,
  unitCost: z.coerce.number({ invalid_type_error: 'Custo inválido' }).min(0, 'Custo não pode ser negativo').max(999999999) })).min(1, 'Inclua ao menos um produto').max(200);
const orderSchema = z.object({ partyId: reqInt, orderDate: reqDate, expectedDate: optDate, notes: optStr(1000), items: orderItems });

async function checkOrder(c: { query: typeof pool.query }, d: z.infer<typeof orderSchema>) {
  const party = (await c.query('SELECT id, name, active, is_supplier FROM parties WHERE id=$1', [d.partyId])).rows[0];
  if (!party || !party.is_supplier || !party.active) throw new HttpError(422, 'Fornecedor inválido ou inativo', { partyId: 'Selecione um fornecedor ativo' });
  const ids = d.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw new HttpError(422, 'Há produtos repetidos no pedido', { items: 'Cada produto deve aparecer uma vez' });
  const ok = (await c.query('SELECT id FROM products WHERE id = ANY($1) AND active', [ids])).rowCount;
  if (ok !== ids.length) throw new HttpError(422, 'Há produto inválido ou inativo no pedido', { items: 'Produto inválido ou inativo' });
  if (d.expectedDate && d.expectedDate < d.orderDate) throw new HttpError(422, 'A previsão não pode ser anterior ao pedido', { expectedDate: 'Anterior à data do pedido' });
  return party;
}

const O_COLS = `o.id, o.number, o.status, o.party_id AS "partyId", pa.name AS supplier, o.order_date::text AS "orderDate", o.expected_date::text AS "expectedDate", o.notes, o.created_by_name AS "createdBy", o.created_at AS "createdAt",
  (SELECT COALESCE(sum(i.quantity * i.unit_cost),0) FROM purchase_order_items i WHERE i.order_id = o.id) AS total,
  (SELECT count(*)::int FROM purchase_order_items i WHERE i.order_id = o.id) AS "itemsCount",
  (SELECT COALESCE(sum(LEAST(i.received_qty, i.quantity)) / NULLIF(sum(i.quantity),0), 0) FROM purchase_order_items i WHERE i.order_id = o.id) AS "receivedRatio"`;

estxRouter.get('/orders', requireAuth('est.view'), h(async (req, res) => {
  const p = listParams(req, { id: 'o.id', date: 'o.order_date', supplier: 'lower(pa.name)', status: 'o.status' }, 'id', 'DESC');
  const w = new Where();
  const st = qstr(req, 'status'); if (st === 'abertos') w.add(`o.status IN ('rascunho','enviado','parcial')`); else if (st && st !== 'todos') w.add('o.status = ?', st);
  const party = qstr(req, 'partyId'); if (party) w.add('o.party_id = ?', Number(party));
  if (p.q) w.add('(o.number ILIKE ? OR pa.name ILIKE ?)', likeEsc(p.q), likeEsc(p.q));
  const from = 'FROM purchase_orders o JOIN parties pa ON pa.id = o.party_id';
  const total = (await pool.query(`SELECT count(*)::int n ${from} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${O_COLS} ${from} ${w.sql} ORDER BY ${p.sort} ${p.dir}, o.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

estxRouter.get('/orders/:id', requireAuth('est.view'), h(async (req, res) => {
  const o = (await pool.query(`SELECT ${O_COLS} FROM purchase_orders o JOIN parties pa ON pa.id = o.party_id WHERE o.id = $1`, [req.params.id])).rows[0];
  if (!o) throw new HttpError(404, 'Pedido não encontrado');
  const items = (await pool.query(
    `SELECT i.id, i.product_id AS "productId", p.code, p.name, u.code AS unit, p.tracks_batches AS "tracksBatches", i.quantity, i.unit_cost AS "unitCost", i.received_qty AS "receivedQty", (i.quantity - i.received_qty) AS remaining
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id JOIN units_of_measure u ON u.id = p.unit_id WHERE i.order_id = $1 ORDER BY p.name`, [o.id])).rows;
  const receipts = (await pool.query(
    `SELECT r.id, r.received_at::text AS "receivedAt", r.doc_number AS "docNumber", r.total, r.transaction_id AS "transactionId", r.created_by_name AS "createdBy",
            (SELECT json_agg(json_build_object('name', p.name, 'quantity', ri.quantity, 'unitCost', ri.unit_cost, 'batchCode', ri.batch_code) ORDER BY p.name)
               FROM purchase_receipt_items ri JOIN purchase_order_items i ON i.id = ri.item_id JOIN products p ON p.id = i.product_id WHERE ri.receipt_id = r.id) AS items
       FROM purchase_receipts r WHERE r.order_id = $1 ORDER BY r.id DESC`, [o.id])).rows;
  res.json({ ...o, items, receipts });
}));

estxRouter.post('/orders', requireAuth('est.create'), h(async (req, res) => {
  const d = parse(orderSchema, req.body);
  const id = await tx(async (c) => {
    const party = await checkOrder(c, d);
    const id = (await c.query(`INSERT INTO purchase_orders (party_id, order_date, expected_date, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [d.partyId, d.orderDate, d.expectedDate ?? null, d.notes ?? null, req.user!.id, req.user!.name])).rows[0].id as number;
    await c.query('UPDATE purchase_orders SET number = $2 WHERE id = $1', [id, `PC-${String(id).padStart(5, '0')}`]);
    for (const i of d.items) await c.query('INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)', [id, i.productId, i.quantity, i.unitCost]);
    await audit(req, { action: 'criar', module: 'estoque', entity: 'purchase_order', entityId: id, summary: `Pedido de compra criado: PC-${String(id).padStart(5, '0')} — ${party.name}` }, c);
    return id;
  });
  res.status(201).json({ id });
}));

estxRouter.put('/orders/:id', requireAuth('est.edit'), h(async (req, res) => {
  const d = parse(orderSchema, req.body);
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Pedido não encontrado');
    if (o.status !== 'rascunho') throw new HttpError(409, 'Só é possível editar pedidos em rascunho.');
    await checkOrder(c, d);
    await c.query('UPDATE purchase_orders SET party_id=$2, order_date=$3, expected_date=$4, notes=$5, updated_at=now() WHERE id=$1', [o.id, d.partyId, d.orderDate, d.expectedDate ?? null, d.notes ?? null]);
    await c.query('DELETE FROM purchase_order_items WHERE order_id=$1', [o.id]);
    for (const i of d.items) await c.query('INSERT INTO purchase_order_items (order_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)', [o.id, i.productId, i.quantity, i.unitCost]);
    await audit(req, { action: 'editar', module: 'estoque', entity: 'purchase_order', entityId: o.id, summary: `Pedido de compra editado: ${o.number}` }, c);
  });
  res.json({ ok: true });
}));

async function transition(req: import('express').Request, res: import('express').Response, from: string[], to: string, action: string, label: string) {
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Pedido não encontrado');
    if (!from.includes(o.status)) throw new HttpError(409, `O pedido está ${o.status} e não pode ser ${label}.`);
    if (to === 'enviado' && !(await c.query('SELECT 1 FROM purchase_order_items WHERE order_id=$1', [o.id])).rowCount) throw new HttpError(422, 'O pedido não tem itens.');
    if (to === 'cancelado' && (await c.query('SELECT 1 FROM purchase_receipts WHERE order_id=$1', [o.id])).rowCount) throw new HttpError(409, 'Pedido com recebimento não pode ser cancelado: use "Encerrar".');
    await c.query('UPDATE purchase_orders SET status=$2, updated_at=now() WHERE id=$1', [o.id, to]);
    await audit(req, { action, module: 'estoque', entity: 'purchase_order', entityId: o.id, summary: `Pedido de compra ${label}: ${o.number}` }, c);
  });
  res.json({ ok: true });
}
estxRouter.post('/orders/:id/send', requireAuth('est.edit'), h((req, res) => transition(req, res, ['rascunho'], 'enviado', 'enviar', 'enviado')));
estxRouter.post('/orders/:id/cancel', requireAuth('est.edit'), h((req, res) => transition(req, res, ['rascunho', 'enviado'], 'cancelado', 'cancelar', 'cancelado')));
estxRouter.post('/orders/:id/close', requireAuth('est.edit'), h((req, res) => transition(req, res, ['parcial'], 'encerrado', 'encerrar', 'encerrado (parte não recebida)')));

estxRouter.delete('/orders/:id', requireAuth('est.edit'), h(async (req, res) => {
  await tx(async (c) => {
    const o = (await c.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Pedido não encontrado');
    if (o.status !== 'rascunho') throw new HttpError(409, 'Só é possível excluir pedidos em rascunho.');
    await c.query('DELETE FROM purchase_orders WHERE id=$1', [o.id]);
    await audit(req, { action: 'excluir', module: 'estoque', entity: 'purchase_order', entityId: o.id, summary: `Pedido de compra excluído: ${o.number}` }, c);
  });
  res.json({ ok: true });
}));

const receiveSchema = z.object({
  receivedAt: reqDate.refine((d) => d <= today(), 'Data não pode ser futura'),
  docNumber: optStr(60),
  items: z.array(z.object({ itemId: reqInt, quantity: qty, batchCode: optStr(60), expiresAt: optDate })).min(1, 'Informe ao menos um item recebido').max(200),
  payable: z.object({ create: z.boolean().default(false), dueDate: optDate, categoryId: optInt, accountId: optInt, costCenterId: optInt }).optional(),
});

estxRouter.post('/orders/:id/receive', requireAuth('est.move'), h(async (req, res) => {
  const d = parse(receiveSchema, req.body);
  const pay = d.payable?.create ? d.payable : null;
  if (pay) {
    if (!hasPerm(req, 'fin.create')) throw new HttpError(403, 'Sem permissão para gerar a conta a pagar.');
    if (!pay.dueDate) throw new HttpError(422, 'Informe o vencimento da conta a pagar.', { dueDate: 'Informe o vencimento' });
    if (!pay.categoryId) throw new HttpError(422, 'Selecione a categoria da despesa.', { categoryId: 'Selecione a categoria' });
  }
  const out = await tx(async (c) => {
    const o = (await c.query(`SELECT o.*, pa.name AS supplier, pa.legacy_supplier_id FROM purchase_orders o JOIN parties pa ON pa.id = o.party_id WHERE o.id=$1 FOR UPDATE OF o`, [req.params.id])).rows[0];
    if (!o) throw new HttpError(404, 'Pedido não encontrado');
    if (!['enviado', 'parcial'].includes(o.status)) throw new HttpError(409, o.status === 'rascunho' ? 'Envie o pedido antes de receber.' : `O pedido está ${o.status} e não recebe mais mercadoria.`);
    const ids = d.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, 'Item repetido no recebimento.');
    const items = (await c.query('SELECT i.*, p.tracks_batches, p.name FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id=$1 AND i.id = ANY($2) FOR UPDATE OF i', [o.id, ids])).rows;
    if (items.length !== ids.length) throw new HttpError(422, 'Item não pertence a este pedido.');
    let total = 0;
    for (const r of d.items) {
      const it = items.find((x) => x.id === r.itemId)!;
      const remaining = r3(Number(it.quantity) - Number(it.received_qty));
      if (r.quantity > remaining) throw new HttpError(422, `${it.name}: recebido ${r.quantity} excede o que falta (${remaining}).`, { items: `${it.name}: máximo ${remaining}` });
      if (it.tracks_batches && !r.batchCode) throw new HttpError(422, `${it.name}: informe o lote.`, { items: `${it.name}: informe o lote` });
      total += r.quantity * Number(it.unit_cost);
    }
    total = r2(total);
    let txId: string | null = null;
    if (pay) {
      if (total <= 0) throw new HttpError(422, 'O valor recebido é zero: não há conta a pagar para gerar.', { dueDate: 'Valor zero' });
      const cat = (await c.query('SELECT type, active FROM financial_categories WHERE id=$1', [pay.categoryId])).rows[0];
      if (!cat || cat.type !== 'despesa' || !cat.active) throw new HttpError(422, 'Categoria inválida para despesa', { categoryId: 'Categoria inválida ou inativa' });
      if (pay.accountId && !(await c.query('SELECT 1 FROM bank_accounts WHERE id=$1 AND active', [pay.accountId])).rowCount) throw new HttpError(422, 'Conta inválida ou inativa', { accountId: 'Conta inválida ou inativa' });
      if (pay.costCenterId && !(await c.query('SELECT 1 FROM cost_centers WHERE id=$1 AND active', [pay.costCenterId])).rowCount) throw new HttpError(422, 'Centro de custo inválido', { costCenterId: 'Centro de custo inválido ou inativo' });
      if (pay.dueDate! < d.receivedAt) throw new HttpError(422, 'O vencimento não pode ser anterior ao recebimento.', { dueDate: 'Anterior ao recebimento' });
      txId = (await c.query(
        `INSERT INTO financial_transactions (type, description, category_id, party, party_id, amount, competence_date, due_date, status, notes, created_by, account_id, cost_center_id)
         VALUES ('despesa',$1,$2,$3,$4,$5,$6,$7,'pendente',$8,$9,$10,$11) RETURNING id`,
        [`Compra ${o.number}${d.docNumber ? ` · NF ${d.docNumber}` : ''} — ${o.supplier}`.slice(0, 200), pay.categoryId, o.supplier, o.party_id, total, d.receivedAt, pay.dueDate, `Gerada pelo recebimento do pedido ${o.number}`, req.user!.id, pay.accountId ?? null, pay.costCenterId ?? null])).rows[0].id;
    }
    const rc = (await c.query('INSERT INTO purchase_receipts (order_id, received_at, doc_number, total, transaction_id, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [o.id, d.receivedAt, d.docNumber ?? null, total, txId, req.user!.name])).rows[0].id as number;
    for (const r of d.items) {
      const it = items.find((x) => x.id === r.itemId)!;
      await applyMovement(c, req, { productId: it.product_id, type: 'entrada', quantity: r.quantity, date: d.receivedAt, reason: 'Compra', unitCost: Number(it.unit_cost), docNumber: d.docNumber ?? o.number, supplierId: o.legacy_supplier_id ?? null,
        notes: `Pedido ${o.number}`, key: null, batchCode: it.tracks_batches ? r.batchCode : null, expiresAt: it.tracks_batches ? r.expiresAt ?? null : null });
      await c.query('UPDATE purchase_order_items SET received_qty = received_qty + $2 WHERE id=$1', [it.id, r.quantity]);
      await c.query('INSERT INTO purchase_receipt_items (receipt_id, item_id, quantity, unit_cost, batch_code, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [rc, it.id, r.quantity, it.unit_cost, r.batchCode ?? null, r.expiresAt ?? null]);
    }
    const left = (await c.query('SELECT count(*)::int n FROM purchase_order_items WHERE order_id=$1 AND received_qty < quantity', [o.id])).rows[0].n;
    const status = left === 0 ? 'recebido' : 'parcial';
    await c.query('UPDATE purchase_orders SET status=$2, updated_at=now() WHERE id=$1', [o.id, status]);
    await audit(req, { action: 'receber', module: 'estoque', entity: 'purchase_order', entityId: o.id, summary: `Recebimento do pedido ${o.number}: R$ ${brl(total)}${txId ? ' (conta a pagar gerada)' : ''}${status === 'parcial' ? ' — parcial' : ''}`, details: { itens: d.items.length, notaFiscal: d.docNumber ?? null } }, c);
    return { receiptId: rc, status, total, transactionId: txId };
  });
  res.status(201).json(out);
}));
