import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { COOKIE, PASSWORD_RULE, createSession, fetchSessionUser, requireAuth, sha256, strongPassword } from '../auth.js';
import { HttpError, h, parse } from '../util.js';
import { appUrl, sendMail } from '../services/mail.js';
import { accessFor } from '../services/ai.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT ?? 30), standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
});

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const MAX_ATTEMPTS = 5;
const LOCK_MIN = 15;

const me = async (req: Request) => {
  const u = req.user!;
  return { id: u.id, name: u.name, email: u.email, role: u.roleName, permissions: [...u.perms], mustChangePassword: u.mustChangePassword, ai: await accessFor(u) };
};

authRouter.post('/login', loginLimiter, h(async (req, res) => {
  const { login, password } = parse(z.object({ login: z.string().trim().min(1, 'Informe o e-mail ou usuário'), password: z.string().min(1, 'Informe a senha') }), req.body);
  const r = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)', [login]);
  const u = r.rows[0];
  const fail = async (why: string) => {
    await audit(null, { action: 'login', module: 'auth', entity: 'user', entityId: u?.id, summary: `Falha de login (${why}): ${login.slice(0, 80)}`, result: 'falha' });
    throw new HttpError(401, 'Credenciais inválidas ou usuário bloqueado.');
  };
  if (!u) { await bcrypt.compare(password, DUMMY_HASH); return fail('usuário inexistente'); }
  if (u.locked_until && u.locked_until > new Date()) { await bcrypt.compare(password, DUMMY_HASH); return fail('conta bloqueada'); }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const attempts = u.failed_attempts + 1;
    await pool.query(
      `UPDATE users SET failed_attempts = $2::int,
              locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(mins => $4::int) ELSE locked_until END WHERE id = $1`,
      [u.id, attempts, MAX_ATTEMPTS, LOCK_MIN]);
    return fail('senha incorreta');
  }
  if (!u.active) return fail('usuário inativo');
  await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  const token = await createSession(u.id, req, res);
  const au = (await fetchSessionUser(token))!;
  req.user = au;
  await audit(req, { action: 'login', module: 'auth', entity: 'user', entityId: au.id, summary: `Login de ${au.name}` });
  res.json(await me(req));
}));

// Primeiro acesso: só existe enquanto não há nenhum usuário. Depois disso as rotas respondem 404/409.
const setupLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });
const hasUsers = async () => (await pool.query('SELECT EXISTS (SELECT 1 FROM users) AS e')).rows[0].e as boolean;

authRouter.get('/setup-status', h(async (_req, res) => {
  res.json({ needsSetup: !(await hasUsers()), requiresToken: !!process.env.SETUP_TOKEN });
}));

authRouter.post('/setup', setupLimiter, h(async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(3, 'Informe o nome completo').max(120),
    email: z.string().trim().toLowerCase().email('E-mail inválido').max(160),
    password: z.string().refine(strongPassword, PASSWORD_RULE),
    confirm: z.string(),
    token: z.string().optional(),
  }).refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'As senhas não conferem' }), req.body);
  const expected = process.env.SETUP_TOKEN;
  if (expected && body.token !== expected) throw new HttpError(403, 'Código de configuração inválido.');

  const c = await pool.connect();
  let userId: string;
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(81472001)'); // impede dois cadastros iniciais simultâneos
    if ((await c.query('SELECT 1 FROM users LIMIT 1')).rowCount) { await c.query('ROLLBACK'); throw new HttpError(409, 'O sistema já foi configurado.'); }
    const role = (await c.query(`SELECT id FROM roles WHERE name='Administrador'`)).rows[0];
    userId = (await c.query(
      'INSERT INTO users (name,email,password_hash,role_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [body.name, body.email, await bcrypt.hash(body.password, 12), role.id])).rows[0].id;
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { c.release(); }

  const token = await createSession(userId, req, res);
  req.user = (await fetchSessionUser(token))!;
  await audit(req, { action: 'criar', module: 'config', entity: 'user', entityId: userId, summary: `Administrador inicial criado: ${body.email}` });
  res.json(await me(req));
}));

authRouter.post('/logout', h(async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(t)]);
  if (req.user) await audit(req, { action: 'logout', module: 'auth', entity: 'user', entityId: req.user.id, summary: `Logout de ${req.user.name}` });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth(), h(async (req, res) => { res.json(await me(req)); }));

