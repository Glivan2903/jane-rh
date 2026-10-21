import { Router } from 'express';
import { pool } from '../db.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, h, qstr, today } from '../util.js';
import { hrSummary } from '../services/hr.js';
import { financeSummary } from '../services/finance.js';
import { stockSummary } from '../services/stock.js';

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
