import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, Where, h, likeEsc, listParams, optInt, optMoney, optStr, parse, qstr, qty, reqDate, reqStr, sendReport, today } from '../util.js';
import { STOCK_STATUS } from '../services/stock.js';
import { lookupRouter } from './lookup.js';

export const estRouter = Router();

const perms = { viewPerms: ['est.view'], createPerm: 'est.create', editPerm: 'est.edit', inactivatePerm: 'est.inactivate', module: 'estoque' };
estRouter.use('/categories', lookupRouter({ table: 'product_categories', label: 'Categoria de produto', ...perms, usedBy: [{ table: 'products', column: 'category_id' }] }));
estRouter.use('/units', lookupRouter({ table: 'units_of_measure', label: 'Unidade de medida', hasCode: true, ...perms, usedBy: [{ table: 'products', column: 'unit_id' }] }));
estRouter.use('/suppliers', lookupRouter({ table: 'suppliers', label: 'Fornecedor', ...perms, usedBy: [{ table: 'products', column: 'supplier_id' }, { table: 'stock_movements', column: 'supplier_id' }] }));

const allowNegative = async (c: { query: typeof pool.query }) =>
  (await c.query(`SELECT value FROM settings WHERE key='allow_negative_stock'`)).rows[0]?.value === true;

// ---------- Produtos ----------
const productSchema = z.object({
  name: reqStr(200, 'Informe o nome'),
  description: optStr(1000),
  categoryId: optInt,
  unitId: z.coerce.number({ invalid_type_error: 'Selecione a unidade' }).int().positive('Selecione a unidade'),
  barcode: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().regex(/^[0-9A-Za-z-]{4,50}$/, 'Código de barras inválido').nullable().optional()),
  cost: z.coerce.number({ invalid_type_error: 'Custo inválido' }).min(0, 'Custo não pode ser negativo').max(999999999).default(0),
  salePrice: optMoney,
  initialQuantity: z.coerce.number().min(0, 'Quantidade não pode ser negativa').max(999999999).default(0),
  minStock: z.coerce.number({ invalid_type_error: 'Estoque mínimo inválido' }).min(0, 'Não pode ser negativo').max(999999999).default(0),
  location: optStr(100),
  supplierId: optInt,
  active: z.boolean().default(true),
});

const P_SELECT = `p.id, p.code, p.name, p.description, p.category_id AS "categoryId", pc.name AS category, p.unit_id AS "unitId", u.code AS unit,
  p.barcode, p.cost, p.sale_price AS "salePrice", p.quantity, p.min_stock AS "minStock", (p.quantity * p.cost) AS "totalValue",
  p.location, p.supplier_id AS "supplierId", s.name AS supplier, p.active, ${STOCK_STATUS} AS "stockStatus"`;
const P_FROM = `FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id JOIN units_of_measure u ON u.id=p.unit_id LEFT JOIN suppliers s ON s.id=p.supplier_id`;

const dupProduct = (e: unknown): never => {
  if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Código de barras já cadastrado', { barcode: 'Código de barras já cadastrado' });
  throw e;
};

