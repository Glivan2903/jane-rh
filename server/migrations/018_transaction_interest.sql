-- Percentual de juros informado no lançamento (despesas). Migração apenas ADITIVA: coluna nova e opcional.
ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0 AND interest_rate <= 100);
