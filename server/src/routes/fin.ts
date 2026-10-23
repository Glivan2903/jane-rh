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
import { HttpError, Where, h, likeEsc, listParams, money, optDate, optStr, parse, qstr, reqDate, reqStr, sendReport, today } from '../util.js';
import { EFF, TODAY_SQL, financeSummary } from '../services/finance.js';
import { getSettings } from '../services/settings.js';

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

// ---------- Lançamentos ----------
const txSchema = z.object({
  type: z.enum(['receita', 'despesa']),
  description: reqStr(200, 'Informe a descrição'),
  categoryId: z.coerce.number({ invalid_type_error: 'Selecione a categoria' }).int().positive('Selecione a categoria'),
  party: optStr(200),
  amount: money,
  competenceDate: reqDate,
  dueDate: reqDate,
  method: z.preprocess((v) => (v === '' ? null : v), z.enum(METHODS as [string, ...string[]]).nullable().optional()),
  notes: optStr(1000),
  repeatMonths: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(2, 'Mínimo 2 parcelas').max(60, 'Máximo 60').optional()),
  settledDate: optDate, // preenchido = já nasce paga/recebida
});

const TX_SELECT = `t.id, t.type, t.description, t.category_id AS "categoryId", c.name AS category, t.party, t.amount, t.competence_date AS "competenceDate",
  t.due_date AS "dueDate", t.settled_date AS "settledDate", t.method, t.status AS "storedStatus", ${EFF} AS status, t.notes,
  t.attachment_name AS "attachmentName", t.series_id AS "seriesId", t.created_at AS "createdAt"`;
