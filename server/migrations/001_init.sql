-- Esquema inicial. Valores monetários em NUMERIC (sem float). Datas em DATE; instantes em TIMESTAMPTZ.

CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id         INT  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  username             TEXT,
  password_hash        TEXT NOT NULL,
  role_id              INT NOT NULL REFERENCES roles(id),
  active               BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  failed_attempts      INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE UNIQUE INDEX users_username_uq ON users (lower(username)) WHERE username IS NOT NULL;

CREATE TABLE sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE audit_logs (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id   UUID,
  user_name TEXT,
  action    TEXT NOT NULL,
  module    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  result    TEXT NOT NULL DEFAULT 'sucesso',
  summary   TEXT NOT NULL,
  details   JSONB,
  ip        TEXT
);
CREATE INDEX audit_at_idx ON audit_logs (at DESC);
CREATE INDEX audit_module_idx ON audit_logs (module, at DESC);

-- Auditoria é append-only: nem UPDATE nem DELETE pela aplicação.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % são imutáveis', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE backup_logs (
  id         BIGSERIAL PRIMARY KEY,
  filename   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'manual',
  status     TEXT NOT NULL,
  size_bytes BIGINT,
  sha256     TEXT,
  error      TEXT,
  user_name  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ
);

-- ===== RH =====
CREATE TABLE departments (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX departments_name_uq ON departments (lower(name));

CREATE TABLE job_positions (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX job_positions_name_uq ON job_positions (lower(name));

CREATE SEQUENCE employee_registration_seq START 1;

CREATE TABLE employees (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration       TEXT NOT NULL UNIQUE,           -- matrícula interna
  payroll_number     TEXT,                           -- Nº Folha
  identifier_number  TEXT,                           -- Nº Identificador
  pis_pasep          TEXT,                           -- Nº PIS/PASEP (somente dígitos)
  transport_voucher  BOOLEAN NOT NULL DEFAULT false, -- optante por vale-transporte
  full_name          TEXT NOT NULL,
  cpf                TEXT NOT NULL UNIQUE,           -- somente dígitos
  birth_date         DATE,
  gender             TEXT,
  marital_status     TEXT,
  phone              TEXT,
  phone_alt          TEXT,
  email              TEXT,
  zip                TEXT,
  street             TEXT,
  number             TEXT,
  complement         TEXT,
  district           TEXT,
  city               TEXT,
  state              CHAR(2),
  notes              TEXT,
  position_id        INT REFERENCES job_positions(id),
  department_id      INT REFERENCES departments(id),
  contract_type      TEXT,
  admission_date     DATE,
  termination_date   DATE,
  termination_reason TEXT,
  salary             NUMERIC(14,2) CHECK (salary IS NULL OR salary >= 0),
  workload           TEXT,
  manager_id         UUID REFERENCES employees(id),
  corporate_email    TEXT,
  corporate_phone    TEXT,
  professional_notes TEXT,
  status             TEXT NOT NULL DEFAULT 'pre_cadastro' CHECK (status IN ('pre_cadastro','ativo','desligado')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employees_name_idx ON employees (lower(full_name));
CREATE INDEX employees_status_idx ON employees (status);
CREATE INDEX employees_admission_idx ON employees (admission_date);
CREATE UNIQUE INDEX employees_pis_uq ON employees (pis_pasep) WHERE pis_pasep IS NOT NULL;
CREATE UNIQUE INDEX employees_payroll_uq ON employees (payroll_number) WHERE payroll_number IS NOT NULL;

CREATE TABLE employment_history (
  id          BIGSERIAL PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type  TEXT NOT NULL,   -- cadastro, admissao, alteracao, mudanca_cargo, mudanca_departamento, contratual, desligamento
  description TEXT NOT NULL,
  data        JSONB,
  user_id     UUID,
  user_name   TEXT
);
CREATE INDEX employment_history_emp_idx ON employment_history (employee_id, at DESC);
CREATE TRIGGER employment_history_immutable BEFORE UPDATE OR DELETE ON employment_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ===== Financeiro =====
CREATE TABLE financial_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX fin_cat_uq ON financial_categories (type, lower(name));

-- status armazenado: pendente | realizada (paga/recebida) | cancelada. "Vencida" é derivada (pendente com vencimento passado).
CREATE TABLE financial_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  description      TEXT NOT NULL,
  category_id      INT NOT NULL REFERENCES financial_categories(id),
  party            TEXT,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  competence_date  DATE NOT NULL,
  due_date         DATE NOT NULL,
  settled_date     DATE,
  method           TEXT,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','realizada','cancelada')),
  notes            TEXT,
  attachment_name  TEXT,
  attachment_path  TEXT,
  series_id        UUID,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'realizada') = (settled_date IS NOT NULL))
);
CREATE INDEX fin_tx_due_idx ON financial_transactions (type, due_date);
CREATE INDEX fin_tx_settled_idx ON financial_transactions (settled_date);
CREATE INDEX fin_tx_cat_idx ON financial_transactions (category_id);

-- Uma baixa por lançamento: UNIQUE impede baixa duplicada mesmo sob concorrência.
CREATE TABLE payment_records (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  effective_date DATE NOT NULL,
  method         TEXT,
  user_id        UUID,
  user_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Estoque =====
CREATE TABLE units_of_measure (
  id     SERIAL PRIMARY KEY,
  code   TEXT NOT NULL,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX units_code_uq ON units_of_measure (lower(code));

CREATE TABLE product_categories (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX product_cat_uq ON product_categories (lower(name));

CREATE TABLE suppliers (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX suppliers_uq ON suppliers (lower(name));

CREATE SEQUENCE product_code_seq START 1;

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  category_id INT REFERENCES product_categories(id),
  unit_id     INT NOT NULL REFERENCES units_of_measure(id),
  barcode     TEXT,
  cost        NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cost >= 0),   -- custo médio ponderado
  sale_price  NUMERIC(14,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  min_stock   NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  location    TEXT,
  supplier_id INT REFERENCES suppliers(id),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_barcode_uq ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX products_name_idx ON products (lower(name));

-- Saldo negativo só é aceito se a configuração administrativa permitir (checado também no banco).
CREATE FUNCTION check_product_balance() RETURNS trigger AS $$
DECLARE allow BOOLEAN;
BEGIN
  IF NEW.quantity < 0 THEN
    SELECT COALESCE((SELECT (value)::boolean FROM settings WHERE key = 'allow_negative_stock'), false) INTO allow;
    IF NOT allow THEN
      RAISE EXCEPTION 'Saldo de estoque insuficiente para o produto %', NEW.code USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER products_balance BEFORE INSERT OR UPDATE OF quantity ON products
  FOR EACH ROW EXECUTE FUNCTION check_product_balance();

CREATE TABLE stock_movements (
  id              BIGSERIAL PRIMARY KEY,
  product_id      UUID NOT NULL REFERENCES products(id),
  type            TEXT NOT NULL CHECK (type IN ('entrada','saida','ajuste')),
  quantity        NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),  -- valor absoluto
  delta           NUMERIC(14,3) NOT NULL,                       -- variação com sinal
  balance_before  NUMERIC(14,3) NOT NULL,
  balance_after   NUMERIC(14,3) NOT NULL,
  unit_cost       NUMERIC(14,4),
  reason          TEXT NOT NULL,
  doc_number      TEXT,
  supplier_id     INT REFERENCES suppliers(id),
  destination     TEXT,
  notes           TEXT,
  movement_date   DATE NOT NULL,
  user_id         UUID,
  user_name       TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance_after = balance_before + delta)
);
CREATE INDEX stock_mov_prod_idx ON stock_movements (product_id, created_at DESC);
CREATE INDEX stock_mov_date_idx ON stock_movements (movement_date);
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
