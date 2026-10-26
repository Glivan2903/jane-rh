-- Fase 3 (RH): documentos do funcionário com vencimento. Migração apenas ADITIVA.
-- Os arquivos ficam NO BANCO (tabela própria): em hospedagem sem disco permanente (Vercel) documentos trabalhistas não podem se perder.
CREATE TABLE employee_document_types (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  requires_expiry BOOLEAN NOT NULL DEFAULT true,
  alert_days     INT NOT NULL DEFAULT 30 CHECK (alert_days BETWEEN 0 AND 365),
  active         BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX employee_document_types_uq ON employee_document_types (lower(name));
INSERT INTO employee_document_types (name, requires_expiry, alert_days) VALUES
  ('ASO - Atestado de Saúde Ocupacional', true, 30),
  ('Exame admissional', false, 30),
  ('Contrato de experiência', true, 15),
  ('Contrato de trabalho', false, 30),
  ('CNH', true, 60),
  ('Certificado de treinamento (NR)', true, 45),
  ('Outro documento', false, 30);

CREATE TABLE employee_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type_id     INT NOT NULL REFERENCES employee_document_types(id),
  title       TEXT,
  issue_date  DATE,
  expires_at  DATE,
  notes       TEXT,
  file_name   TEXT,
  file_mime   TEXT,
  file_size   INT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR issue_date IS NULL OR expires_at >= issue_date)
);
CREATE INDEX employee_documents_employee_idx ON employee_documents (employee_id);
CREATE INDEX employee_documents_expiry_idx ON employee_documents (expires_at);

CREATE TABLE employee_document_files (
  document_id UUID PRIMARY KEY REFERENCES employee_documents(id) ON DELETE CASCADE,
  data        BYTEA NOT NULL
);

INSERT INTO permissions (code, module, description) VALUES
 ('rh.documents','rh','RH: ver, enviar e baixar documentos dos funcionários')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, 'rh.documents' FROM roles r WHERE r.name IN ('Administrador','RH')
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value) VALUES ('notify_docs_enabled', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
