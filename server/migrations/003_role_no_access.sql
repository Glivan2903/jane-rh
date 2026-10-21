-- Perfil padrão para usuários recém-criados: nenhuma permissão até que um administrador defina o acesso.
INSERT INTO roles (name, description, is_system) VALUES ('Sem permissões', 'Acesso nenhum até definição pelo administrador', true)
ON CONFLICT (name) DO NOTHING;
