import { Router, type Request } from 'express';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, h, qstr } from '../util.js';
import { ensureFreshScan, runScan } from '../services/anomalies.js';

export const anomaliesRouter = Router();

const AREA_PERM: Record<string, string> = { fin: 'fin.view', est: 'est.view', rh: 'rh.view' };
const areasOf = (req: Request) => Object.keys(AREA_PERM).filter((a) => hasPerm(req, AREA_PERM[a]));

/** Cada pessoa vê só os alertas das áreas que pode consultar. */
anomaliesRouter.get('/', requireAuth(), h(async (req, res) => {
  const areas = areasOf(req);
  if (!areas.length) throw new HttpError(403, 'Sem permissão para ver alertas.');
  await ensureFreshScan(6, true);
  const status = qstr(req, 'status') ?? 'aberto';
  const area = qstr(req, 'area');
  const rows = (await pool.query(
    `SELECT id, kind, area, severity, title, detail, link, status, first_seen AS "firstSeen", last_seen AS "lastSeen", dismissed_by AS "dismissedBy", dismissed_at AS "dismissedAt"
       FROM anomalies WHERE area = ANY($1) AND ($2::text = 'todos' OR status = $2) AND ($3::text IS NULL OR area = $3)
      ORDER BY (severity = 'alerta') DESC, last_seen DESC, id DESC LIMIT 300`, [areas, status, area ?? null])).rows;
  const lastScan = (await pool.query(`SELECT value FROM settings WHERE key='anomaly_last_scan'`)).rows[0]?.value ?? null;
  res.json({ rows, areas, lastScan });
}));

anomaliesRouter.post('/scan', requireAuth('cfg.settings'), h(async (req, res) => {
  const r = await runScan();
  await audit(req, { action: 'verificar', module: 'config', entity: 'anomaly', summary: `Verificação de alertas: ${r.abertos} aberto(s), ${r.novos} novo(s), ${r.resolvidos} resolvido(s)` });
  res.json(r);
}));

async function change(req: Request, to: 'dispensado' | 'aberto') {
  const a = (await pool.query('SELECT id, area, title, status FROM anomalies WHERE id = $1', [req.params.id])).rows[0];
  if (!a || !hasPerm(req, AREA_PERM[a.area])) throw new HttpError(404, 'Alerta não encontrado');
  if (a.status === 'resolvido') throw new HttpError(409, 'Este alerta já foi resolvido.');
  await pool.query(`UPDATE anomalies SET status=$2, dismissed_by=$3, dismissed_at=$4 WHERE id=$1`, [a.id, to, to === 'dispensado' ? req.user!.name : null, to === 'dispensado' ? new Date() : null]);
  await audit(req, { action: to === 'dispensado' ? 'dispensar' : 'reabrir', module: 'alertas', entity: 'anomaly', entityId: a.id, summary: `Alerta ${to === 'dispensado' ? 'dispensado' : 'reaberto'}: ${a.title}` });
}
anomaliesRouter.post('/:id/dismiss', requireAuth(), h(async (req, res) => { await change(req, 'dispensado'); res.json({ ok: true }); }));
anomaliesRouter.post('/:id/reopen', requireAuth(), h(async (req, res) => { await change(req, 'aberto'); res.json({ ok: true }); }));
