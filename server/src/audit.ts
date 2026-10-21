import type { Request } from 'express';
import { pool, type Q } from './db.js';

export interface AuditInput {
  action: string;            // ex.: criar, editar, login, baixa
  module: string;            // auth, rh, financeiro, estoque, config
  entity?: string;
  entityId?: string | number | null;
  summary: string;           // texto legível (aparece nas atividades recentes)
  result?: 'sucesso' | 'falha';
  details?: Record<string, unknown>;
}

const SENSITIVE = /senha|password|token|secret|hash/i;
function scrub(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === 'object') {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SENSITIVE.test(k) ? '[omitido]' : scrub(v)]));
  }
  return o;
}

/** Registra auditoria. Passe `db` (client da transação) para gravar atomicamente com a operação. */
export async function audit(req: Request | null, a: AuditInput, db: Q = pool, actor?: { id: string; name: string }) {
  const u = actor ?? req?.user;
  await db.query(
    `INSERT INTO audit_logs (user_id, user_name, action, module, entity, entity_id, result, summary, details, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [u?.id ?? null, u?.name ?? null, a.action, a.module, a.entity ?? null, a.entityId != null ? String(a.entityId) : null,
     a.result ?? 'sucesso', a.summary, a.details ? JSON.stringify(scrub(a.details)) : null, req?.ip ?? null],
  );
}
