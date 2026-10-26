import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, Where, h, likeEsc, listParams, money, optDate, optInt, optStr, parse, qstr, reqDate, reqStr, sendReport, today } from '../util.js';
import { EFF, TODAY_SQL, financeSummary } from '../services/finance.js';
import { getSettings } from '../services/settings.js';
import { lookupRouter } from './lookup.js';
import { BALANCE, EFF_ACCOUNT, computeCashflow } from './banking.js';

export const finRouter = Router();

const METHODS = ['Dinheiro', 'PIX', 'Transferência', 'Boleto', 'Cartão de crédito', 'Cartão de débito', 'Cheque', 'Outro'];
const dupCat = (e: unknown): never => {
  if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Já existe uma categoria com esse nome para o tipo', { name: 'Já existe categoria com esse nome' });
  throw e;
};

// ---------- Categorias ----------
const catSchema = z.object({
  name: reqStr(100, 'Informe o nome'), type: z.enum(['receita', 'despesa'], { errorMap: () => ({ message: 'Selecione o tipo' }) }),
  description: optStr(300), active: z.boolean().default(true),
});

finRouter.get('/categories', requireAuth('fin.view'), h(async (req, res) => {
  const w = new Where();
  const t = qstr(req, 'type'); if (t) w.add('c.type = ?', t);
  if (req.query.active === 'true') w.add('c.active');
  res.json((await pool.query(
    `SELECT c.id, c.name, c.type, c.description, c.active, (SELECT count(*)::int FROM financial_transactions x WHERE x.category_id=c.id) AS "usageCount"
       FROM financial_categories c ${w.sql} ORDER BY c.type, lower(c.name)`, w.params)).rows);
}));

finRouter.post('/categories', requireAuth('fin.create'), h(async (req, res) => {
  const d = parse(catSchema, req.body);
  try {
    const id = (await pool.query('INSERT INTO financial_categories (name,type,description,active) VALUES ($1,$2,$3,$4) RETURNING id', [d.name, d.type, d.description ?? null, d.active])).rows[0].id;
    await audit(req, { action: 'criar', module: 'financeiro', entity: 'category', entityId: id, summary: `Categoria financeira criada: ${d.name} (${d.type})` });
    res.status(201).json({ id });
  } catch (e) { dupCat(e); }
}));