authRouter.post('/change-password', requireAuth(), rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: 'Muitas tentativas. Aguarde.' } }), h(async (req, res) => {
  const body = parse(z.object({
    current: z.string().min(1, 'Informe a senha atual'),
    password: z.string().refine(strongPassword, PASSWORD_RULE),
    confirm: z.string(),
  }).refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'As senhas não conferem' }), req.body);
  const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
  if (!(await bcrypt.compare(body.current, u.password_hash))) throw new HttpError(422, 'Senha atual incorreta', { current: 'Senha atual incorreta' });
  if (await bcrypt.compare(body.password, u.password_hash)) throw new HttpError(422, 'A nova senha deve ser diferente da atual', { password: 'A nova senha deve ser diferente da atual' });
  const hash = await bcrypt.hash(body.password, 12);
  await pool.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [req.user!.id, hash]);
  // encerra as demais sessões do usuário (mantém a atual)
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user!.id, req.user!.sessionId]);
  await audit(req, { action: 'alterar_senha', module: 'auth', entity: 'user', entityId: req.user!.id, summary: `${req.user!.name} alterou a própria senha` });
  res.json({ ok: true });
}));

// ---- Recuperação de senha por e-mail ----
const RESET_MIN = 60;
const forgotLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.FORGOT_RATE_LIMIT ?? 5), standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas solicitações. Aguarde alguns minutos.' },
});
const GENERIC = 'Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha. Ele vale por 60 minutos.';

authRouter.post('/forgot-password', forgotLimiter, h(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('Informe um e-mail válido') }), req.body);
  const u = (await pool.query('SELECT id, name, email FROM users WHERE lower(email) = $1 AND active', [email])).rows[0];
  if (u) {
    // no máximo um link por minuto por usuário; solicitações anteriores deixam de valer
    const recent = (await pool.query(`SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 minute'`, [u.id])).rowCount;
    if (!recent) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [u.id]);
      await pool.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3::int))', [u.id, sha256(token), RESET_MIN]);
      const link = `${appUrl()}/redefinir-senha?token=${token}`;
      await audit(req, { action: 'solicitar_redefinicao', module: 'auth', entity: 'user', entityId: u.id, summary: `Redefinição de senha solicitada para ${u.email}` }, pool, { id: u.id, name: u.name });
      // envio fora do caminho da resposta: o tempo não revela se o e-mail existe
      sendMail({
        to: u.email, subject: 'Redefinição de senha - Gentis',
        text: `Olá, ${u.name}.\n\nRecebemos um pedido para redefinir sua senha. Acesse o link abaixo em até ${RESET_MIN} minutos:\n${link}\n\nSe você não pediu, ignore este e-mail: sua senha continua a mesma.`,
      }).catch((e) => console.error('[e-mail] falha ao enviar redefinição:', e.message));
    }
  }
  res.json({ ok: true, message: GENERIC });
}));

authRouter.post('/reset-password', rateLimit({ windowMs: 15 * 60_000, limit: 20, message: { error: 'Muitas tentativas. Aguarde.' } }), h(async (req, res) => {
  const body = parse(z.object({
    token: z.string().min(20).max(200),
    password: z.string().refine(strongPassword, PASSWORD_RULE),
    confirm: z.string(),
  }).refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'As senhas não conferem' }), req.body);
  const hash = await bcrypt.hash(body.password, 12);
  const c = await pool.connect();
  let user: { id: string; name: string };
  try {
    await c.query('BEGIN');
    const r = (await c.query(
      `SELECT pr.id, u.id AS user_id, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id AND u.active
        WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now() FOR UPDATE OF pr`, [sha256(body.token)])).rows[0];
    if (!r) { await c.query('ROLLBACK'); throw new HttpError(400, 'Link inválido ou expirado. Solicite uma nova redefinição.'); }
    await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    await c.query('UPDATE users SET password_hash = $2, must_change_password = false, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [r.user_id, hash]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [r.user_id]);
    await c.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [r.user_id]);
    user = { id: r.user_id, name: r.name };
    await audit(req, { action: 'redefinir_senha', module: 'auth', entity: 'user', entityId: user.id, summary: `${user.name} redefiniu a senha pelo link enviado por e-mail` }, c, user);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally { c.release(); }
  res.json({ ok: true });
}));
