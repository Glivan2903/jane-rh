-- Nº da Carteira de Trabalho (CTPS) do funcionário. Migração apenas ADITIVA: coluna nova e opcional.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ctps TEXT;