finRouter.put('/categories/:id', requireAuth('fin.edit', 'fin.inactivate'), h(async (req, res) => {
  const d = parse(catSchema, req.body);
  const cur = (await pool.query('SELECT c.*, (SELECT count(*)::int FROM financial_transactions x WHERE x.category_id=c.id) AS uses FROM financial_categories c WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Categoria não encontrada');
  if (cur.type !== d.type && cur.uses > 0) throw new HttpError(409, 'Não é possível mudar o tipo de categoria com lançamentos.', { type: 'Categoria já utilizada' });
  if (cur.active !== d.active && !hasPerm(req, 'fin.inactivate')) throw new HttpError(403, 'Sem permissão para inativar/ativar.');
  try {
    await pool.query('UPDATE financial_categories SET name=$2,type=$3,description=$4,active=$5 WHERE id=$1', [req.params.id, d.name, d.type, d.description ?? null, d.active]);
  } catch (e) { dupCat(e); }
  await audit(req, { action: cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar', module: 'financeiro', entity: 'category', entityId: req.params.id, summary: `Categoria ${cur.active !== d.active ? (d.active ? 'ativada' : 'inativada') : 'editada'}: ${d.name}` });
  res.json({ ok: true });
}));

finRouter.delete('/categories/:id', requireAuth('fin.inactivate'), h(async (req, res) => {
  const cur = (await pool.query('SELECT c.*, (SELECT count(*)::int FROM financial_transactions x WHERE x.category_id=c.id) AS uses FROM financial_categories c WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Categoria não encontrada');
  if (cur.uses > 0) throw new HttpError(409, 'Categoria vinculada a lançamentos: apenas inativação é permitida.');
  await pool.query('DELETE FROM financial_categories WHERE id=$1', [req.params.id]);
  await audit(req, { action: 'excluir', module: 'financeiro', entity: 'category', entityId: req.params.id, summary: `Categoria excluída: ${cur.name}` });
  res.json({ ok: true });
}));

finRouter.use('/cost-centers', lookupRouter({ table: 'cost_centers', label: 'Centro de custo', module: 'financeiro', viewPerms: ['fin.view'], createPerm: 'fin.create', editPerm: 'fin.edit', inactivatePerm: 'fin.inactivate', usedBy: [{ table: 'financial_transactions', column: 'cost_center_id' }] }));

// ---------- Lançamentos ----------
const txSchema = z.object({
  type: z.enum(['receita', 'despesa']),
  description: reqStr(200, 'Informe a descrição'),
  categoryId: z.coerce.number({ invalid_type_error: 'Selecione a categoria' }).int().positive('Selecione a categoria'),
  party: optStr(200),
  partyId: optInt,
  accountId: optInt,
  costCenterId: optInt,
  amount: money,
  competenceDate: reqDate,
  dueDate: reqDate,
  method: z.preprocess((v) => (v === '' ? null : v), z.enum(METHODS as [string, ...string[]]).nullable().optional()),
  notes: optStr(1000),
  repeatMonths: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(2, 'Mínimo 2 parcelas').max(60, 'Máximo 60').optional()),
  settledDate: optDate, // preenchido = já nasce paga/recebida
});

const TX_SELECT = `t.id, t.type, t.description, t.category_id AS "categoryId", c.name AS category, t.party, t.party_id AS "partyId", t.account_id AS "accountId", COALESCE(ba.name, (SELECT name FROM bank_accounts WHERE is_default)) AS account,
  t.cost_center_id AS "costCenterId", cc.name AS "costCenter", t.amount, t.competence_date AS "competenceDate",
  t.due_date AS "dueDate", t.settled_date AS "settledDate", t.method, t.status AS "storedStatus", ${EFF} AS status, t.notes,
  t.attachment_name AS "attachmentName", t.series_id AS "seriesId", t.created_at AS "createdAt"`;
const TX_FROM = `FROM financial_transactions t JOIN financial_categories c ON c.id = t.category_id
  LEFT JOIN bank_accounts ba ON ba.id = t.account_id LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id`;

/** Com partyId, o nome do cadastro vira o texto exibido (party); sem ele, vale o texto livre. */
async function resolveParty(c: { query: typeof pool.query }, type: 'receita' | 'despesa', d: { party?: string | null; partyId?: number | null }, keepId?: number | null) {
  if (!d.partyId) return { party: d.party ?? null, partyId: null as number | null };
  const p = (await c.query('SELECT id, name, active, is_customer, is_supplier FROM parties WHERE id=$1', [d.partyId])).rows[0];
  const okKind = p && (type === 'receita' ? p.is_customer : p.is_supplier);
  if (!p || !okKind || (!p.active && p.id !== keepId)) throw new HttpError(422, type === 'receita' ? 'Cliente inválido ou inativo' : 'Fornecedor inválido ou inativo', { partyId: 'Cadastro inválido ou inativo' });
  return { party: p.name as string, partyId: p.id as number };
}

/** Conta e centro de custo precisam existir e estar ativos (a escolha já gravada no lançamento continua válida). */
async function resolveAccountCc(c: { query: typeof pool.query }, d: { accountId?: number | null; costCenterId?: number | null }, cur?: { account_id: number | null; cost_center_id: number | null }) {
  if (d.accountId && d.accountId !== cur?.account_id) {
    const a = (await c.query('SELECT active FROM bank_accounts WHERE id=$1', [d.accountId])).rows[0];
    if (!a || !a.active) throw new HttpError(422, 'Conta inválida ou inativa', { accountId: 'Conta inválida ou inativa' });
  }
  if (d.costCenterId && d.costCenterId !== cur?.cost_center_id) {
    const k = (await c.query('SELECT active FROM cost_centers WHERE id=$1', [d.costCenterId])).rows[0];
    if (!k || !k.active) throw new HttpError(422, 'Centro de custo inválido ou inativo', { costCenterId: 'Centro de custo inválido ou inativo' });
  }
}

function addMonths(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

finRouter.get('/transactions', requireAuth('fin.view'), h(async (req, res) => {
  const type = qstr(req, 'type');
  if (type !== 'receita' && type !== 'despesa') throw new HttpError(422, 'Informe o tipo (receita|despesa)');
  const p = listParams(req, { dueDate: 't.due_date', amount: 't.amount', status: EFF, description: 'lower(t.description)', settledDate: 't.settled_date', category: 'lower(c.name)' }, 'dueDate', 'DESC');
  const w = new Where().add('t.type = ?', type);
  if (p.q) w.add('(t.description ILIKE ? OR t.party ILIKE ?)', likeEsc(p.q), likeEsc(p.q));
  const from = qstr(req, 'from'); if (from) w.add('t.due_date >= ?', from);
  const to = qstr(req, 'to'); if (to) w.add('t.due_date <= ?', to);
  const cat = qstr(req, 'categoryId'); if (cat) w.add('t.category_id = ?', Number(cat));
  const st = qstr(req, 'status'); if (st) w.add(`${EFF} = ?`, st);
  const me = qstr(req, 'method'); if (me) w.add('t.method = ?', me);
  const party = qstr(req, 'party'); if (party) w.add('t.party ILIKE ?', likeEsc(party));
  const accId = qstr(req, 'accountId'); if (accId) w.add('COALESCE(t.account_id, (SELECT id FROM bank_accounts WHERE is_default)) = ?', Number(accId));
  const ccId = qstr(req, 'costCenterId'); if (ccId) w.add(ccId === 'none' ? 't.cost_center_id IS NULL' : 't.cost_center_id = ?', ...(ccId === 'none' ? [] : [Number(ccId)]));
  const partyId = qstr(req, 'partyId'); if (partyId) w.add('t.party_id = ?', Number(partyId));
  const total = (await pool.query(`SELECT count(*)::int n, COALESCE(sum(t.amount) FILTER (WHERE t.status<>'cancelada'),0) AS soma ${TX_FROM} ${w.sql}`, w.params)).rows[0];
  const rows = (await pool.query(`SELECT ${TX_SELECT} ${TX_FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir}, t.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total: total.n, sum: total.soma, page: p.page, pageSize: p.pageSize });
}));

finRouter.get('/transactions/:id', requireAuth('fin.view'), h(async (req, res) => {
  const r = (await pool.query(`SELECT ${TX_SELECT} ${TX_FROM} WHERE t.id = $1`, [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Lançamento não encontrado');
  r.payment = (await pool.query(`SELECT amount, effective_date AS "effectiveDate", method, user_name AS "userName", created_at AS "createdAt" FROM payment_records WHERE transaction_id=$1`, [req.params.id])).rows[0] ?? null;
  res.json(r);
}));

finRouter.post('/transactions', requireAuth('fin.create'), h(async (req, res) => {
  const d = parse(txSchema, req.body);
  if (d.settledDate) {
    if (!hasPerm(req, 'fin.settle')) throw new HttpError(403, 'Sem permissão para registrar pagamento/recebimento.');
    if (d.settledDate > today()) throw new HttpError(422, 'Data efetiva não pode ser futura', { settledDate: 'Data efetiva não pode ser futura' });
    if (d.repeatMonths) throw new HttpError(422, 'Lançamentos recorrentes devem ser criados como previstos.', { repeatMonths: 'Não combine com baixa imediata' });
  }
  const ids = await tx(async (c) => {
    const cat = (await c.query('SELECT type, active FROM financial_categories WHERE id=$1', [d.categoryId])).rows[0];
    if (!cat || cat.type !== d.type || !cat.active) throw new HttpError(422, 'Categoria inválida para este tipo', { categoryId: 'Categoria inválida ou inativa' });
    const pty = await resolveParty(c, d.type, d);
    await resolveAccountCc(c, d);
    const n = d.repeatMonths ?? 1;
    const series = n > 1 ? crypto.randomUUID() : null;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const desc = n > 1 ? `${d.description} (${i + 1}/${n})` : d.description;
      const row = (await c.query(
        `INSERT INTO financial_transactions (type, description, category_id, party, party_id, amount, competence_date, due_date, settled_date, method, status, notes, series_id, created_by, account_id, cost_center_id)
         VALUES ($1,$2,$3,$4,$14,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15,$16) RETURNING id`,
        [d.type, desc, d.categoryId, pty.party, d.amount, addMonths(d.competenceDate, i), addMonths(d.dueDate, i), d.settledDate ?? null, d.method ?? null,
         d.settledDate ? 'realizada' : 'pendente', d.notes ?? null, series, req.user!.id, pty.partyId, d.accountId ?? null, d.costCenterId ?? null])).rows[0];
      if (d.settledDate) {
        await c.query(`INSERT INTO payment_records (transaction_id, amount, effective_date, method, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
          [row.id, d.amount, d.settledDate, d.method ?? null, req.user!.id, req.user!.name]);
      }
      out.push(row.id);
    }
    await audit(req, { action: 'criar', module: 'financeiro', entity: 'transaction', entityId: out[0], summary: `${d.type === 'receita' ? 'Receita' : 'Despesa'} registrada: ${d.description} — R$ ${d.amount.toFixed(2).replace('.', ',')}${n > 1 ? ` (${n} parcelas)` : ''}${d.settledDate ? ' (já baixada)' : ''}`, details: { valor: d.amount, parcelas: n } }, c);
    return out;
  });
  res.status(201).json({ id: ids[0], ids });
}));

finRouter.put('/transactions/:id', requireAuth('fin.edit'), h(async (req, res) => {
  const d = parse(txSchema.omit({ repeatMonths: true, settledDate: true, type: true }), req.body);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status === 'cancelada') throw new HttpError(409, 'Lançamento cancelado não pode ser editado.');
    const cat = (await c.query('SELECT type, active FROM financial_categories WHERE id=$1', [d.categoryId])).rows[0];
    if (!cat || cat.type !== cur.type || (!cat.active && cat.type && d.categoryId !== cur.category_id)) throw new HttpError(422, 'Categoria inválida para este tipo', { categoryId: 'Categoria inválida ou inativa' });
    const pty = await resolveParty(c, cur.type, d, cur.party_id);
    await resolveAccountCc(c, d, cur);
    if (cur.status === 'realizada') {
      // lançamento baixado: valores e datas ficam travados (preservam a baixa)
      if (Number(cur.amount) !== d.amount || cur.due_date !== d.dueDate || cur.competence_date !== d.competenceDate)
        throw new HttpError(409, 'Lançamento já baixado: valor e datas não podem ser alterados.');
      await c.query('UPDATE financial_transactions SET description=$2, category_id=$3, party=$4, party_id=$6, cost_center_id=$7, notes=$5, updated_at=now() WHERE id=$1', [req.params.id, d.description, d.categoryId, pty.party, d.notes ?? null, pty.partyId, d.costCenterId ?? null]);
    } else {
      await c.query(`UPDATE financial_transactions SET description=$2, category_id=$3, party=$4, party_id=$10, account_id=$11, cost_center_id=$12, amount=$5, competence_date=$6, due_date=$7, method=$8, notes=$9, updated_at=now() WHERE id=$1`,
        [req.params.id, d.description, d.categoryId, pty.party, d.amount, d.competenceDate, d.dueDate, d.method ?? null, d.notes ?? null, pty.partyId, d.accountId ?? null, d.costCenterId ?? null]);
    }
    const diffs = [Number(cur.amount) !== d.amount && 'valor', cur.due_date !== d.dueDate && 'vencimento', cur.category_id !== d.categoryId && 'categoria'].filter(Boolean);
    await audit(req, { action: 'editar', module: 'financeiro', entity: 'transaction', entityId: req.params.id, summary: `Lançamento editado: ${d.description}`, details: { campos: diffs, valorAnterior: cur.amount, valorNovo: d.amount, vencimentoAnterior: cur.due_date, vencimentoNovo: d.dueDate } }, c);
  });
  res.json({ ok: true });
}));

