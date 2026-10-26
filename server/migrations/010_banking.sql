-- Fase 1 (Financeiro): contas bancárias, transferências, centros de custo e conciliação OFX.
-- Migração apenas ADITIVA: nenhuma linha existente é alterada ou apagada.
-- Lançamentos antigos ficam com account_id NULL e passam a contar na "Conta padrão" por regra de leitura (COALESCE),
-- sem nenhum UPDATE sobre financial_transactions.
CREATE TABLE bank_accounts (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'corrente' CHECK (kind IN ('corrente','poupanca','caixa','cartao','outra')),
  bank            TEXT,
  agency          TEXT,
  account_number  TEXT,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_accounts_name_uq ON bank_accounts (lower(name));
CREATE UNIQUE INDEX bank_accounts_default_uq ON bank_accounts (is_default) WHERE is_default;
INSERT INTO bank_accounts (name, kind, is_default) VALUES ('Conta padrão', 'caixa', true);

CREATE TABLE cost_centers (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX cost_centers_uq ON cost_centers (lower(name));

ALTER TABLE financial_transactions ADD COLUMN account_id INT REFERENCES bank_accounts(id);
ALTER TABLE financial_transactions ADD COLUMN cost_center_id INT REFERENCES cost_centers(id);
CREATE INDEX financial_transactions_account_idx ON financial_transactions (account_id);
CREATE INDEX financial_transactions_cc_idx ON financial_transactions (cost_center_id);

CREATE TABLE bank_transfers (
  id              BIGSERIAL PRIMARY KEY,
  from_account_id INT NOT NULL REFERENCES bank_accounts(id),
  to_account_id   INT NOT NULL REFERENCES bank_accounts(id),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  transfer_date   DATE NOT NULL,
  description     TEXT,
  created_by      UUID,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);
CREATE INDEX bank_transfers_date_idx ON bank_transfers (transfer_date);

-- Linhas do extrato importado (OFX). amount tem sinal: positivo = entrada, negativo = saída.
CREATE TABLE bank_statement_lines (
  id             BIGSERIAL PRIMARY KEY,
  account_id     INT NOT NULL REFERENCES bank_accounts(id),
  fitid          TEXT NOT NULL,
  posted_date    DATE NOT NULL,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  memo           TEXT,
  status         TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','conciliado','ignorado')),
  transaction_id UUID REFERENCES financial_transactions(id),
  imported_by    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, fitid),
  CHECK ((status = 'conciliado') = (transaction_id IS NOT NULL))
);
CREATE UNIQUE INDEX bank_statement_tx_uq ON bank_statement_lines (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX bank_statement_account_idx ON bank_statement_lines (account_id, posted_date);

INSERT INTO permissions (code, module, description) VALUES
 ('fin.accounts','fin','Financeiro: contas, transferências e conciliação')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, 'fin.accounts' FROM roles r WHERE r.name IN ('Administrador','Financeiro')
ON CONFLICT DO NOTHING;
