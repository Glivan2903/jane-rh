import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { getSettings } from '../services/settings.js';
import { PASSWORD_RULE, requireAuth, strongPassword } from '../auth.js';
import { HttpError, Where, h, likeEsc, listParams, parse, qstr, reqStr, optStr } from '../util.js';

export const configRouter = Router();

const userBase = {
  name: reqStr(150, 'Informe o nome'),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200),
  username: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Use 3-40 caracteres: letras, números, ponto, hífen ou _').nullable().optional()),
  roleId: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive('Perfil inválido').optional()),
  active: z.boolean().default(true),
};
const pwd = z.string().refine(strongPassword, PASSWORD_RULE);

const dupMsg = (e: unknown): never => {
  const err = e as { code?: string; constraint?: string };
  if (err.code === '23505') {
    if (err.constraint === 'users_username_uq') throw new HttpError(409, 'Nome de usuário já em uso', { username: 'Nome de usuário já em uso' });
    throw new HttpError(409, 'E-mail já cadastrado', { email: 'E-mail já cadastrado' });
  }
  throw e;
};

async function activeAdminCount(excludeId?: string) {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'Administrador' AND u.active AND ($1::uuid IS NULL OR u.id <> $1)`, [excludeId ?? null]);
  return r.rows[0].n as number;
}

// ---------- Usuários ----------
configRouter.get('/users', requireAuth('cfg.users'), h(async (req, res) => {
  const p = listParams(req, { name: 'u.name', email: 'u.email', role: 'r.name', created: 'u.created_at', last: 'u.last_login_at' }, 'name');
  const w = new Where();
  if (p.q) w.add(`(u.name ILIKE ? OR u.email ILIKE ? OR u.username ILIKE ?)`, likeEsc(p.q), likeEsc(p.q), likeEsc(p.q));
  const st = qstr(req, 'active'); if (st) w.add('u.active = ?', st === 'true');
  const role = qstr(req, 'roleId'); if (role) w.add('u.role_id = ?', Number(role));
  const base = `FROM users u JOIN roles r ON r.id = u.role_id ${w.sql}`;
  const total = (await pool.query(`SELECT count(*)::int n ${base}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT u.id, u.name, u.email, u.username, u.role_id AS "roleId", r.name AS role, u.active, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt"
       ${base} ORDER BY ${p.sort} ${p.dir}, u.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

configRouter.post('/users', requireAuth('cfg.users'), h(async (req, res) => {
  const d = parse(z.object({ ...userBase, password: pwd }), req.body);
  const hash = await bcrypt.hash(d.password, 12);
  // sem perfil informado: entra sem permissões até o administrador definir o acesso
  const roleId = d.roleId ?? (await pool.query(`SELECT id FROM roles WHERE name = 'Sem permissões'`)).rows[0].id;
  try {
    const row = (await pool.query(
      `INSERT INTO users (name,email,username,password_hash,role_id,active,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [d.name, d.email, d.username ?? null, hash, roleId, d.active])).rows[0];
    await audit(req, { action: 'criar', module: 'config', entity: 'user', entityId: row.id, summary: `Usuário criado: ${d.name} (${d.email})`, details: { roleId } });
    res.status(201).json({ id: row.id });
  } catch (e) { dupMsg(e); }
}));

configRouter.put('/users/:id', requireAuth('cfg.users'), h(async (req, res) => {
  const d = parse(z.object({ ...userBase, roleId: z.coerce.number().int().positive('Selecione o perfil') }), req.body);
  const id = req.params.id;
  const cur = (await pool.query('SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Usuário não encontrado');
  const newRole = (await pool.query('SELECT name FROM roles WHERE id=$1', [d.roleId])).rows[0];
  if (!newRole) throw new HttpError(422, 'Perfil inválido', { roleId: 'Perfil inválido' });
  const loseAdmin = cur.role_name === 'Administrador' && cur.active && (newRole.name !== 'Administrador' || !d.active);
  if (loseAdmin && (await activeAdminCount(id)) === 0) throw new HttpError(409, 'Deve existir ao menos um administrador ativo.');
  if (id === req.user!.id && !d.active) throw new HttpError(409, 'Você não pode inativar o próprio usuário.');
  try {
    await tx(async (c) => {
      await c.query('UPDATE users SET name=$2,email=$3,username=$4,role_id=$5,active=$6,updated_at=now() WHERE id=$1', [id, d.name, d.email, d.username ?? null, d.roleId, d.active]);
      if (!d.active || d.roleId !== cur.role_id) await c.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(req, {
        action: cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar', module: 'config', entity: 'user', entityId: id,
        summary: `Usuário ${cur.active !== d.active ? (d.active ? 'ativado' : 'inativado') : 'editado'}: ${d.name}`,
        details: { de: { role: cur.role_name, active: cur.active }, para: { role: newRole.name, active: d.active } },
      }, c);
    });
  } catch (e) { dupMsg(e); }
  res.json({ ok: true });
}));

configRouter.post('/users/:id/reset-password', requireAuth('cfg.users'), h(async (req, res) => {
  const { password } = parse(z.object({ password: pwd }), req.body);
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query('UPDATE users SET password_hash=$2, must_change_password=true, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE id=$1 RETURNING name', [req.params.id, hash]);
  if (!r.rowCount) throw new HttpError(404, 'Usuário não encontrado');
  await pool.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
  await audit(req, { action: 'redefinir_senha', module: 'config', entity: 'user', entityId: req.params.id, summary: `Senha redefinida para o usuário ${r.rows[0].name}` });
  res.json({ ok: true });
}));

// ---------- Perfis e permissões ----------
configRouter.get('/permissions', requireAuth('cfg.roles'), h(async (_req, res) => {
  res.json((await pool.query('SELECT code, module, description FROM permissions ORDER BY module, code')).rows);
}));

// lista de perfis também serve o seletor de usuários
configRouter.get('/roles', requireAuth('cfg.roles', 'cfg.users'), h(async (_req, res) => {
  res.json((await pool.query(
    `SELECT r.id, r.name, r.description, r.is_system AS "isSystem",
            COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),'{}') AS permissions,
            (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS "userCount"
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.id`)).rows);
}));

const roleSchema = z.object({ name: reqStr(60, 'Informe o nome'), description: optStr(200), permissions: z.array(z.string()).default([]) });

async function saveRolePerms(c: { query: typeof pool.query }, roleId: number, codes: string[]) {
  const valid = (await c.query('SELECT code FROM permissions WHERE code = ANY($1)', [codes])).rows.map((r: { code: string }) => r.code);
  await c.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
  if (valid.length) await c.query('INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[])', [roleId, valid]);
}

configRouter.post('/roles', requireAuth('cfg.roles'), h(async (req, res) => {
  const d = parse(roleSchema, req.body);
  try {
    const id = await tx(async (c) => {
      const r = await c.query('INSERT INTO roles (name, description) VALUES ($1,$2) RETURNING id', [d.name, d.description ?? null]);
      await saveRolePerms(c as never, r.rows[0].id, d.permissions);
      await audit(req, { action: 'criar', module: 'config', entity: 'role', entityId: r.rows[0].id, summary: `Perfil criado: ${d.name}`, details: { permissions: d.permissions } }, c);
      return r.rows[0].id;
    });
    res.status(201).json({ id });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Já existe um perfil com esse nome', { name: 'Já existe um perfil com esse nome' });
    throw e;
  }
}));

configRouter.put('/roles/:id', requireAuth('cfg.roles'), h(async (req, res) => {
  const d = parse(roleSchema, req.body);
  const id = Number(req.params.id);
  const cur = (await pool.query('SELECT * FROM roles WHERE id=$1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Perfil não encontrado');
  if (cur.name === 'Administrador') throw new HttpError(409, 'O perfil Administrador não pode ser alterado.');
  try {
    await tx(async (c) => {
      await c.query('UPDATE roles SET name = CASE WHEN is_system THEN name ELSE $2 END, description=$3 WHERE id=$1', [id, d.name, d.description ?? null]);
      await saveRolePerms(c as never, id, d.permissions);
      // sessões são revalidadas a cada requisição; nada mais a fazer para aplicar as novas permissões
      await audit(req, { action: 'editar_permissoes', module: 'config', entity: 'role', entityId: id, summary: `Permissões do perfil ${cur.name} alteradas`, details: { permissions: d.permissions } }, c);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Já existe um perfil com esse nome', { name: 'Já existe um perfil com esse nome' });
    throw e;
  }
  res.json({ ok: true });
}));

configRouter.delete('/roles/:id', requireAuth('cfg.roles'), h(async (req, res) => {
  const id = Number(req.params.id);
  const cur = (await pool.query('SELECT r.*, (SELECT count(*)::int FROM users u WHERE u.role_id=r.id) AS n FROM roles r WHERE id=$1', [id])).rows[0];
  if (!cur) throw new HttpError(404, 'Perfil não encontrado');
  if (cur.is_system) throw new HttpError(409, 'Perfis padrão do sistema não podem ser excluídos.');
  if (cur.n > 0) throw new HttpError(409, 'Há usuários vinculados a este perfil.');
  await pool.query('DELETE FROM roles WHERE id=$1', [id]);
  await audit(req, { action: 'excluir', module: 'config', entity: 'role', entityId: id, summary: `Perfil excluído: ${cur.name}` });
  res.json({ ok: true });
}));

// ---------- Auditoria ----------
configRouter.get('/audit', requireAuth('cfg.audit'), h(async (req, res) => {
  const p = listParams(req, { at: 'a.at', user: 'a.user_name', module: 'a.module', action: 'a.action' }, 'at', 'DESC');
  const w = new Where();
  if (p.q) w.add('(a.summary ILIKE ? OR a.user_name ILIKE ?)', likeEsc(p.q), likeEsc(p.q));
  const m = qstr(req, 'module'); if (m) w.add('a.module = ?', m);
  const r = qstr(req, 'result'); if (r) w.add('a.result = ?', r);
  const u = qstr(req, 'userId'); if (u) w.add('a.user_id = ?', u);
  const f = qstr(req, 'from'); if (f) w.add(`a.at >= (?::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`, f);
  const t = qstr(req, 'to'); if (t) w.add(`a.at < ((?::date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'`, t);
  const total = (await pool.query(`SELECT count(*)::int n FROM audit_logs a ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT a.id, a.at, a.user_name AS "userName", a.action, a.module, a.entity, a.entity_id AS "entityId", a.result, a.summary, a.details
       FROM audit_logs a ${w.sql} ORDER BY ${p.sort} ${p.dir}, a.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

// ---------- Parâmetros ----------
configRouter.get('/settings', requireAuth('cfg.settings'), h(async (_req, res) => { res.json(await getSettings()); }));

const settingsSchema = z.object({
  allow_negative_stock: z.boolean(),
  notify_bills_enabled: z.boolean(),
  notify_bills_days: z.number().int().min(0, 'Mínimo 0 dia').max(90, 'Máximo 90 dias'),
  notify_overdue_enabled: z.boolean(),
  notify_receivables: z.boolean(),
  notify_stock_enabled: z.boolean(),
  notify_docs_enabled: z.boolean(),
  notify_batches_enabled: z.boolean(),
  batch_alert_days: z.number().int().min(1, 'Mínimo 1 dia').max(365, 'Máximo 365 dias'),
  notify_anomalies_enabled: z.boolean(),
  anomaly_sensitivity: z.number().int().min(1, 'Escolha de 1 a 3').max(3, 'Escolha de 1 a 3'),
  notify_refresh_minutes: z.number().int().min(1, 'Mínimo 1 minuto').max(60, 'Máximo 60 minutos'),
  upcoming_list_size: z.number().int().min(3, 'Mínimo 3').max(30, 'Máximo 30'),
}).partial();

configRouter.put('/settings', requireAuth('cfg.settings'), h(async (req, res) => {
  const d = parse(settingsSchema, req.body);
  const before = await getSettings();
  for (const [k, v] of Object.entries(d)) {
    await pool.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(v)]);
  }
  const changed = Object.entries(d).filter(([k, v]) => before[k as keyof typeof before] !== v).map(([k]) => k);
  await audit(req, { action: 'editar', module: 'config', entity: 'settings', summary: changed.length ? `Parâmetros alterados: ${changed.join(', ')}` : 'Parâmetros salvos sem alterações', details: { campos: changed } });
  res.json({ ok: true });
}));
