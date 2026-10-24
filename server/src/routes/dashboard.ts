import { Router } from 'express';
import { pool } from '../db.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, h, qstr, today } from '../util.js';
import { hrSummary } from '../services/hr.js';
import { financeSummary } from '../services/finance.js';
import { stockSummary } from '../services/stock.js';
import { getSettings } from '../services/settings.js';
import { TODAY_SQL } from '../services/finance.js';
import { DOC_STATUS } from '../services/docs.js';

export const dashboardRouter = Router();

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

export function resolvePeriod(preset: string | undefined, qf?: string, qt?: string) {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (preset) {
    case 'hoje': return { from: t, to: t, preset };
    case '7d': return { from: addDays(t, -6), to: t, preset };
    case 'mes_anterior': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastDay(py, pm)}`, preset }; }
    case 'ano': return { from: `${y}-01-01`, to: `${y}-12-31`, preset };
    case 'custom': {
      if (!qf || !qt || !/^\d{4}-\d{2}-\d{2}$/.test(qf) || !/^\d{4}-\d{2}-\d{2}$/.test(qt) || qf > qt) throw new HttpError(422, 'Período personalizado inválido');
      if (Date.parse(qt) - Date.parse(qf) > 5 * 366 * 86400_000) throw new HttpError(422, 'Período máximo de 5 anos');
      return { from: qf, to: qt, preset };
    }
    default: return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}`, preset: 'mes' };
  }
}

dashboardRouter.get('/', requireAuth('dash.view'), h(async (req, res) => {
  const period = resolvePeriod(qstr(req, 'period'), qstr(req, 'from'), qstr(req, 'to'));
  const out: Record<string, unknown> = { period };
  const jobs: Promise<void>[] = [];
  if (hasPerm(req, 'rh.view')) jobs.push(hrSummary(period.from, period.to).then((v) => { out.rh = v; }));
  if (hasPerm(req, 'fin.view')) jobs.push(financeSummary(period.from, period.to).then((v) => { out.financeiro = v; }));
  if (hasPerm(req, 'est.view')) jobs.push(stockSummary(period.from, period.to).then((v) => { out.estoque = v; }));
  const mods = ['auth-none', ...(hasPerm(req, 'rh.view') ? ['rh'] : []), ...(hasPerm(req, 'fin.view') ? ['financeiro'] : []), ...(hasPerm(req, 'est.view') ? ['estoque'] : []), ...(hasPerm(req, 'cfg.audit') ? ['config'] : [])];
  jobs.push(pool.query(
    `SELECT id, at, user_name AS "userName", module, action, summary FROM audit_logs
      WHERE module = ANY($1) AND result='sucesso' AND action NOT IN ('exportar','login','logout','download_backup','verificar_backup') ORDER BY id DESC LIMIT 15`, [mods])
    .then((r) => { out.atividades = r.rows; }));
  await Promise.all(jobs);
  res.json(out);
}));

// Avisos do sino (calculados no servidor conforme as preferências em Configurações → Parâmetros).
dashboardRouter.get('/notices', requireAuth(), h(async (req, res) => {
  const st = await getSettings();
  const out: { id: string; text: string; to: string; tone: 'danger' | 'warning' }[] = [];
  const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (st.notify_stock_enabled && hasPerm(req, 'est.view')) {
    const r = (await pool.query(`SELECT count(*) FILTER (WHERE quantity <= 0)::int zero, count(*) FILTER (WHERE quantity > 0 AND quantity <= min_stock)::int low FROM products WHERE active AND min_stock IS NOT NULL`)).rows[0];
    if (r.zero) out.push({ id: 'z', text: `${r.zero} produto(s) sem estoque`, to: '/estoque?stockStatus=sem_estoque', tone: 'danger' });
    if (r.low) out.push({ id: 'l', text: `${r.low} produto(s) abaixo do estoque mínimo`, to: '/estoque?stockStatus=baixo', tone: 'warning' });
  }
  if (hasPerm(req, 'fin.view')) {
    const types = st.notify_receivables ? ['despesa', 'receita'] : ['despesa'];
    if (st.notify_overdue_enabled) {
      const r = (await pool.query(`SELECT type, count(*)::int n, COALESCE(sum(amount),0) total FROM financial_transactions WHERE status='pendente' AND due_date < ${TODAY_SQL} AND type = ANY($1) GROUP BY type`, [types])).rows;
      for (const x of r) out.push({ id: `v-${x.type}`, text: `${x.n} conta(s) ${x.type === 'despesa' ? 'a pagar' : 'a receber'} vencida(s): ${brl(x.total)}`, to: `/financeiro/${x.type === 'despesa' ? 'despesas' : 'receitas'}?status=vencida`, tone: 'danger' });
    }
    if (st.notify_bills_enabled) {
      const r = (await pool.query(`SELECT type, count(*)::int n, COALESCE(sum(amount),0) total FROM financial_transactions WHERE status='pendente' AND due_date BETWEEN ${TODAY_SQL} AND ${TODAY_SQL} + $1::int AND type = ANY($2) GROUP BY type`, [st.notify_bills_days, types])).rows;
      for (const x of r) out.push({ id: `p-${x.type}`, text: `${x.n} conta(s) ${x.type === 'despesa' ? 'a pagar' : 'a receber'} vence(m) em até ${st.notify_bills_days} dia(s): ${brl(x.total)}`, to: `/financeiro/${x.type === 'despesa' ? 'despesas' : 'receitas'}`, tone: 'warning' });
    }
  }
  if (st.notify_docs_enabled && hasPerm(req, 'rh.documents')) {
    const r = (await pool.query(
      `SELECT count(*) FILTER (WHERE s = 'vencido')::int AS venc, count(*) FILTER (WHERE s = 'a_vencer')::int AS breve
         FROM (SELECT ${DOC_STATUS} AS s FROM employee_documents d JOIN employee_document_types t ON t.id = d.type_id JOIN employees e ON e.id = d.employee_id WHERE e.status <> 'desligado') x`)).rows[0];
    if (r.venc) out.push({ id: 'doc-v', text: `${r.venc} documento(s) de funcionários vencido(s)`, to: '/rh/documentos?status=vencido', tone: 'danger' });
    if (r.breve) out.push({ id: 'doc-b', text: `${r.breve} documento(s) de funcionários a vencer`, to: '/rh/documentos?status=a_vencer', tone: 'warning' });
  }
  res.json({ refreshMinutes: st.notify_refresh_minutes, notices: out });
}));
