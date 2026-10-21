-- Preferências de avisos e dashboard (editáveis em Configurações → Parâmetros).
INSERT INTO settings (key, value) VALUES
  ('notify_bills_enabled', 'true'::jsonb),
  ('notify_bills_days', '7'::jsonb),
  ('notify_overdue_enabled', 'true'::jsonb),
  ('notify_receivables', 'false'::jsonb),
  ('notify_stock_enabled', 'true'::jsonb),
  ('notify_refresh_minutes', '2'::jsonb),
  ('upcoming_list_size', '8'::jsonb)
ON CONFLICT (key) DO NOTHING;
