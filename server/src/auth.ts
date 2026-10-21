import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { config } from './config.js';
import { HttpError } from './util.js';

export interface AuthUser {
  id: string; name: string; email: string; roleId: number; roleName: string;
  perms: Set<string>; mustChangePassword: boolean; sessionId: string;
}
declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

export const COOKIE = 'jane_sid';
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, req: Request, res: Response): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [userId, sha256(token), req.ip ?? null, (req.headers['user-agent'] ?? '').slice(0, 300), expires],
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires, path: '/',
  });
  return token;
}

export async function fetchSessionUser(token: string): Promise<AuthUser | undefined> {
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.role_id, r.name AS role_name, u.must_change_password, s.id AS session_id,
            COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS perms
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.active
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      GROUP BY u.id, r.name, s.id`,
    [sha256(token)],
  );
  const row = r.rows[0];
  if (!row) return undefined;
  return {
    id: row.id, name: row.name, email: row.email, roleId: row.role_id, roleName: row.role_name,
    perms: new Set(row.perms), mustChangePassword: row.must_change_password, sessionId: row.session_id,
  };
}

/** Carrega o usuário da sessão (se houver). Permissões são lidas do banco a cada requisição: mudanças valem de imediato. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) req.user = await fetchSessionUser(token);
    next();
  } catch (e) { next(e); }
}

/** Exige login e (opcionalmente) ao menos uma das permissões listadas. */
export const requireAuth = (...anyOf: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  if (req.user.mustChangePassword && !req.originalUrl.startsWith('/api/auth')) {
    return next(new HttpError(403, 'Troca de senha obrigatória.'));
  }
  if (anyOf.length && !anyOf.some((p) => req.user!.perms.has(p))) {
    return next(new HttpError(403, 'Você não tem permissão para esta operação.'));
  }
  next();
};

export const hasPerm = (req: Request, p: string) => !!req.user?.perms.has(p);

export const PASSWORD_RULE = 'A senha deve ter ao menos 10 caracteres, com letras e números.';
export const strongPassword = (p: string) => p.length >= 10 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
