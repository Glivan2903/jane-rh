import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { COOKIE, PASSWORD_RULE, createSession, fetchSessionUser, requireAuth, sha256, strongPassword } from '../auth.js';
import { HttpError, h, parse } from '../util.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT ?? 30), standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
});

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const MAX_ATTEMPTS = 5;
const LOCK_MIN = 15;

const me = (req: Request) => {
  const u = req.user!;
  return { id: u.id, name: u.name, email: u.email, role: u.roleName, permissions: [...u.perms], mustChangePassword: u.mustChangePassword };
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
  res.json(me(req));
}));

authRouter.post('/logout', h(async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(t)]);
  if (req.user) await audit(req, { action: 'logout', module: 'auth', entity: 'user', entityId: req.user.id, summary: `Logout de ${req.user.name}` });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth(), h(async (req, res) => { res.json(me(req)); }));

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
