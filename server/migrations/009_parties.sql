-- Cadastro único de clientes e fornecedores. Migração apenas ADITIVA:
-- nenhuma tabela ou linha existente é alterada, renomeada ou apagada.
-- Os fornecedores atuais são COPIADOS para parties; a tabela suppliers continua intacta (estoque segue usando-a).
CREATE TABLE parties (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  is_customer        BOOLEAN NOT NULL DEFAULT false,
  is_supplier        BOOLEAN NOT NULL DEFAULT false,
  document           TEXT,                       -- CPF ou CNPJ, somente dígitos
  email              TEXT,
  phone              TEXT,
  notes              TEXT,
  active             BOOLEAN NOT NULL DEFAULT true,
  legacy_supplier_id INT UNIQUE REFERENCES suppliers(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parties_kind_ck CHECK (is_customer OR is_supplier)
);
CREATE UNIQUE INDEX parties_name_uq ON parties (lower(name));
CREATE UNIQUE INDEX parties_document_uq ON parties (document) WHERE document IS NOT NULL;

INSERT INTO parties (name, is_supplier, active, legacy_supplier_id)
  SELECT name, true, active, id FROM suppliers;

-- Vínculo opcional dos lançamentos (o texto livre "party" existente permanece como está).
ALTER TABLE financial_transactions ADD COLUMN party_id INT REFERENCES parties(id);
CREATE INDEX financial_transactions_party_idx ON financial_transactions (party_id);

INSERT INTO permissions (code, module, description) VALUES
 ('cad.view','cad','Clientes e fornecedores: visualizar'),
 ('cad.create','cad','Clientes e fornecedores: cadastrar'),
 ('cad.edit','cad','Clientes e fornecedores: editar'),
 ('cad.inactivate','cad','Clientes e fornecedores: inativar')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
   WHERE p.module = 'cad' AND (r.name = 'Administrador'
      OR (r.name IN ('Financeiro','Estoque') AND p.code IN ('cad.view','cad.create','cad.edit'))
      OR (r.name = 'Consulta' AND p.code = 'cad.view'))
ON CONFLICT DO NOTHING;
