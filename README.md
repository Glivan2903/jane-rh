# Gentis — Gestão de pessoas e negócios

Sistema web de gestão empresarial simples e integrado: **RH, Financeiro, Estoque, Configurações e Dashboard**, com dados reais em PostgreSQL, autenticação, permissões validadas no servidor, auditoria e backups reais.

## Arquitetura

| Camada | Tecnologia |
|---|---|
| Frontend (`web/`) | React 18 + TypeScript + Vite, Tailwind CSS, Recharts, GSAP, lucide-react |
| API (`server/`) | Node 20 + Express 4 + TypeScript, `pg` (SQL parametrizado), Zod, bcryptjs, helmet, express-rate-limit, multer |
| Banco | PostgreSQL 16 (`docker-compose.yml`), migrações SQL em `server/migrations` |

- O navegador **só fala com a API**; o banco nunca é exposto ao frontend (não há chave de serviço no cliente).
- Regras de negócio ficam no backend (`server/src/routes`, `server/src/services`) e as invariantes críticas também no banco (constraints e triggers).
- Em produção a API serve o `web/dist` (mesma origem, sem CORS).

### Segurança
- Senhas com **bcrypt** (custo 12); política: ao menos 10 caracteres, com letras e números.
- Sessão opaca (token aleatório; só o hash SHA-256 fica no banco) em cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` com `COOKIE_SECURE=true`); proteção CSRF por cabeçalho obrigatório nas escritas.
- Conta bloqueada por 15 min após 5 senhas erradas; rate limit no login e na troca de senha.
- Permissões (`módulo.operação`) lidas do banco **a cada requisição**: alterar um perfil vale imediatamente. Salário só é enviado a quem tem `rh.salary`.
- Auditoria (`audit_logs`), histórico do funcionário e movimentações de estoque são **imutáveis** (trigger bloqueia UPDATE/DELETE).
- Erros internos não vazam detalhes; a auditoria não grava senhas nem tokens.

### Regras de negócio importantes
- **Financeiro:** status armazenado = pendente | realizada | cancelada. *Vencida* é derivada (pendente com vencimento passado). *Previsto* = vencimento no período; *Realizado* = data efetiva da baixa. Cancelados nunca entram nos totais. Baixa única garantida por `UNIQUE(payment_records.transaction_id)` + lock da linha. O resultado é **do período, não saldo bancário** (não há integração bancária).
- **Estoque:** o saldo só muda por movimentação (transação com `SELECT … FOR UPDATE`) e `balance_after = balance_before + delta` é uma CHECK. Reenvio de formulário é ignorado via `idempotencyKey`. Saldo negativo é bloqueado (API **e** trigger) salvo configuração em *Parâmetros*. **Valorização: custo médio ponderado** (recalculado nas entradas com custo informado). Nenhuma movimentação gera lançamento financeiro automaticamente.
- **RH:** CPF validado e único; admissão, desligamento e alterações geram linha do tempo; desligado sai da lista padrão e nada é apagado; readmissão suportada. Campos do sistema legado: Nº Folha, Nº Identificador, PIS/PASEP (10–12 dígitos, para aceitar os valores antigos) e **optante por vale-transporte (Sim/Não)**.

### Dados da empresa e relatórios impressos
*Configurações → Dados da empresa*: razão social, nome fantasia, CNPJ (validado), IE, endereço (com busca por CEP), contatos e logotipo (PNG/JPG/WEBP até 1 MB, guardado com os anexos e incluído no backup). Esses dados formam o cabeçalho de todos os relatórios impressos (logotipo, identificação, título, filtros, período, data de emissão e responsável) e aparecem no topo do sistema. A impressão sai em A4 paisagem, com cabeçalho da tabela repetido em cada página.

## Vídeo de apresentação
Em `video/` está o vídeo de apresentação e usabilidade (`video/saida/gentis-apresentacao.mp4`) e todo o processo para regravá-lo; veja `video/README.md`.

## Como executar (desenvolvimento)

```bash
cp .env.example .env            # ajuste as senhas; DATABASE_URL deve combinar com DB_*
npm run install:all
npm run db:up                   # PostgreSQL via Docker
npm run migrate                 # cria tabelas e dados de referência (perfis, categorias, unidades)
npm run create-admin            # cria o 1º administrador (pede nome, e-mail e senha)
npm run dev:api                 # http://localhost:3001
npm run dev:web                 # http://localhost:5173 (proxy /api → 3001)
```

Não existe usuário padrão: o primeiro administrador é criado pelo comando acima (aceita `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`). Nenhum dado fictício é inserido.

## Produção

```bash
npm run build && NODE_ENV=production COOKIE_SECURE=true npm start
```

Coloque atrás de um proxy com **HTTPS** (Caddy/Nginx). O servidor precisa do cliente PostgreSQL (`pg_dump`/`psql`) para os backups, ou use `PG_DUMP_CMD`/`PSQL_CMD` (ver `.env.example`).

## Backups

*Configurações → Backup* gera um `.tar.gz` (dump SQL + anexos) com SHA-256, lista o histórico, baixa, verifica a integridade e restaura (confirmação digitando RESTAURAR; antes cria um backup de segurança). `BACKUP_AUTO_HOURS` liga o agendamento automático.

**Os arquivos ficam no servidor (`BACKUP_DIR`). Copie-os regularmente para outro local:** backup no mesmo disco não protege contra a perda do servidor.

## Testes

`npm test` roda 9 testes de integração contra um banco separado, `jane_test`, que precisa existir:
`docker exec jane-db psql -U jane -d postgres -c "CREATE DATABASE jane_test"`.

Cobrem: login, bloqueio e CSRF; permissões por perfil; RH (CPF, admissão, salário restrito, desligamento, histórico, CSV); Financeiro (baixa concorrente única, totais, cancelados, recorrência); Estoque (custo médio, idempotência, concorrência de saídas, trigger de saldo); Dashboard por permissão; usuários, senha, perfis e auditoria imutável; **backup e restauração reais**.

## Limitações conhecidas

- Recuperação de senha por e-mail **não implementada** (não há infraestrutura de e-mail): um administrador redefine a senha em *Usuários*.
- Não há estorno de baixa financeira; cancelar vale só para lançamentos pendentes. Um anexo por lançamento.
- Sem importação do sistema legado (os campos Nº Folha, Nº Identificador e PIS já existem).
- LGPD: há controle de acesso e minimização de dados, mas as políticas de retenção e anonimização são procedimentos a definir pela empresa.
- O preenchimento de endereço pelo CEP consulta o serviço público ViaCEP a partir do navegador (opcional; a digitação manual funciona).
- Sem testes automatizados de interface; a UI foi verificada manualmente no Chrome (desktop e 390 px).