// Baixa: a linha é travada e payment_records.transaction_id é UNIQUE → impossível baixar duas vezes.
finRouter.post('/transactions/:id/settle', requireAuth('fin.settle'), h(async (req, res) => {
  const d = parse(z.object({ effectiveDate: reqDate, accountId: optInt, method: z.preprocess((v) => (v === '' ? null : v), z.enum(METHODS as [string, ...string[]]).nullable().optional()) }), req.body);
  if (d.effectiveDate > today()) throw new HttpError(422, 'Data efetiva não pode ser futura', { effectiveDate: 'Data efetiva não pode ser futura' });
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status === 'realizada') throw new HttpError(409, `Este lançamento já foi ${cur.type === 'receita' ? 'recebido' : 'pago'}.`);
    if (cur.status === 'cancelada') throw new HttpError(409, 'Lançamento cancelado não pode ser baixado.');
    const method = d.method ?? cur.method;
    await resolveAccountCc(c, { accountId: d.accountId }, cur);
    await c.query(`INSERT INTO payment_records (transaction_id, amount, effective_date, method, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [cur.id, cur.amount, d.effectiveDate, method, req.user!.id, req.user!.name]);
    await c.query(`UPDATE financial_transactions SET status='realizada', settled_date=$2, method=$3, account_id=COALESCE($4, account_id), updated_at=now() WHERE id=$1`, [cur.id, d.effectiveDate, method, d.accountId ?? null]);
    await audit(req, { action: 'baixa', module: 'financeiro', entity: 'transaction', entityId: cur.id, summary: `${cur.type === 'receita' ? 'Recebimento' : 'Pagamento'} registrado: ${cur.description} — R$ ${Number(cur.amount).toFixed(2).replace('.', ',')}`, details: { dataEfetiva: d.effectiveDate } }, c);
  });
  res.json({ ok: true });
}));

// Estorno da baixa (pagamento/recebimento marcado por engano): o lançamento volta a pendente e pode ser
// editado, cancelado ou excluído. O registro da baixa removida fica guardado na auditoria.
finRouter.post('/transactions/:id/unsettle', requireAuth('fin.settle'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: optStr(300) }), req.body);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status !== 'realizada') throw new HttpError(409, `Este lançamento não está ${cur.type === 'receita' ? 'recebido' : 'pago'}.`);
    if ((await c.query('SELECT 1 FROM bank_statement_lines WHERE transaction_id=$1', [cur.id])).rowCount) throw new HttpError(409, 'Lançamento conciliado com o extrato: desfaça a conciliação antes de estornar a baixa.');
    const baixa = (await c.query('DELETE FROM payment_records WHERE transaction_id=$1 RETURNING effective_date AS "dataEfetiva", method AS forma, user_name AS "registradaPor", created_at AS "registradaEm"', [cur.id])).rows[0];
    await c.query(`UPDATE financial_transactions SET status='pendente', settled_date=NULL, updated_at=now() WHERE id=$1`, [cur.id]);
    await audit(req, { action: 'estornar', module: 'financeiro', entity: 'transaction', entityId: cur.id, summary: `${cur.type === 'receita' ? 'Recebimento' : 'Pagamento'} estornado: ${cur.description} — R$ ${Number(cur.amount).toFixed(2).replace('.', ',')}`, details: { motivo: reason, baixa } }, c);
  });
  res.json({ ok: true });
}));

finRouter.post('/transactions/:id/cancel', requireAuth('fin.cancel'), h(async (req, res) => {
  const { reason } = parse(z.object({ reason: optStr(300) }), req.body);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status !== 'pendente') throw new HttpError(409, 'Somente lançamentos pendentes podem ser cancelados.');
    await c.query(`UPDATE financial_transactions SET status='cancelada', updated_at=now(), notes = concat_ws(E'\\n', notes, $2::text) WHERE id=$1`, [cur.id, reason ? `Cancelado: ${reason}` : 'Cancelado']);
    await audit(req, { action: 'cancelar', module: 'financeiro', entity: 'transaction', entityId: cur.id, summary: `Lançamento cancelado: ${cur.description}`, details: { motivo: reason } }, c);
  });
  res.json({ ok: true });
}));

finRouter.delete('/transactions/:id', requireAuth('fin.cancel'), h(async (req, res) => {
  const old = await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status === 'realizada') throw new HttpError(409, 'Lançamento com baixa registrada não pode ser excluído.');
    await c.query('DELETE FROM financial_transactions WHERE id=$1', [cur.id]);
    await audit(req, { action: 'excluir', module: 'financeiro', entity: 'transaction', entityId: cur.id, summary: `Lançamento excluído: ${cur.description} — R$ ${Number(cur.amount).toFixed(2).replace('.', ',')}`, details: { lancamento: cur } }, c);
    return cur;
  });
  if (old.attachment_path) fs.rmSync(path.join(config.uploadDir, path.basename(old.attachment_path)), { force: true });
  res.json({ ok: true });
}));

// ---------- Anexos ----------
const ALLOWED = new Map([['.pdf', 'application/pdf'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg']]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdirSync(config.uploadDir, { recursive: true }); cb(null, config.uploadDir); },
    filename: (_r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => cb(null, ALLOWED.get(path.extname(f.originalname).toLowerCase()) === f.mimetype),
});

finRouter.post('/transactions/:id/attachment', requireAuth('fin.create', 'fin.edit'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(422, 'Arquivo inválido. Envie PDF, PNG ou JPG de até 5 MB.');
  const old = (await pool.query('SELECT attachment_path FROM financial_transactions WHERE id=$1', [req.params.id])).rows[0];
  if (!old) { fs.rmSync(req.file.path, { force: true }); throw new HttpError(404, 'Lançamento não encontrado'); }
  await pool.query('UPDATE financial_transactions SET attachment_name=$2, attachment_path=$3 WHERE id=$1', [req.params.id, req.file.originalname.slice(0, 200), req.file.filename]);
  if (old.attachment_path) fs.rmSync(path.join(config.uploadDir, path.basename(old.attachment_path)), { force: true });
  await audit(req, { action: 'anexar', module: 'financeiro', entity: 'transaction', entityId: req.params.id, summary: `Anexo adicionado ao lançamento (${req.file.originalname.slice(0, 80)})` });
  res.json({ ok: true });
}));

finRouter.get('/transactions/:id/attachment', requireAuth('fin.view'), h(async (req, res) => {
  const r = (await pool.query('SELECT attachment_name, attachment_path FROM financial_transactions WHERE id=$1', [req.params.id])).rows[0];
  if (!r?.attachment_path) throw new HttpError(404, 'Sem anexo');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(path.join(config.uploadDir, path.basename(r.attachment_path)), r.attachment_name);
}));

// ---------- Indicadores e relatórios ----------
const range = (req: import('express').Request) => {
  const t = today();
  const from = qstr(req, 'from') ?? `${t.slice(0, 8)}01`;
  const to = qstr(req, 'to') ?? t;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(422, 'Período inválido');
  return { from, to };
};

// Próximas contas (pendentes) com vencimento até N dias; as já vencidas vêm primeiro, marcadas com daysLeft < 0.
finRouter.get('/upcoming', requireAuth('fin.view'), h(async (req, res) => {
  const st = await getSettings();
  const type = qstr(req, 'type') === 'receita' ? 'receita' : qstr(req, 'type') === 'ambos' ? 'ambos' : 'despesa';
  const days = Math.min(90, Math.max(0, Number(qstr(req, 'days') ?? st.notify_bills_days) || 0));
  const limit = Math.min(50, Math.max(1, Number(qstr(req, 'limit') ?? st.upcoming_list_size) || st.upcoming_list_size));
  const where = `t.status='pendente' AND t.due_date <= ${TODAY_SQL} + $1::int ${type === 'ambos' ? '' : 'AND t.type = $2'}`;
  const params: unknown[] = type === 'ambos' ? [days] : [days, type];
  const agg = (await pool.query(`SELECT count(*)::int n, COALESCE(sum(t.amount),0) total FROM financial_transactions t WHERE ${where}`, params)).rows[0];
  const rows = (await pool.query(
    `SELECT t.id, t.type, t.description, t.party, t.amount, t.due_date AS "dueDate", c.name AS category, (t.due_date - ${TODAY_SQL})::int AS "daysLeft"
       FROM financial_transactions t JOIN financial_categories c ON c.id = t.category_id
      WHERE ${where} ORDER BY t.due_date, t.id LIMIT ${limit}`, params)).rows;
  res.json({ days, type, total: Number(agg.total), count: agg.n, items: rows });
}));

finRouter.get('/summary', requireAuth('fin.view'), h(async (req, res) => {
  const { from, to } = range(req);
  res.json(await financeSummary(from, to, qstr(req, 'status')));
}));

const FREPORTS: Record<string, string> = {
  receitas: 'Relatório de receitas', despesas: 'Relatório de despesas', 'a-pagar': 'Contas a pagar', 'a-receber': 'Contas a receber',
  vencidas: 'Contas vencidas', 'fluxo-caixa': 'Fluxo de caixa', resultado: 'Resultado financeiro por período',
  'despesas-categoria': 'Despesas por categoria', 'centros-custo': 'Resultado por centro de custo', 'receitas-categoria': 'Receitas por categoria', historico: 'Histórico de movimentações',
  'fluxo-projetado': 'Fluxo de caixa projetado (30/60/90 dias)', 'saldo-contas': 'Saldo por conta', 'extrato-conta': 'Extrato da conta (com saldo)',
  transferencias: 'Transferências entre contas', conciliacao: 'Conciliação bancária (extrato OFX)', 'por-cadastro': 'Movimento por cliente/fornecedor',
};

/** Filtros comuns de conta, centro de custo e cliente/fornecedor (alias `t` = financial_transactions). Retorna ` AND ...` e os parâmetros, numerados a partir de `from`. */
function extraConds(req: import('express').Request, from: number) {
  const params: unknown[] = []; let sql = '';
  const acc = qstr(req, 'accountId'); if (acc) { params.push(Number(acc)); sql += ` AND ${EFF_ACCOUNT} = $${from + params.length - 1}`; }
  const cc = qstr(req, 'costCenterId');
  if (cc === 'none') sql += ' AND t.cost_center_id IS NULL'; else if (cc) { params.push(Number(cc)); sql += ` AND t.cost_center_id = $${from + params.length - 1}`; }
  const pt = qstr(req, 'partyId'); if (pt) { params.push(Number(pt)); sql += ` AND t.party_id = $${from + params.length - 1}`; }
  return { sql, params };
}
finRouter.get('/reports', requireAuth('fin.view'), (_req, res) => { res.json(FREPORTS); });

const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s: string | null) => (s ? s.split('-').reverse().join('/') : '');

finRouter.get('/reports/:name', requireAuth('fin.view'), h(async (req, res) => {
  const name = req.params.name;
  if (!FREPORTS[name]) throw new HttpError(404, 'Relatório inexistente');
  if (req.query.format === 'csv') {
    if (!hasPerm(req, 'fin.export')) throw new HttpError(403, 'Sem permissão para exportar.');
    await audit(req, { action: 'exportar', module: 'financeiro', entity: 'report', summary: `Relatório financeiro exportado (CSV): ${FREPORTS[name]}` });
  }
  const { from, to } = range(req);
  const explicitRange = !!(qstr(req, 'from') || qstr(req, 'to'));
  const cat = qstr(req, 'categoryId'), st = qstr(req, 'status');
  const title = FREPORTS[name];
  const out = (cols: { key: string; label: string }[], rows: Record<string, unknown>[], extra: object = {}) =>
    sendReport(req, res, `financeiro-${name}`, cols, rows, { title, period: { from, to }, ...extra });

  if (['receitas', 'despesas', 'a-pagar', 'a-receber', 'vencidas'].includes(name)) {
    const w = new Where();
    w.add(`t.type = ?`, name === 'receitas' || name === 'a-receber' ? 'receita' : 'despesa');
    if (name !== 'vencidas' || explicitRange) w.add('t.due_date BETWEEN ? AND ?', from, to);
    if (name === 'a-pagar' || name === 'a-receber') w.add(`t.status='pendente'`);
    if (name === 'vencidas') w.add(`${EFF} = 'vencida'`);
    if (cat) w.add('t.category_id = ?', Number(cat));
    if (st) w.add(`${EFF} = ?`, st);
    const ex = extraConds(req, w.params.length + 1);
    const rows = (await pool.query(`SELECT ${TX_SELECT} ${TX_FROM} ${w.sql}${ex.sql} ORDER BY t.due_date, t.id LIMIT 5000`, [...w.params, ...ex.params])).rows;
    const total = rows.filter((r) => r.status !== 'cancelada').reduce((a, r) => a + Number(r.amount), 0);
    return out(
      [{ key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'costCenter', label: 'Centro de custo' }, { key: 'account', label: 'Conta' }, { key: 'party', label: 'Origem/Fornecedor' }, { key: 'amount', label: 'Valor (R$)' },
       { key: 'dueDate', label: 'Vencimento' }, { key: 'settledDate', label: 'Data efetiva' }, { key: 'method', label: 'Forma' }, { key: 'status', label: 'Situação' }],
      rows.map((r) => ({ ...r, amount: brl(r.amount), dueDate: dmy(r.dueDate), settledDate: dmy(r.settledDate) })),
      { totalLabel: 'Total (exceto cancelados)', total: brl(total) });
  }

  if (name === 'fluxo-caixa') {
    const ex = extraConds(req, 3);
    const rows = (await pool.query(
      `WITH d AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS dia)
       SELECT to_char(d.dia,'DD/MM/YYYY') AS dia,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='realizada' AND t.settled_date=d.dia${ex.sql}),0) AS entradas,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='realizada' AND t.settled_date=d.dia${ex.sql}),0) AS saidas,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='pendente' AND t.due_date=d.dia${ex.sql}),0) AS "entradasPrevistas",
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='pendente' AND t.due_date=d.dia${ex.sql}),0) AS "saidasPrevistas"
       FROM d ORDER BY d.dia LIMIT 400`, [from, to, ...ex.params])).rows;
    let acc = 0;
    return out(
      [{ key: 'dia', label: 'Data' }, { key: 'entradas', label: 'Entradas realizadas' }, { key: 'saidas', label: 'Saídas realizadas' }, { key: 'saldo', label: 'Resultado do dia' },
       { key: 'acumulado', label: 'Acumulado no período' }, { key: 'entradasPrevistas', label: 'Entradas previstas' }, { key: 'saidasPrevistas', label: 'Saídas previstas' }],
      rows.filter((r) => Number(r.entradas) || Number(r.saidas) || Number(r.entradasPrevistas) || Number(r.saidasPrevistas)).map((r) => {
        const saldo = Number(r.entradas) - Number(r.saidas); acc += saldo;
        return { dia: r.dia, entradas: brl(r.entradas), saidas: brl(r.saidas), saldo: brl(saldo), acumulado: brl(acc), entradasPrevistas: brl(r.entradasPrevistas), saidasPrevistas: brl(r.saidasPrevistas) };
      }),
      { note: 'Resultado financeiro do período, calculado a partir das baixas registradas. Para o saldo das contas, use "Saldo por conta" ou "Extrato da conta".' });
  }

  if (name === 'resultado') {
    const s = await financeSummary(from, to);
    return out(
      [{ key: 'mes', label: 'Mês' }, { key: 'recebido', label: 'Receitas recebidas' }, { key: 'pago', label: 'Despesas pagas' }, { key: 'saldo', label: 'Resultado realizado' },
       { key: 'receitaPrevista', label: 'Receitas previstas' }, { key: 'despesaPrevista', label: 'Despesas previstas' }, { key: 'saldoPrevisto', label: 'Resultado previsto' }],
      s.monthly.map((m) => ({ mes: m.mes.split('-').reverse().join('/'), recebido: brl(m.recebido), pago: brl(m.pago), saldo: brl(m.saldo), receitaPrevista: brl(m.receitaPrevista), despesaPrevista: brl(m.despesaPrevista), saldoPrevisto: brl(m.receitaPrevista - m.despesaPrevista) })),
      { note: `Previsto = por data de vencimento (exceto cancelados). Realizado = por data efetiva da baixa.${qstr(req, 'accountId') || qstr(req, 'costCenterId') || qstr(req, 'partyId') ? ' Este relatório considera todas as contas, centros de custo e cadastros (os filtros não se aplicam).' : ''}` });
  }

  if (name === 'despesas-categoria' || name === 'receitas-categoria') {
    const type = name === 'despesas-categoria' ? 'despesa' : 'receita';
    const base = cat ? [from, to, type, Number(cat)] : [from, to, type];
    const ex = extraConds(req, base.length + 1);
    const rows = (await pool.query(
      `SELECT c.name AS categoria,
              COALESCE(sum(t.amount) FILTER (WHERE t.status<>'cancelada'),0) AS previsto,
              COALESCE(sum(t.amount) FILTER (WHERE t.status='realizada'),0) AS realizado
         FROM financial_categories c LEFT JOIN financial_transactions t ON t.category_id=c.id AND t.due_date BETWEEN $1 AND $2${ex.sql}
        WHERE c.type=$3 ${cat ? 'AND c.id = $4' : ''} GROUP BY c.name HAVING COALESCE(sum(t.amount) FILTER (WHERE t.status<>'cancelada'),0) > 0 ORDER BY previsto DESC`,
      [...base, ...ex.params])).rows;
    const tot = rows.reduce((a, r) => a + Number(r.previsto), 0) || 1;
    return out([{ key: 'categoria', label: 'Categoria' }, { key: 'previsto', label: 'Total no período (R$)' }, { key: 'realizado', label: type === 'despesa' ? 'Pago (R$)' : 'Recebido (R$)' }, { key: 'pct', label: '% do total' }],
      rows.map((r) => ({ categoria: r.categoria, previsto: brl(r.previsto), realizado: brl(r.realizado), pct: `${((Number(r.previsto) / tot) * 100).toFixed(1).replace('.', ',')}%` })));
  }

  if (name === 'centros-custo') {
    const ex = extraConds(req, 3);
    const rows = (await pool.query(
      `SELECT COALESCE(cc.name, 'Sem centro de custo') AS centro,
              COALESCE(sum(t.amount) FILTER (WHERE t.type='receita'),0) AS receitas,
              COALESCE(sum(t.amount) FILTER (WHERE t.type='despesa'),0) AS despesas
         FROM financial_transactions t LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
        WHERE t.status <> 'cancelada' AND t.due_date BETWEEN $1 AND $2${ex.sql} GROUP BY 1 ORDER BY despesas DESC, receitas DESC`, [from, to, ...ex.params])).rows;
    return out([{ key: 'centro', label: 'Centro de custo' }, { key: 'receitas', label: 'Receitas (R$)' }, { key: 'despesas', label: 'Despesas (R$)' }, { key: 'resultado', label: 'Resultado (R$)' }],
      rows.map((r) => ({ centro: r.centro, receitas: brl(r.receitas), despesas: brl(r.despesas), resultado: brl(Number(r.receitas) - Number(r.despesas)) })),
      { note: 'Por data de vencimento, exceto cancelados.' });
  }

  if (name === 'fluxo-projetado') {
    const days = [30, 60, 90].includes(Number(qstr(req, 'days'))) ? Number(qstr(req, 'days')) : 30;
    const f = await computeCashflow(days, qstr(req, 'accountId') ? Number(qstr(req, 'accountId')) : null);
    const rows = [{ dia: 'Saldo atual', in: '', out: '', saldo: brl(f.opening) },
      ...f.series.filter((x) => x.in || x.out).map((x) => ({ dia: dmy(x.date), in: x.in ? brl(x.in) : '', out: x.out ? brl(x.out) : '', saldo: brl(x.balance) }))];
    return sendReport(req, res, `financeiro-${name}`,
      [{ key: 'dia', label: 'Data' }, { key: 'in', label: 'A receber (R$)' }, { key: 'out', label: 'A pagar (R$)' }, { key: 'saldo', label: 'Saldo projetado (R$)' }], rows,
      { title: `${title} — ${days} dias`, period: { from: f.from, to: f.to }, totalLabel: `Saldo projetado em ${dmy(f.to)}`, total: brl(f.closing),
        note: `Parte do saldo atual das contas${f.accountId ? ' (conta selecionada)' : ' ativas'} e soma contas a receber e a pagar pelo vencimento. Contas já vencidas entram no primeiro dia. ${f.negative ? `Atenção: o saldo fica negativo (mínimo de R$ ${brl(f.lowest.balance)} em ${dmy(f.lowest.date)}).` : ''}` });
  }

  if (name === 'saldo-contas') {
    const rows = (await pool.query(
      `SELECT a.name, a.kind, a.active, a.initial_balance AS inicial,
              COALESCE((SELECT sum(t.amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='realizada' AND ${EFF_ACCOUNT} = a.id AND t.settled_date BETWEEN $1 AND $2),0) AS entradas,
              COALESCE((SELECT sum(t.amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='realizada' AND ${EFF_ACCOUNT} = a.id AND t.settled_date BETWEEN $1 AND $2),0) AS saidas,
              COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.to_account_id = a.id AND x.transfer_date BETWEEN $1 AND $2),0)
                - COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.from_account_id = a.id AND x.transfer_date BETWEEN $1 AND $2),0) AS transf,
              ${BALANCE} AS saldo
         FROM bank_accounts a ${qstr(req, 'accountId') ? 'WHERE a.id = $3' : ''} ORDER BY a.is_default DESC, lower(a.name)`,
      qstr(req, 'accountId') ? [from, to, Number(qstr(req, 'accountId'))] : [from, to])).rows;
    const tot = rows.filter((r) => r.active).reduce((a, r) => a + Number(r.saldo), 0);
    const KIND: Record<string, string> = { corrente: 'Conta corrente', poupanca: 'Poupança', caixa: 'Caixa', cartao: 'Cartão', outra: 'Outra' };
    return out([{ key: 'name', label: 'Conta' }, { key: 'kind', label: 'Tipo' }, { key: 'inicial', label: 'Saldo inicial (R$)' }, { key: 'entradas', label: 'Entradas no período (R$)' },
        { key: 'saidas', label: 'Saídas no período (R$)' }, { key: 'transf', label: 'Transferências no período (R$)' }, { key: 'saldo', label: 'Saldo atual (R$)' }],
      rows.map((r) => ({ name: r.active ? r.name : `${r.name} (inativa)`, kind: KIND[r.kind] ?? r.kind, inicial: brl(r.inicial), entradas: brl(r.entradas), saidas: brl(r.saidas), transf: brl(r.transf), saldo: brl(r.saldo) })),
      { totalLabel: 'Saldo total (contas ativas)', total: brl(tot), note: 'Entradas, saídas e transferências referem-se ao período; o saldo atual considera todo o histórico da conta.' });
  }

  if (name === 'extrato-conta') {
    const accId = Number(qstr(req, 'accountId'));
    if (!accId) throw new HttpError(422, 'Selecione a conta para gerar o extrato.');
    const acc = (await pool.query('SELECT id, name, initial_balance FROM bank_accounts WHERE id=$1', [accId])).rows[0];
    if (!acc) throw new HttpError(404, 'Conta não encontrada');
    const opening = Number((await pool.query(
      `SELECT $2::numeric
         + COALESCE((SELECT sum(CASE WHEN t.type='receita' THEN t.amount ELSE -t.amount END) FROM financial_transactions t WHERE t.status='realizada' AND ${EFF_ACCOUNT} = $1 AND t.settled_date < $3),0)
         + COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.to_account_id = $1 AND x.transfer_date < $3),0)
         - COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.from_account_id = $1 AND x.transfer_date < $3),0) AS s`, [accId, acc.initial_balance, from])).rows[0].s);
    const mv = (await pool.query(
      `SELECT t.settled_date AS d, t.description AS descr, 'Lançamento' AS origem, CASE WHEN t.type='receita' THEN t.amount ELSE 0 END AS entrada, CASE WHEN t.type='despesa' THEN t.amount ELSE 0 END AS saida, t.created_at AS ord
         FROM financial_transactions t WHERE t.status='realizada' AND ${EFF_ACCOUNT} = $1 AND t.settled_date BETWEEN $2 AND $3
       UNION ALL
       SELECT x.transfer_date, CASE WHEN x.to_account_id = $1 THEN 'Transferência recebida de ' || f.name ELSE 'Transferência enviada para ' || tt.name END, 'Transferência',
              CASE WHEN x.to_account_id = $1 THEN x.amount ELSE 0 END, CASE WHEN x.from_account_id = $1 THEN x.amount ELSE 0 END, x.created_at
         FROM bank_transfers x JOIN bank_accounts f ON f.id = x.from_account_id JOIN bank_accounts tt ON tt.id = x.to_account_id
        WHERE (x.from_account_id = $1 OR x.to_account_id = $1) AND x.transfer_date BETWEEN $2 AND $3
       ORDER BY 1, 6 LIMIT 5000`, [accId, from, to])).rows;
    let bal = opening;
    const rows: Record<string, unknown>[] = [{ data: dmy(from), descr: 'Saldo anterior', origem: '', entrada: '', saida: '', saldo: brl(opening) }];
    for (const m of mv) { bal += Number(m.entrada) - Number(m.saida); rows.push({ data: dmy(m.d), descr: m.descr, origem: m.origem, entrada: Number(m.entrada) ? brl(m.entrada) : '', saida: Number(m.saida) ? brl(m.saida) : '', saldo: brl(bal) }); }
    return out([{ key: 'data', label: 'Data' }, { key: 'descr', label: 'Descrição' }, { key: 'origem', label: 'Origem' }, { key: 'entrada', label: 'Entrada (R$)' }, { key: 'saida', label: 'Saída (R$)' }, { key: 'saldo', label: 'Saldo (R$)' }],
      rows, { title: `${title}: ${acc.name}`, totalLabel: `Saldo em ${dmy(to)}`, total: brl(bal) });
  }

  if (name === 'transferencias') {
    const w = new Where().add('x.transfer_date BETWEEN ? AND ?', from, to);
    const acc = qstr(req, 'accountId'); if (acc) w.add('(x.from_account_id = ? OR x.to_account_id = ?)', Number(acc), Number(acc));
    const rows = (await pool.query(
      `SELECT x.transfer_date AS d, f.name AS origem, tt.name AS destino, x.amount, x.description AS descr, x.created_by_name AS por
         FROM bank_transfers x JOIN bank_accounts f ON f.id = x.from_account_id JOIN bank_accounts tt ON tt.id = x.to_account_id ${w.sql} ORDER BY x.transfer_date, x.id LIMIT 5000`, w.params)).rows;
    return out([{ key: 'data', label: 'Data' }, { key: 'origem', label: 'Conta de origem' }, { key: 'destino', label: 'Conta de destino' }, { key: 'valor', label: 'Valor (R$)' }, { key: 'descr', label: 'Descrição' }, { key: 'por', label: 'Registrada por' }],
      rows.map((r) => ({ data: dmy(r.d), origem: r.origem, destino: r.destino, valor: brl(r.amount), descr: r.descr, por: r.por })),
      { totalLabel: 'Total transferido', total: brl(rows.reduce((a, r) => a + Number(r.amount), 0)), note: 'Transferências não alteram o saldo total, apenas movem valores entre contas.' });
  }

  if (name === 'conciliacao') {
    const w = new Where().add('l.posted_date BETWEEN ? AND ?', from, to);
    const acc = qstr(req, 'accountId'); if (acc) w.add('l.account_id = ?', Number(acc));
    const ls = qstr(req, 'lineStatus'); if (ls && ['pendente', 'conciliado', 'ignorado'].includes(ls)) w.add('l.status = ?', ls);
    const rows = (await pool.query(
      `SELECT l.posted_date AS d, a.name AS conta, l.memo, l.amount, l.status, t.description AS lanc
         FROM bank_statement_lines l JOIN bank_accounts a ON a.id = l.account_id LEFT JOIN financial_transactions t ON t.id = l.transaction_id ${w.sql} ORDER BY l.posted_date, l.id LIMIT 5000`, w.params)).rows;
    const LS: Record<string, string> = { pendente: 'Pendente', conciliado: 'Conciliada', ignorado: 'Ignorada' };
    const pend = rows.filter((r) => r.status === 'pendente').length;
    return out([{ key: 'data', label: 'Data' }, { key: 'conta', label: 'Conta' }, { key: 'memo', label: 'Descrição no extrato' }, { key: 'valor', label: 'Valor (R$)' }, { key: 'situacao', label: 'Situação' }, { key: 'lanc', label: 'Lançamento vinculado' }],
      rows.map((r) => ({ data: dmy(r.d), conta: r.conta, memo: r.memo, valor: brl(r.amount), situacao: LS[r.status], lanc: r.lanc })),
      { totalLabel: 'Linhas pendentes', total: String(pend) });
  }

  if (name === 'por-cadastro') {
    const ex = extraConds(req, 3);
    const rows = (await pool.query(
      `SELECT COALESCE(p.name, '(sem cadastro: texto livre ou vazio)') AS nome,
              COALESCE(sum(t.amount) FILTER (WHERE t.type='receita'),0) AS receitas, COALESCE(sum(t.amount) FILTER (WHERE t.type='receita' AND t.status='realizada'),0) AS recebido,
              COALESCE(sum(t.amount) FILTER (WHERE t.type='despesa'),0) AS despesas, COALESCE(sum(t.amount) FILTER (WHERE t.type='despesa' AND t.status='realizada'),0) AS pago
         FROM financial_transactions t LEFT JOIN parties p ON p.id = t.party_id
        WHERE t.status <> 'cancelada' AND t.due_date BETWEEN $1 AND $2${ex.sql} GROUP BY 1 ORDER BY (count(p.id) = 0), nome`, [from, to, ...ex.params])).rows;
    return out([{ key: 'nome', label: 'Cliente / fornecedor' }, { key: 'receitas', label: 'Receitas previstas (R$)' }, { key: 'recebido', label: 'Recebido (R$)' }, { key: 'despesas', label: 'Despesas previstas (R$)' }, { key: 'pago', label: 'Pago (R$)' }, { key: 'resultado', label: 'Resultado previsto (R$)' }],
      rows.map((r) => ({ nome: r.nome, receitas: brl(r.receitas), recebido: brl(r.recebido), despesas: brl(r.despesas), pago: brl(r.pago), resultado: brl(Number(r.receitas) - Number(r.despesas)) })),
      { note: 'Por data de vencimento, exceto cancelados. Lançamentos antigos ou com texto livre aparecem em "sem cadastro".' });
  }

  // historico de movimentações (baixas)
  const hbase = cat ? [from, to, Number(cat)] : [from, to];
  const hex = extraConds(req, hbase.length + 1);
  const rows = (await pool.query(
    `SELECT to_char(p.effective_date,'DD/MM/YYYY') AS data, t.type, t.description, c.name AS category, p.amount, p.method, p.user_name AS "userName",
            COALESCE(ba.name, (SELECT name FROM bank_accounts WHERE is_default)) AS account, cc.name AS "costCenter",
            to_char(p.created_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') AS registrado
       FROM payment_records p JOIN financial_transactions t ON t.id=p.transaction_id JOIN financial_categories c ON c.id=t.category_id
       LEFT JOIN bank_accounts ba ON ba.id = t.account_id LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
      WHERE p.effective_date BETWEEN $1 AND $2 ${cat ? 'AND t.category_id = $3' : ''}${hex.sql} ORDER BY p.effective_date DESC, p.id DESC LIMIT 5000`,
    [...hbase, ...hex.params])).rows;
  out([{ key: 'data', label: 'Data efetiva' }, { key: 'tipo', label: 'Tipo' }, { key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'costCenter', label: 'Centro de custo' }, { key: 'account', label: 'Conta' }, { key: 'valor', label: 'Valor (R$)' },
       { key: 'method', label: 'Forma' }, { key: 'userName', label: 'Responsável' }, { key: 'registrado', label: 'Registrado em' }],
    rows.map((r) => ({ ...r, tipo: r.type === 'receita' ? 'Recebimento' : 'Pagamento', valor: brl(r.amount) })));
}));