estRouter.get('/products', requireAuth('est.view'), h(async (req, res) => {
  const p = listParams(req, { code: 'p.code', name: 'lower(p.name)', category: 'lower(pc.name)', quantity: 'p.quantity', cost: 'p.cost', total: '(p.quantity*p.cost)', status: STOCK_STATUS }, 'name');
  const w = new Where();
  if (p.q) w.add('(p.code ILIKE ? OR p.name ILIKE ? OR p.barcode ILIKE ?)', likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const cat = qstr(req, 'categoryId'); if (cat) w.add('p.category_id = ?', Number(cat));
  const st = qstr(req, 'stockStatus'); if (st) w.add(`${STOCK_STATUS} = ?`, st);
  const act = qstr(req, 'active'); if (act) w.add('p.active = ?', act === 'true');
  const total = (await pool.query(`SELECT count(*)::int n ${P_FROM} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${P_SELECT} ${P_FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir}, p.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

estRouter.get('/products/options', requireAuth('est.view'), h(async (req, res) => {
  const w = new Where().add('p.active');
  if (req.query.q) w.add('(p.code ILIKE ? OR p.name ILIKE ? OR p.barcode ILIKE ?)', likeEsc(String(req.query.q)), likeEsc(String(req.query.q)), likeEsc(String(req.query.q)));
  res.json((await pool.query(`SELECT p.id, p.code, p.name, p.quantity, u.code AS unit, p.cost ${P_FROM} ${w.sql} ORDER BY lower(p.name) LIMIT 50`, w.params)).rows);
}));

estRouter.get('/products/:id', requireAuth('est.view'), h(async (req, res) => {
  const r = (await pool.query(`SELECT ${P_SELECT} ${P_FROM} WHERE p.id=$1`, [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Produto não encontrado');
  res.json(r);
}));

estRouter.post('/products', requireAuth('est.create'), h(async (req, res) => {
  const d = parse(productSchema, req.body);
  if (d.initialQuantity > 0 && !hasPerm(req, 'est.move')) throw new HttpError(403, 'Sem permissão para lançar saldo inicial.');
  try {
    const out = await tx(async (c) => {
      const code = 'PRD-' + String((await c.query(`SELECT nextval('product_code_seq') n`)).rows[0].n).padStart(6, '0');
      const id = (await c.query(
        `INSERT INTO products (code,name,description,category_id,unit_id,barcode,cost,sale_price,quantity,min_stock,location,supplier_id,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12) RETURNING id`,
        [code, d.name, d.description ?? null, d.categoryId ?? null, d.unitId, d.barcode ?? null, d.cost, d.salePrice ?? null, d.minStock, d.location ?? null, d.supplierId ?? null, d.active])).rows[0].id;
      if (d.initialQuantity > 0) {
        await applyMovement(c, req, { productId: id, type: 'entrada', quantity: d.initialQuantity, date: today(), reason: 'Saldo inicial', unitCost: d.cost, key: null });
      }
      await audit(req, { action: 'criar', module: 'estoque', entity: 'product', entityId: id, summary: `Produto cadastrado: ${code} — ${d.name}` }, c);
      return { id, code };
    });
    res.status(201).json(out);
  } catch (e) { dupProduct(e); }
}));

estRouter.put('/products/:id', requireAuth('est.edit', 'est.inactivate'), h(async (req, res) => {
  const d = parse(productSchema, req.body);
  const cur = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Produto não encontrado');
  if (cur.active !== d.active && !hasPerm(req, 'est.inactivate')) throw new HttpError(403, 'Sem permissão para inativar/ativar.');
  if (!hasPerm(req, 'est.edit') && cur.active === d.active) throw new HttpError(403, 'Sem permissão para editar.');
  try {
    // quantidade e custo médio só mudam por movimentações
    await pool.query(
      `UPDATE products SET name=$2, description=$3, category_id=$4, unit_id=$5, barcode=$6, sale_price=$7, min_stock=$8, location=$9, supplier_id=$10, active=$11, updated_at=now() WHERE id=$1`,
      [req.params.id, d.name, d.description ?? null, d.categoryId ?? null, d.unitId, d.barcode ?? null, d.salePrice ?? null, d.minStock, d.location ?? null, d.supplierId ?? null, d.active]);
  } catch (e) { dupProduct(e); }
  await audit(req, { action: cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar', module: 'estoque', entity: 'product', entityId: req.params.id, summary: `Produto ${cur.active !== d.active ? (d.active ? 'ativado' : 'inativado') : 'editado'}: ${cur.code} — ${d.name}` });
  res.json({ ok: true });
}));

estRouter.delete('/products/:id', requireAuth('est.inactivate'), h(async (req, res) => {
  const cur = (await pool.query('SELECT code, name FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Produto não encontrado');
  const uses = (await pool.query('SELECT count(*)::int n FROM stock_movements WHERE product_id=$1', [req.params.id])).rows[0].n;
  if (uses > 0) throw new HttpError(409, `Produto possui ${uses} movimentação(ões) de estoque. Inative em vez de excluir.`);
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  await audit(req, { action: 'excluir', module: 'estoque', entity: 'product', entityId: req.params.id, summary: `Produto excluído: ${cur.code} — ${cur.name}` });
  res.json({ ok: true });
}));

// ---------- Movimentações ----------
interface Mv {
  productId: string; type: 'entrada' | 'saida' | 'ajuste'; quantity: number; date: string; reason: string;
  unitCost?: number | null; docNumber?: string | null; supplierId?: number | null; destination?: string | null; notes?: string | null;
  key: string | null; newQuantity?: number;
}

/** Aplica uma movimentação sob lock da linha do produto; saldo e histórico mudam juntos (mesma transação). */
async function applyMovement(c: Parameters<Parameters<typeof tx>[0]>[0], req: Request, m: Mv) {
  const p = (await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [m.productId])).rows[0];
  if (!p) throw new HttpError(404, 'Produto não encontrado');
  if (!p.active) throw new HttpError(409, 'Produto inativo não pode ser movimentado.');
  const before = Number(p.quantity);
  let delta: number;
  if (m.type === 'entrada') delta = m.quantity;
  else if (m.type === 'saida') delta = -m.quantity;
  else delta = Math.round((m.newQuantity! - before) * 1000) / 1000;
  if (m.type === 'ajuste' && delta === 0) throw new HttpError(422, 'A quantidade informada é igual ao saldo atual.', { newQuantity: 'Igual ao saldo atual' });
  const after = Math.round((before + delta) * 1000) / 1000;
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
  await audit(req, {
    action: m.type, module: 'estoque', entity: 'movement', entityId: mv.id,
    summary: `${m.type === 'entrada' ? 'Entrada' : m.type === 'saida' ? 'Saída' : 'Ajuste'} de estoque: ${p.code} ${p.name} (${delta > 0 ? '+' : ''}${delta}) — ${m.reason}`,
    details: { saldoAnterior: before, saldoPosterior: after },
  }, c);
  return { id: mv.id as number, balanceBefore: before, balanceAfter: after };
}

const baseMv = {
  productId: z.string({ required_error: 'Selecione o produto' }).uuid('Selecione o produto'),
  date: reqDate.refine((d) => d <= today(), 'Data não pode ser futura'),
  notes: optStr(1000),
  idempotencyKey: z.string().min(8).max(100).optional(),
};
const ENTRY_REASONS = ['Compra', 'Saldo inicial', 'Devolução', 'Ajuste autorizado'];
const EXIT_REASONS = ['Consumo interno', 'Venda', 'Perda ou avaria', 'Devolução ao fornecedor', 'Ajuste autorizado', 'Outros'];

async function runMovement(req: Request, res: import('express').Response, build: () => Mv, status = 201) {
  const m = build();
  try {
    const out = await tx((c) => applyMovement(c, req, m));
    res.status(status).json(out);
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23505' && err.constraint?.includes('idempotency') && m.key) {
      // reenvio do mesmo formulário: devolve o resultado original sem duplicar
      const prev = (await pool.query('SELECT id, balance_before AS "balanceBefore", balance_after AS "balanceAfter" FROM stock_movements WHERE idempotency_key=$1', [m.key])).rows[0];
      return void res.status(200).json({ ...prev, duplicate: true });
    }
    throw e;
  }
}

estRouter.post('/entries', requireAuth('est.move'), h(async (req, res) => {
  const d = parse(z.object({
    ...baseMv, quantity: qty, unitCost: optMoney.refine((v) => v == null || v >= 0), reason: z.enum(ENTRY_REASONS as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o motivo' }) }),
    docNumber: optStr(60), supplierId: optInt,
  }), req.body);
  if (d.reason === 'Ajuste autorizado' && !hasPerm(req, 'est.adjust')) throw new HttpError(403, 'Ajuste autorizado exige permissão de ajuste.');
  await runMovement(req, res, () => ({ productId: d.productId, type: 'entrada', quantity: d.quantity, date: d.date, reason: d.reason, unitCost: d.unitCost ?? null, docNumber: d.docNumber, supplierId: d.supplierId, notes: d.notes, key: d.idempotencyKey ?? null }));
}));

estRouter.post('/exits', requireAuth('est.move'), h(async (req, res) => {
  const d = parse(z.object({
    ...baseMv, quantity: qty, reason: z.enum(EXIT_REASONS as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o motivo' }) }), destination: optStr(200),
  }), req.body);
  if (d.reason === 'Ajuste autorizado' && !hasPerm(req, 'est.adjust')) throw new HttpError(403, 'Ajuste autorizado exige permissão de ajuste.');
  await runMovement(req, res, () => ({ productId: d.productId, type: 'saida', quantity: d.quantity, date: d.date, reason: d.reason, destination: d.destination, notes: d.notes, key: d.idempotencyKey ?? null }));
}));

estRouter.post('/adjustments', requireAuth('est.adjust'), h(async (req, res) => {
  const d = parse(z.object({
    ...baseMv, newQuantity: z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).min(0, 'Não pode ser negativa').max(999999999),
    reason: reqStr(300, 'Informe o motivo do ajuste'),
  }), req.body);
  await runMovement(req, res, () => ({ productId: d.productId, type: 'ajuste', quantity: 0, newQuantity: d.newQuantity, date: d.date, reason: d.reason, notes: d.notes, key: d.idempotencyKey ?? null }));
}));

estRouter.get('/movements', requireAuth('est.view'), h(async (req, res) => {
  const p = listParams(req, { at: 'm.id', date: 'm.movement_date', product: 'lower(p.name)', type: 'm.type', quantity: 'm.quantity' }, 'at', 'DESC');
  const w = new Where();
  const pr = qstr(req, 'productId'); if (pr) w.add('m.product_id = ?', pr);
  const ty = qstr(req, 'type'); if (ty) w.add('m.type = ?', ty);
  const us = qstr(req, 'userId'); if (us) w.add('m.user_id = ?', us);
  const from = qstr(req, 'from'); if (from) w.add('m.movement_date >= ?', from);
  const to = qstr(req, 'to'); if (to) w.add('m.movement_date <= ?', to);
  if (p.q) w.add('(p.name ILIKE ? OR p.code ILIKE ? OR m.reason ILIKE ?)', likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const total = (await pool.query(`SELECT count(*)::int n FROM stock_movements m JOIN products p ON p.id=m.product_id ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT m.id, m.created_at AS "at", m.movement_date AS "date", p.id AS "productId", p.code, p.name AS product, m.type, m.quantity, m.delta,
            m.balance_before AS "balanceBefore", m.balance_after AS "balanceAfter", m.unit_cost AS "unitCost", m.reason, m.doc_number AS "docNumber",
            m.destination, m.notes, m.user_name AS "userName"
       FROM stock_movements m JOIN products p ON p.id=m.product_id ${w.sql} ORDER BY ${p.sort} ${p.dir}, m.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

estRouter.get('/movements/users', requireAuth('est.view'), h(async (_req, res) => {
  res.json((await pool.query(`SELECT DISTINCT user_id AS id, user_name AS name FROM stock_movements WHERE user_id IS NOT NULL ORDER BY user_name`)).rows);
}));

estRouter.get('/alerts', requireAuth('est.view'), h(async (_req, res) => {
  res.json((await pool.query(
    `SELECT p.id, p.code, p.name, p.quantity, p.min_stock AS "minStock", u.code AS unit, ${STOCK_STATUS} AS status
       FROM products p JOIN units_of_measure u ON u.id=p.unit_id
      WHERE p.active AND (p.quantity <= 0 OR p.quantity <= p.min_stock) ORDER BY p.quantity, lower(p.name)`)).rows);
}));

// ---------- Relatórios ----------
const EREPORTS: Record<string, string> = {
  posicao: 'Posição atual do estoque', 'abaixo-minimo': 'Produtos abaixo do estoque mínimo', 'sem-estoque': 'Produtos sem estoque',
  entradas: 'Histórico de entradas', saidas: 'Histórico de saídas', ajustes: 'Ajustes de inventário',
  valor: 'Valor total estimado do estoque', 'mais-movimentados': 'Produtos com maior movimentação',
};
estRouter.get('/reports', requireAuth('est.view'), (_req, res) => { res.json(EREPORTS); });

const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dmy = (s: string | null) => (s ? s.split('-').reverse().join('/') : '');
const STATUS_LABEL: Record<string, string> = { normal: 'Normal', baixo: 'Estoque baixo', sem_estoque: 'Sem estoque', inativo: 'Inativo' };

estRouter.get('/reports/:name', requireAuth('est.view'), h(async (req, res) => {
  const name = req.params.name;
  if (!EREPORTS[name]) throw new HttpError(404, 'Relatório inexistente');
  if (req.query.format === 'csv') {
    if (!hasPerm(req, 'est.export')) throw new HttpError(403, 'Sem permissão para exportar.');
    await audit(req, { action: 'exportar', module: 'estoque', entity: 'report', summary: `Relatório de estoque exportado (CSV): ${EREPORTS[name]}` });
  }
  const title = EREPORTS[name];
  const from = qstr(req, 'from') ?? `${today().slice(0, 8)}01`, to = qstr(req, 'to') ?? today();
  const cat = qstr(req, 'categoryId');

  if (['posicao', 'abaixo-minimo', 'sem-estoque', 'valor'].includes(name)) {
    const w = new Where();
    if (name === 'abaixo-minimo') w.add(`p.active AND p.quantity > 0 AND p.quantity <= p.min_stock`);
    if (name === 'sem-estoque') w.add(`p.active AND p.quantity <= 0`);
    if (cat) w.add('p.category_id = ?', Number(cat));
    const rows = (await pool.query(`SELECT ${P_SELECT} ${P_FROM} ${w.sql} ORDER BY lower(p.name) LIMIT 5000`, w.params)).rows;
    const totalValue = rows.reduce((a, r) => a + (Number(r.quantity) > 0 ? Number(r.totalValue) : 0), 0);
    return sendReport(req, res, `estoque-${name}`, [
      { key: 'code', label: 'Código' }, { key: 'name', label: 'Produto' }, { key: 'category', label: 'Categoria' }, { key: 'quantity', label: 'Quantidade' }, { key: 'unit', label: 'Un.' },
      { key: 'minStock', label: 'Mínimo' }, { key: 'cost', label: 'Custo médio (R$)' }, { key: 'totalValue', label: 'Valor em estoque (R$)' }, { key: 'status', label: 'Situação' },
    ], rows.map((r) => ({ ...r, quantity: num(r.quantity), minStock: num(r.minStock), cost: brl(r.cost), totalValue: brl(Number(r.quantity) > 0 ? r.totalValue : 0), status: STATUS_LABEL[r.stockStatus] })),
    { title, totalLabel: 'Valor total estimado (custo médio ponderado)', total: brl(totalValue) });
  }

  if (name === 'mais-movimentados') {
    const rows = (await pool.query(
      `SELECT p.code, p.name, count(*)::int AS movs, COALESCE(sum(m.quantity) FILTER (WHERE m.type='entrada'),0) AS entradas, COALESCE(sum(m.quantity) FILTER (WHERE m.type='saida'),0) AS saidas
         FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.movement_date BETWEEN $1 AND $2 GROUP BY p.code, p.name ORDER BY movs DESC, p.name LIMIT 100`, [from, to])).rows;
    return sendReport(req, res, `estoque-${name}`, [{ key: 'code', label: 'Código' }, { key: 'name', label: 'Produto' }, { key: 'movs', label: 'Nº de movimentações' }, { key: 'entradas', label: 'Qtd. entradas' }, { key: 'saidas', label: 'Qtd. saídas' }],
      rows.map((r) => ({ ...r, entradas: num(r.entradas), saidas: num(r.saidas) })), { title, period: { from, to } });
  }

  const type = name === 'entradas' ? 'entrada' : name === 'saidas' ? 'saida' : 'ajuste';
  const w = new Where().add('m.type = ?', type).add('m.movement_date BETWEEN ? AND ?', from, to);
  if (cat) w.add('p.category_id = ?', Number(cat));
  const rows = (await pool.query(
    `SELECT m.movement_date AS date, p.code, p.name, m.quantity, m.delta, m.balance_before AS "balanceBefore", m.balance_after AS "balanceAfter", m.unit_cost AS "unitCost", m.reason, m.doc_number AS "docNumber", m.destination, m.user_name AS "userName"
       FROM stock_movements m JOIN products p ON p.id=m.product_id ${w.sql} ORDER BY m.id DESC LIMIT 5000`, w.params)).rows;
  sendReport(req, res, `estoque-${name}`, [
    { key: 'date', label: 'Data' }, { key: 'code', label: 'Código' }, { key: 'name', label: 'Produto' }, { key: 'quantity', label: type === 'ajuste' ? 'Diferença' : 'Quantidade' },
    { key: 'balanceBefore', label: 'Saldo anterior' }, { key: 'balanceAfter', label: 'Saldo posterior' }, ...(type === 'entrada' ? [{ key: 'unitCost', label: 'Custo unit. (R$)' }, { key: 'docNumber', label: 'NF' }] : []),
    ...(type === 'saida' ? [{ key: 'destination', label: 'Destino' }] : []), { key: 'reason', label: 'Motivo' }, { key: 'userName', label: 'Responsável' },
  ], rows.map((r) => ({ ...r, date: dmy(r.date), quantity: type === 'ajuste' ? num(r.delta) : num(r.quantity), balanceBefore: num(r.balanceBefore), balanceAfter: num(r.balanceAfter), unitCost: r.unitCost == null ? '' : brl(r.unitCost) })),
  { title, period: { from, to } });
}));
