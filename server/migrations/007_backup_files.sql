-- Arquivos de backup guardados no próprio banco quando o servidor não tem disco gravável/persistente (ex.: Vercel).
CREATE TABLE IF NOT EXISTS backup_files (
  filename   TEXT PRIMARY KEY,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
