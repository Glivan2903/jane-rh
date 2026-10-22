-- Dados de inicialização (referência do sistema). Não contém funcionários, lançamentos ou produtos.

INSERT INTO permissions (code, module, description) VALUES
 ('dash.view','dash','Ver dashboard'),
 ('rh.view','rh','RH: visualizar'),
 ('rh.create','rh','RH: cadastrar'),
 ('rh.edit','rh','RH: editar'),
 ('rh.inactivate','rh','RH: inativar cargos/departamentos'),
 ('rh.export','rh','RH: exportar relatórios'),
 ('rh.salary','rh','RH: ver e alterar salário'),
 ('rh.admit','rh','RH: registrar admissão'),
 ('rh.terminate','rh','RH: registrar desligamento'),
 ('fin.view','fin','Financeiro: visualizar'),
 ('fin.create','fin','Financeiro: cadastrar'),
 ('fin.edit','fin','Financeiro: editar'),
 ('fin.inactivate','fin','Financeiro: inativar categorias'),
 ('fin.export','fin','Financeiro: exportar relatórios'),
 ('fin.settle','fin','Financeiro: registrar pagamento/recebimento'),
 ('fin.cancel','fin','Financeiro: cancelar lançamentos'),
 ('est.view','est','Estoque: visualizar'),
 ('est.create','est','Estoque: cadastrar produtos'),
 ('est.edit','est','Estoque: editar'),
 ('est.inactivate','est','Estoque: inativar'),
 ('est.export','est','Estoque: exportar relatórios'),
 ('est.move','est','Estoque: entradas e saídas'),
 ('est.adjust','est','Estoque: ajustes de inventário'),
 ('cfg.users','cfg','Config.: gerenciar usuários'),
 ('cfg.roles','cfg','Config.: gerenciar perfis e permissões'),
 ('cfg.backup','cfg','Config.: backup e restauração'),
 ('cfg.audit','cfg','Config.: consultar auditoria'),
 ('cfg.settings','cfg','Config.: parâmetros do sistema');

INSERT INTO roles (name, description, is_system) VALUES
 ('Administrador','Acesso completo, usuários, permissões e backups',true),
 ('RH','Cadastro de funcionários, admissões e desligamentos',true),
 ('Financeiro','Receitas, despesas, categorias e relatórios financeiros',true),
 ('Estoque','Produtos, movimentações e relatórios de estoque',true),
 ('Consulta','Somente visualização',true);

INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p WHERE r.name = 'Administrador';
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.name = 'RH' AND (p.module = 'rh' OR p.code = 'dash.view');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.name = 'Financeiro' AND (p.module = 'fin' OR p.code = 'dash.view');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.name = 'Estoque' AND (p.module = 'est' OR p.code = 'dash.view');
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r, permissions p
  WHERE r.name = 'Consulta' AND p.code IN ('dash.view','rh.view','fin.view','est.view');

INSERT INTO financial_categories (name, type) VALUES
 ('Vendas','receita'),('Serviços prestados','receita'),('Comissões','receita'),('Outras receitas','receita'),
 ('Aluguel','despesa'),('Salários','despesa'),('Água e energia','despesa'),('Internet e telefonia','despesa'),
 ('Materiais','despesa'),('Transporte','despesa'),('Impostos','despesa'),('Marketing','despesa'),
 ('Manutenção','despesa'),('Outras despesas','despesa');

INSERT INTO units_of_measure (code, name) VALUES
 ('UN','Unidade'),('CX','Caixa'),('PCT','Pacote'),('L','Litro'),('ML','Mililitro'),('KG','Quilo'),('M','Metro');

INSERT INTO product_categories (name) VALUES ('Geral');

INSERT INTO settings (key, value) VALUES ('allow_negative_stock', 'false'::jsonb);
