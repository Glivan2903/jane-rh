import { TODAY_SQL } from './finance.js';

/** Situação do documento: vencido, a vencer (dentro do aviso do tipo), válido ou sem validade. Alias: d = employee_documents, t = employee_document_types. */
export const DOC_STATUS = `(CASE WHEN d.expires_at IS NULL THEN 'sem_validade' WHEN d.expires_at < ${TODAY_SQL} THEN 'vencido'
  WHEN d.expires_at <= ${TODAY_SQL} + t.alert_days THEN 'a_vencer' ELSE 'valido' END)`;