const TX_FROM = `FROM financial_transactions t JOIN financial_categories c ON c.id = t.category_id`;

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
    const n = d.repeatMonths ?? 1;
    const series = n > 1 ? crypto.randomUUID() : null;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const desc = n > 1 ? `${d.description} (${i + 1}/${n})` : d.description;
      const row = (await c.query(
        `INSERT INTO financial_transactions (type, description, category_id, party, amount, competence_date, due_date, settled_date, method, status, notes, series_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [d.type, desc, d.categoryId, d.party ?? null, d.amount, addMonths(d.competenceDate, i), addMonths(d.dueDate, i), d.settledDate ?? null, d.method ?? null,
         d.settledDate ? 'realizada' : 'pendente', d.notes ?? null, series, req.user!.id])).rows[0];
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
    if (cur.status === 'realizada') {
      // lançamento baixado: valores e datas ficam travados (preservam a baixa)
      if (Number(cur.amount) !== d.amount || cur.due_date !== d.dueDate || cur.competence_date !== d.competenceDate)
        throw new HttpError(409, 'Lançamento já baixado: valor e datas não podem ser alterados.');
      await c.query('UPDATE financial_transactions SET description=$2, category_id=$3, party=$4, notes=$5, updated_at=now() WHERE id=$1', [req.params.id, d.description, d.categoryId, d.party ?? null, d.notes ?? null]);
    } else {
      await c.query(`UPDATE financial_transactions SET description=$2, category_id=$3, party=$4, amount=$5, competence_date=$6, due_date=$7, method=$8, notes=$9, updated_at=now() WHERE id=$1`,
        [req.params.id, d.description, d.categoryId, d.party ?? null, d.amount, d.competenceDate, d.dueDate, d.method ?? null, d.notes ?? null]);
    }
    const diffs = [Number(cur.amount) !== d.amount && 'valor', cur.due_date !== d.dueDate && 'vencimento', cur.category_id !== d.categoryId && 'categoria'].filter(Boolean);
    await audit(req, { action: 'editar', module: 'financeiro', entity: 'transaction', entityId: req.params.id, summary: `Lançamento editado: ${d.description}`, details: { campos: diffs, valorAnterior: cur.amount, valorNovo: d.amount, vencimentoAnterior: cur.due_date, vencimentoNovo: d.dueDate } }, c);
  });
  res.json({ ok: true });
}));

// Baixa: a linha é travada e payment_records.transaction_id é UNIQUE → impossível baixar duas vezes.
finRouter.post('/transactions/:id/settle', requireAuth('fin.settle'), h(async (req, res) => {
  const d = parse(z.object({ effectiveDate: reqDate, method: z.preprocess((v) => (v === '' ? null : v), z.enum(METHODS as [string, ...string[]]).nullable().optional()) }), req.body);
  if (d.effectiveDate > today()) throw new HttpError(422, 'Data efetiva não pode ser futura', { effectiveDate: 'Data efetiva não pode ser futura' });
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado');
    if (cur.status === 'realizada') throw new HttpError(409, `Este lançamento já foi ${cur.type === 'receita' ? 'recebido' : 'pago'}.`);
    if (cur.status === 'cancelada') throw new HttpError(409, 'Lançamento cancelado não pode ser baixado.');
    const method = d.method ?? cur.method;
    await c.query(`INSERT INTO payment_records (transaction_id, amount, effective_date, method, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [cur.id, cur.amount, d.effectiveDate, method, req.user!.id, req.user!.name]);
    await c.query(`UPDATE financial_transactions SET status='realizada', settled_date=$2, method=$3, updated_at=now() WHERE id=$1`, [cur.id, d.effectiveDate, method]);
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
  'despesas-categoria': 'Despesas por categoria', 'receitas-categoria': 'Receitas por categoria', historico: 'Histórico de movimentações',
};
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
    const rows = (await pool.query(`SELECT ${TX_SELECT} ${TX_FROM} ${w.sql} ORDER BY t.due_date, t.id LIMIT 5000`, w.params)).rows;
    const total = rows.filter((r) => r.status !== 'cancelada').reduce((a, r) => a + Number(r.amount), 0);
    return out(
      [{ key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'party', label: 'Origem/Fornecedor' }, { key: 'amount', label: 'Valor (R$)' },
       { key: 'dueDate', label: 'Vencimento' }, { key: 'settledDate', label: 'Data efetiva' }, { key: 'method', label: 'Forma' }, { key: 'status', label: 'Situação' }],
      rows.map((r) => ({ ...r, amount: brl(r.amount), dueDate: dmy(r.dueDate), settledDate: dmy(r.settledDate) })),
      { totalLabel: 'Total (exceto cancelados)', total: brl(total) });
  }

  if (name === 'fluxo-caixa') {
    const rows = (await pool.query(
      `WITH d AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS dia)
       SELECT to_char(d.dia,'DD/MM/YYYY') AS dia,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='realizada' AND t.settled_date=d.dia),0) AS entradas,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='realizada' AND t.settled_date=d.dia),0) AS saidas,
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='pendente' AND t.due_date=d.dia),0) AS "entradasPrevistas",
         COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='pendente' AND t.due_date=d.dia),0) AS "saidasPrevistas"
       FROM d ORDER BY d.dia LIMIT 400`, [from, to])).rows;
    let acc = 0;
    return out(
      [{ key: 'dia', label: 'Data' }, { key: 'entradas', label: 'Entradas realizadas' }, { key: 'saidas', label: 'Saídas realizadas' }, { key: 'saldo', label: 'Resultado do dia' },
       { key: 'acumulado', label: 'Acumulado no período' }, { key: 'entradasPrevistas', label: 'Entradas previstas' }, { key: 'saidasPrevistas', label: 'Saídas previstas' }],
      rows.filter((r) => Number(r.entradas) || Number(r.saidas) || Number(r.entradasPrevistas) || Number(r.saidasPrevistas)).map((r) => {
        const saldo = Number(r.entradas) - Number(r.saidas); acc += saldo;
        return { dia: r.dia, entradas: brl(r.entradas), saidas: brl(r.saidas), saldo: brl(saldo), acumulado: brl(acc), entradasPrevistas: brl(r.entradasPrevistas), saidasPrevistas: brl(r.saidasPrevistas) };
      }),
      { note: 'Resultado financeiro do período, calculado a partir das baixas registradas. Não representa saldo bancário.' });
  }

  if (name === 'resultado') {
    const s = await financeSummary(from, to);
    return out(
      [{ key: 'mes', label: 'Mês' }, { key: 'recebido', label: 'Receitas recebidas' }, { key: 'pago', label: 'Despesas pagas' }, { key: 'saldo', label: 'Resultado realizado' },
       { key: 'receitaPrevista', label: 'Receitas previstas' }, { key: 'despesaPrevista', label: 'Despesas previstas' }, { key: 'saldoPrevisto', label: 'Resultado previsto' }],
      s.monthly.map((m) => ({ mes: m.mes.split('-').reverse().join('/'), recebido: brl(m.recebido), pago: brl(m.pago), saldo: brl(m.saldo), receitaPrevista: brl(m.receitaPrevista), despesaPrevista: brl(m.despesaPrevista), saldoPrevisto: brl(m.receitaPrevista - m.despesaPrevista) })),
      { note: 'Previsto = por data de vencimento (exceto cancelados). Realizado = por data efetiva da baixa.' });
  }

  if (name === 'despesas-categoria' || name === 'receitas-categoria') {
    const type = name === 'despesas-categoria' ? 'despesa' : 'receita';
    const rows = (await pool.query(
      `SELECT c.name AS categoria,
              COALESCE(sum(t.amount) FILTER (WHERE t.status<>'cancelada'),0) AS previsto,
              COALESCE(sum(t.amount) FILTER (WHERE t.status='realizada'),0) AS realizado
         FROM financial_categories c LEFT JOIN financial_transactions t ON t.category_id=c.id AND t.due_date BETWEEN $1 AND $2
        WHERE c.type=$3 ${cat ? 'AND c.id = $4' : ''} GROUP BY c.name HAVING COALESCE(sum(t.amount) FILTER (WHERE t.status<>'cancelada'),0) > 0 ORDER BY previsto DESC`,
      cat ? [from, to, type, Number(cat)] : [from, to, type])).rows;
    const tot = rows.reduce((a, r) => a + Number(r.previsto), 0) || 1;
    return out([{ key: 'categoria', label: 'Categoria' }, { key: 'previsto', label: 'Total no período (R$)' }, { key: 'realizado', label: type === 'despesa' ? 'Pago (R$)' : 'Recebido (R$)' }, { key: 'pct', label: '% do total' }],
      rows.map((r) => ({ categoria: r.categoria, previsto: brl(r.previsto), realizado: brl(r.realizado), pct: `${((Number(r.previsto) / tot) * 100).toFixed(1).replace('.', ',')}%` })));
  }

  // historico de movimentações (baixas)
  const rows = (await pool.query(
    `SELECT to_char(p.effective_date,'DD/MM/YYYY') AS data, t.type, t.description, c.name AS category, p.amount, p.method, p.user_name AS "userName",
            to_char(p.created_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') AS registrado
       FROM payment_records p JOIN financial_transactions t ON t.id=p.transaction_id JOIN financial_categories c ON c.id=t.category_id
      WHERE p.effective_date BETWEEN $1 AND $2 ${cat ? 'AND t.category_id = $3' : ''} ORDER BY p.effective_date DESC, p.id DESC LIMIT 5000`,
    cat ? [from, to, Number(cat)] : [from, to])).rows;
  out([{ key: 'data', label: 'Data efetiva' }, { key: 'tipo', label: 'Tipo' }, { key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'valor', label: 'Valor (R$)' },
       { key: 'method', label: 'Forma' }, { key: 'userName', label: 'Responsável' }, { key: 'registrado', label: 'Registrado em' }],
    rows.map((r) => ({ ...r, tipo: r.type === 'receita' ? 'Recebimento' : 'Pagamento', valor: brl(r.amount) })));
}));
