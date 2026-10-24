import { TODAY_SQL } from './finance.js';

/** Dias de antecedência do aviso de validade (Parâmetros). */
const ALERT_DAYS = `COALESCE((SELECT (value #>> '{}')::int FROM settings WHERE key = 'batch_alert_days'), 30)`;

/** Situação do lote: vencido, a vencer (dentro do aviso), válido ou sem validade. Alias: b = stock_batches. */
export const BATCH_STATUS = `(CASE WHEN b.expires_at IS NULL THEN 'sem_validade' WHEN b.expires_at < ${TODAY_SQL} THEN 'vencido'
  WHEN b.expires_at <= ${TODAY_SQL} + ${ALERT_DAYS} THEN 'a_vencer' ELSE 'valido' END)`;
