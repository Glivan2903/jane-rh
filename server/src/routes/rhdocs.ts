import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { TODAY_SQL } from '../services/finance.js';
import { DOC_STATUS } from '../services/docs.js';
import { HttpError, Where, h, likeEsc, listParams, optDate, optInt, optStr, parse, qstr, reqInt, reqStr } from '../util.js';

export const rhDocsRouter = Router();
const PERM = 'rh.documents';

/* ------------------------------------------------ aniversários e tempo de casa ------------------------------------------------ */
/** Próxima ocorrência (a partir de hoje, inclusive) de uma data anual. `col` é uma coluna DATE. */
const NEXT = (col: string) => `(CASE WHEN ${col} + extract(year FROM age(${TODAY_SQL}, ${col}))::int * interval '1 year' >= ${TODAY_SQL}
  THEN ${col} + extract(year FROM age(${TODAY_SQL}, ${col}))::int * interval '1 year'
  ELSE ${col} + (extract(year FROM age(${TODAY_SQL}, ${col}))::int + 1) * interval '1 year' END)::date`;

rhDocsRouter.get('/celebrations', requireAuth('rh.view'), h(async (req, res) => {
  const today = (await pool.query(`SELECT ${TODAY_SQL}::text AS d`)).rows[0].d as string;
  const month = Math.min(12, Math.max(1, Number(qstr(req, 'month')) || Number(today.slice(5, 7))));
  const year = Number(today.slice(0, 4));
  const birthdays = (await pool.query(
    `SELECT e.id, e.full_name AS name, d.name AS department, extract(day FROM e.birth_date)::int AS day, ($2::int - extract(year FROM e.birth_date)::int) AS turns,
            (to_char(e.birth_date,'MM-DD') = to_char(${TODAY_SQL},'MM-DD')) AS "isToday", (e.status = 'pre_cadastro') AS pending
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status IN ('ativo','pre_cadastro') AND e.birth_date IS NOT NULL AND extract(month FROM e.birth_date) = $1 ORDER BY day, lower(e.full_name)`, [month, year])).rows;
  const work = (await pool.query(
    `SELECT e.id, e.full_name AS name, d.name AS department, extract(day FROM e.admission_date)::int AS day, ($2::int - extract(year FROM e.admission_date)::int) AS years,
            e.admission_date::text AS "admissionDate", (to_char(e.admission_date,'MM-DD') = to_char(${TODAY_SQL},'MM-DD')) AS "isToday"
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'ativo' AND e.admission_date IS NOT NULL AND extract(month FROM e.admission_date) = $1 AND ($2::int - extract(year FROM e.admission_date)::int) >= 1
      ORDER BY day, lower(e.full_name)`, [month, year])).rows;
  // próximos 30 dias, atravessando a virada de mês/ano, com os dois tipos misturados em ordem de data
  const upcoming = (await pool.query(
    `SELECT * FROM (
       SELECT e.id, e.full_name AS name, d.name AS department, 'aniversario' AS kind, ${NEXT('e.birth_date')} AS date,
              (extract(year FROM ${NEXT('e.birth_date')}) - extract(year FROM e.birth_date))::int AS number, (e.status = 'pre_cadastro') AS pending
         FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status IN ('ativo','pre_cadastro') AND e.birth_date IS NOT NULL
       UNION ALL
       SELECT e.id, e.full_name, d.name, 'tempo_de_casa', ${NEXT('e.admission_date')},
              (extract(year FROM ${NEXT('e.admission_date')}) - extract(year FROM e.admission_date))::int, false
         FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status = 'ativo' AND e.admission_date IS NOT NULL
     ) x WHERE x.date <= ${TODAY_SQL} + 30 AND (x.kind = 'aniversario' OR x.number >= 1) ORDER BY x.date, lower(x.name)`)).rows
    .map((r) => ({ ...r, date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date, daysLeft: Math.round((Date.parse(`${(r.date instanceof Date ? r.date.toISOString() : String(r.date)).slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) }));
  res.json({ month, year, today, birthdays, workAnniversaries: work, upcoming });
}));

/* ------------------------------------------------------ tipos de documento ------------------------------------------------------ */
const typeSchema = z.object({
  name: reqStr(100, 'Informe o nome'), requiresExpiry: z.boolean().default(true),
  alertDays: z.coerce.number().int().min(0, 'Mínimo 0').max(365, 'Máximo 365').default(30), active: z.boolean().default(true),
});

rhDocsRouter.get('/document-types', requireAuth('rh.view', PERM), h(async (req, res) => {
  const where = req.query.active === 'true' ? 'WHERE t.active' : '';
  res.json((await pool.query(
    `SELECT t.id, t.name, t.requires_expiry AS "requiresExpiry", t.alert_days AS "alertDays", t.active, (SELECT count(*)::int FROM employee_documents d WHERE d.type_id = t.id) AS "usageCount"
       FROM employee_document_types t ${where} ORDER BY lower(t.name)`)).rows);
}));
const dupType = (e: unknown): never => { if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Já existe um tipo com este nome', { name: 'Já cadastrado' }); throw e; };
rhDocsRouter.post('/document-types', requireAuth(PERM), h(async (req, res) => {
  const d = parse(typeSchema, req.body);
  try {
    const id = (await pool.query('INSERT INTO employee_document_types (name, requires_expiry, alert_days, active) VALUES ($1,$2,$3,$4) RETURNING id', [d.name, d.requiresExpiry, d.alertDays, d.active])).rows[0].id;
    await audit(req, { action: 'criar', module: 'rh', entity: 'document_type', entityId: id, summary: `Tipo de documento criado: ${d.name}` });
    res.status(201).json({ id });
  } catch (e) { dupType(e); }
}));
rhDocsRouter.put('/document-types/:id', requireAuth(PERM), h(async (req, res) => {
  const d = parse(typeSchema, req.body);
  try {
    const r = await pool.query('UPDATE employee_document_types SET name=$2, requires_expiry=$3, alert_days=$4, active=$5 WHERE id=$1', [req.params.id, d.name, d.requiresExpiry, d.alertDays, d.active]);
    if (!r.rowCount) throw new HttpError(404, 'Tipo não encontrado');
  } catch (e) { dupType(e); }
  await audit(req, { action: 'editar', module: 'rh', entity: 'document_type', entityId: req.params.id, summary: `Tipo de documento editado: ${d.name}` });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------ documentos ------------------------------------------------------------ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

/** Confere o conteúdo real do arquivo (não confia na extensão nem no tipo informado pelo navegador). */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

const docSchema = z.object({ typeId: reqInt, title: optStr(120), issueDate: optDate, expiresAt: optDate, notes: optStr(500), removeFile: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional() });
const COLS = `d.id, d.employee_id AS "employeeId", e.full_name AS "employeeName", e.status AS "employeeStatus", d.type_id AS "typeId", t.name AS type, d.title,
  d.issue_date::text AS "issueDate", d.expires_at::text AS "expiresAt", d.notes, d.file_name AS "fileName", d.file_size AS "fileSize", ${DOC_STATUS} AS status,
  CASE WHEN d.expires_at IS NULL THEN NULL ELSE (d.expires_at - ${TODAY_SQL})::int END AS "daysLeft", t.alert_days AS "alertDays"`;
const FROM = `FROM employee_documents d JOIN employee_document_types t ON t.id = d.type_id JOIN employees e ON e.id = d.employee_id`;

async function validate(typeId: number, issueDate: string | null | undefined, expiresAt: string | null | undefined, keepTypeId?: number) {
  const t = (await pool.query('SELECT requires_expiry, active FROM employee_document_types WHERE id=$1', [typeId])).rows[0];
  if (!t || (!t.active && typeId !== keepTypeId)) throw new HttpError(422, 'Tipo de documento inválido ou inativo', { typeId: 'Tipo inválido ou inativo' });
  if (t.requires_expiry && !expiresAt) throw new HttpError(422, 'Informe a data de validade', { expiresAt: 'Este tipo exige validade' });
  if (issueDate && expiresAt && expiresAt < issueDate) throw new HttpError(422, 'A validade não pode ser anterior à emissão', { expiresAt: 'Anterior à emissão' });
}

// Resumo para o RH e para o sino.
rhDocsRouter.get('/documents/summary', requireAuth(PERM), h(async (_req, res) => {
  const r = (await pool.query(
    `SELECT count(*) FILTER (WHERE s = 'vencido')::int AS "vencidos", count(*) FILTER (WHERE s = 'a_vencer')::int AS "aVencer", count(*)::int AS total
       FROM (SELECT ${DOC_STATUS} AS s ${FROM} WHERE e.status <> 'desligado') x`)).rows[0];
  res.json(r);
}));

rhDocsRouter.get('/documents', requireAuth(PERM), h(async (req, res) => {
  const p = listParams(req, { expiresAt: 'd.expires_at', employee: 'lower(e.full_name)', type: 'lower(t.name)' }, 'expiresAt');
  const w = new Where();
  const st = qstr(req, 'status') ?? 'atencao';
  if (st === 'atencao') w.add(`${DOC_STATUS} IN ('vencido','a_vencer')`); else if (st !== 'todos') w.add(`${DOC_STATUS} = ?`, st);
  const es = qstr(req, 'employeeStatus') ?? 'ativos';
  if (es === 'ativos') w.add(`e.status <> 'desligado'`); else if (es !== 'todos') w.add('e.status = ?', es);
  const type = qstr(req, 'typeId'); if (type) w.add('d.type_id = ?', Number(type));
  const emp = qstr(req, 'employeeId'); if (emp) w.add('d.employee_id = ?', emp);
  if (p.q) w.add('(e.full_name ILIKE ? OR t.name ILIKE ? OR d.title ILIKE ?)', likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const total = (await pool.query(`SELECT count(*)::int n ${FROM} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${COLS} ${FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir} NULLS LAST, lower(e.full_name), d.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

rhDocsRouter.get('/employees/:id/documents', requireAuth(PERM), h(async (req, res) => {
  res.json((await pool.query(`SELECT ${COLS} ${FROM} WHERE d.employee_id = $1 ORDER BY d.expires_at NULLS LAST, t.name`, [req.params.id])).rows);
}));

async function saveFile(c: { query: typeof pool.query }, id: string, file: Express.Multer.File | undefined) {
  if (!file) return;
  const kind = sniff(file.buffer);
  if (!kind) throw new HttpError(422, 'Envie um arquivo PDF, PNG ou JPG válido.', { file: 'Formato não aceito' });
  const name = (file.originalname.replace(/\.[^.]*$/, '').replace(/[^\w\-. ]+/g, '_').slice(0, 80) || 'documento') + '.' + kind.ext;
  await c.query('UPDATE employee_documents SET file_name=$2, file_mime=$3, file_size=$4 WHERE id=$1', [id, name, kind.mime, file.size]);
  await c.query('INSERT INTO employee_document_files (document_id, data) VALUES ($1,$2) ON CONFLICT (document_id) DO UPDATE SET data = EXCLUDED.data', [id, file.buffer]);
}

rhDocsRouter.post('/employees/:id/documents', requireAuth(PERM), upload.single('file'), h(async (req, res) => {
  const d = parse(docSchema, req.body);
  const emp = (await pool.query('SELECT id, full_name FROM employees WHERE id=$1', [req.params.id])).rows[0];
  if (!emp) throw new HttpError(404, 'Funcionário não encontrado');
  await validate(d.typeId, d.issueDate, d.expiresAt);
  const id = await tx(async (c) => {
    const id = (await c.query(`INSERT INTO employee_documents (employee_id, type_id, title, issue_date, expires_at, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [emp.id, d.typeId, d.title ?? null, d.issueDate ?? null, d.expiresAt ?? null, d.notes ?? null, req.user!.id])).rows[0].id as string;
    await saveFile(c, id, req.file);
    const t = (await c.query('SELECT name FROM employee_document_types WHERE id=$1', [d.typeId])).rows[0].name;
    await audit(req, { action: 'criar', module: 'rh', entity: 'employee_document', entityId: id, summary: `Documento adicionado a ${emp.full_name}: ${t}${d.expiresAt ? ` (validade ${d.expiresAt.split('-').reverse().join('/')})` : ''}`, details: { arquivo: !!req.file } }, c);
    return id;
  });
  res.status(201).json({ id });
}));

rhDocsRouter.put('/documents/:id', requireAuth(PERM), upload.single('file'), h(async (req, res) => {
  const d = parse(docSchema, req.body);
  await tx(async (c) => {
    const cur = (await c.query(`SELECT d.*, e.full_name FROM employee_documents d JOIN employees e ON e.id = d.employee_id WHERE d.id=$1 FOR UPDATE OF d`, [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Documento não encontrado');
    await validate(d.typeId, d.issueDate, d.expiresAt, cur.type_id);
    await c.query(`UPDATE employee_documents SET type_id=$2, title=$3, issue_date=$4, expires_at=$5, notes=$6, updated_at=now() WHERE id=$1`,
      [cur.id, d.typeId, d.title ?? null, d.issueDate ?? null, d.expiresAt ?? null, d.notes ?? null]);
    if (req.file) await saveFile(c, cur.id, req.file);
    else if (d.removeFile && cur.file_name) { await c.query('DELETE FROM employee_document_files WHERE document_id=$1', [cur.id]); await c.query('UPDATE employee_documents SET file_name=NULL, file_mime=NULL, file_size=NULL WHERE id=$1', [cur.id]); }
    await audit(req, { action: 'editar', module: 'rh', entity: 'employee_document', entityId: cur.id, summary: `Documento de ${cur.full_name} editado`, details: { arquivoSubstituido: !!req.file, arquivoRemovido: !!d.removeFile && !req.file } }, c);
  });
  res.json({ ok: true });
}));

rhDocsRouter.delete('/documents/:id', requireAuth(PERM), h(async (req, res) => {
  await tx(async (c) => {
    const cur = (await c.query(`SELECT d.*, e.full_name, t.name AS type FROM employee_documents d JOIN employees e ON e.id = d.employee_id JOIN employee_document_types t ON t.id = d.type_id WHERE d.id=$1 FOR UPDATE OF d`, [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Documento não encontrado');
    await c.query('DELETE FROM employee_documents WHERE id=$1', [cur.id]);
    await audit(req, { action: 'excluir', module: 'rh', entity: 'employee_document', entityId: cur.id, summary: `Documento excluído de ${cur.full_name}: ${cur.type}`, details: { titulo: cur.title, validade: cur.expires_at, arquivo: cur.file_name } }, c);
  });
  res.json({ ok: true });
}));

rhDocsRouter.get('/documents/:id/file', requireAuth(PERM), h(async (req, res) => {
  const r = (await pool.query(
    `SELECT d.file_name, d.file_mime, f.data, e.full_name, t.name AS type FROM employee_documents d JOIN employee_document_files f ON f.document_id = d.id
       JOIN employees e ON e.id = d.employee_id JOIN employee_document_types t ON t.id = d.type_id WHERE d.id = $1`, [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Arquivo não encontrado');
  await audit(req, { action: 'download_documento', module: 'rh', entity: 'employee_document', entityId: String(req.params.id), summary: `Documento baixado: ${r.type} de ${r.full_name}` });
  res.set({ 'Content-Type': r.file_mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.file_name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(r.data);
}));
