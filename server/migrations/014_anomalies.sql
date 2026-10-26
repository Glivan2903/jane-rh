-- Alertas de anomalia. Migração apenas ADITIVA: cria uma tabela e parâmetros novos; nada existente é alterado.
CREATE TABLE anomalies (
  id               BIGSERIAL PRIMARY KEY,
  kind             TEXT NOT NULL,
  area             TEXT NOT NULL CHECK (area IN ('fin','est','rh')),
  severity         TEXT NOT NULL DEFAULT 'atencao' CHECK (severity IN ('atencao','alerta')),
  dedupe_key       TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  detail           TEXT NOT NULL,
  link             TEXT,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','dispensado','resolvido')),
  first_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_by     TEXT,
  dismissed_at     TIMESTAMPTZ
);
CREATE INDEX anomalies_status_idx ON anomalies (status, area);

INSERT INTO settings (key, value) VALUES ('notify_anomalies_enabled', 'true'::jsonb), ('anomaly_sensitivity', '2'::jsonb) ON CONFLICT (key) DO NOTHING;
