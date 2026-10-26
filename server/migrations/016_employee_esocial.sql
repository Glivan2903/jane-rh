-- Matrícula do eSocial do funcionário. Migração apenas ADITIVA: coluna nova e opcional.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS esocial TEXT;
