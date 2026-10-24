import { pool } from '../db.js';

export const SETTING_DEFAULTS = {
  allow_negative_stock: false,
  notify_bills_enabled: true,   // avisar contas a pagar próximas do vencimento
  notify_bills_days: 7,         // com quantos dias de antecedência
  notify_overdue_enabled: true, // avisar contas vencidas
  notify_receivables: false,    // incluir contas a receber nos avisos de vencimento
  notify_stock_enabled: true,   // alertas de estoque mínimo / zerado
  notify_docs_enabled: true,    // avisar documentos de funcionários vencidos ou a vencer
  notify_refresh_minutes: 2,    // intervalo de atualização das notificações
  upcoming_list_size: 8,        // itens na lista "próximas contas" do dashboard
} as const;
export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends boolean ? boolean : number };

export async function getSettings(): Promise<Settings> {
  const rows = (await pool.query('SELECT key, value FROM settings')).rows as { key: string; value: unknown }[];
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS && typeof r.value === typeof SETTING_DEFAULTS[r.key as keyof typeof SETTING_DEFAULTS]) out[r.key] = r.value;
  return out as Settings;
}
