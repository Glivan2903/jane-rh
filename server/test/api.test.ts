// Testes de integração: sobem a API real contra o banco jane_test (recriado a cada execução).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://jane:dev-local-only-123@127.0.0.1:5439/jane_test';
process.env.PG_DUMP_CMD = 'docker exec -i jane-db pg_dump -U jane -d jane_test';
process.env.PSQL_CMD = 'docker exec -i jane-db psql -U jane -d jane_test -v ON_ERROR_STOP=1';
process.env.BACKUP_DIR = './storage/test-backups';
process.env.LOGIN_RATE_LIMIT = '1000';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';

const { createApp } = await import('../src/app.js');
const { migrate, pool } = await import('../src/db.js');

let server: Server; let base = '';

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown) {
    const r = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', 'x-requested-with': 'gentis', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text();
    let json: any; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json, headers: r.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b?: unknown) => this.req('POST', u, b ?? {});
  put = (u: string, b: unknown) => this.req('PUT', u, b);
  del = (u: string) => this.req('DELETE', u);
}

const PW = 'Senha12345x';
async function mkUser(email: string, role: string) {
  const r = (await pool.query('SELECT id FROM roles WHERE name=$1', [role])).rows[0];
  await pool.query(`INSERT INTO users (name,email,password_hash,role_id) VALUES ($1,$2,$3,$4)`, [`U ${role}`, email, await bcrypt.hash(PW, 4), r.id]);
}
async function login(email: string) {
  const c = new Client(); const r = await c.post('/api/auth/login', { login: email, password: PW });
  assert.equal(r.status, 200, JSON.stringify(r.body)); return c;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  for (const [e, r] of [['admin@t.local', 'Administrador'], ['rh@t.local', 'RH'], ['fin@t.local', 'Financeiro'], ['est@t.local', 'Estoque'], ['con@t.local', 'Consulta']]) await mkUser(e, r);
  server = createApp().listen(0); base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.close(); await pool.end(); });

const CPF1 = '52998224725', CPF2 = '11144477735';
const emp = (o = {}) => ({ fullName: 'Maria da Silva', cpf: CPF1, phone: '(11) 99999-0000', ...o });

test('autenticação: login, credenciais inválidas, CSRF, logout', async () => {
  const c = new Client();
  assert.equal((await c.get('/api/auth/me')).status, 401);
  assert.equal((await c.post('/api/auth/login', { login: 'admin@t.local', password: 'errada' })).status, 401);
  const r = await c.post('/api/auth/login', { login: 'ADMIN@t.local', password: PW });
  assert.equal(r.status, 200); assert.ok(r.body.permissions.includes('cfg.backup'));
  assert.equal((await c.get('/api/auth/me')).status, 200);
  // sem cabeçalho CSRF
  const raw = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: c.cookie } });
  assert.equal(raw.status, 403);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('bloqueio após tentativas e usuário inativo', async () => {
  await mkUser('lock@t.local', 'Consulta');
  const c = new Client();
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { login: 'lock@t.local', password: 'x' });
  assert.equal((await c.post('/api/auth/login', { login: 'lock@t.local', password: PW })).status, 401);
  await mkUser('off@t.local', 'Consulta'); await pool.query(`UPDATE users SET active=false WHERE email='off@t.local'`);
  assert.equal((await new Client().post('/api/auth/login', { login: 'off@t.local', password: PW })).status, 401);
});

test('permissões no backend por perfil', async () => {
  const con = await login('con@t.local'), fin = await login('fin@t.local'), rh = await login('rh@t.local'), est = await login('est@t.local');
  assert.equal((await con.get('/api/rh/employees')).status, 200);
  assert.equal((await con.post('/api/rh/employees', emp())).status, 403);
  assert.equal((await fin.get('/api/rh/employees')).status, 403);
  assert.equal((await rh.get('/api/fin/summary')).status, 403);
  assert.equal((await est.get('/api/config/users')).status, 403);
  assert.equal((await rh.get('/api/config/audit')).status, 403);
  assert.equal((await con.get('/api/config/backups')).status, 403);
});

test('RH: CPF inválido/duplicado, admissão, salário restrito, desligamento, histórico', async () => {
  const admin = await login('admin@t.local'), rh = await login('rh@t.local');
  const dep = (await admin.post('/api/rh/departments', { name: 'Operações', active: true })).body.id;
  const pos = (await admin.post('/api/rh/positions', { name: 'Analista', active: true })).body.id;
  assert.equal((await admin.post('/api/rh/departments', { name: 'operações' })).status, 409);

  assert.equal((await admin.post('/api/rh/employees', emp({ cpf: '11111111111' }))).status, 422);
  const c1 = await admin.post('/api/rh/employees', emp({ pisPasep: '12345678901', payrollNumber: '203', identifierNumber: '203', transportVoucher: true, salary: 3500.5 }));
  assert.equal(c1.status, 201, JSON.stringify(c1.body));
  const id = c1.body.id;
  const dup = await admin.post('/api/rh/employees', emp({ fullName: 'Outra Pessoa' }));
  assert.equal(dup.status, 409); assert.ok(dup.body.fields.cpf);

  const g = await admin.get(`/api/rh/employees/${id}`);
  assert.equal(g.body.status, 'pre_cadastro'); assert.equal(g.body.transportVoucher, true); assert.equal(g.body.pisPasep, '12345678901'); assert.equal(g.body.salary, '3500.50');
  assert.equal((await rh.get(`/api/rh/employees/${id}`)).body.salary, '3500.50'); // RH tem rh.salary
  const con = await login('con@t.local');
  assert.equal((await con.get(`/api/rh/employees/${id}`)).body.salary, undefined);

  // admissão
  assert.equal((await rh.post('/api/rh/admissions', { employeeId: id, admissionDate: '2999-01-01', positionId: pos, departmentId: dep, contractType: 'CLT' })).status, 422);
  const adm = await rh.post('/api/rh/admissions', { employeeId: id, admissionDate: '2026-01-10', positionId: pos, departmentId: dep, contractType: 'CLT', salary: 4000 });
  assert.equal(adm.status, 201, JSON.stringify(adm.body));
  assert.equal((await rh.post('/api/rh/admissions', { employeeId: id, admissionDate: '2026-01-10', positionId: pos, departmentId: dep, contractType: 'CLT' })).status, 409);
  assert.equal((await rh.get(`/api/rh/employees/${id}`)).body.status, 'ativo');

  // edição gera histórico
  const cur = (await rh.get(`/api/rh/employees/${id}`)).body;
  const pos2 = (await admin.post('/api/rh/positions', { name: 'Coordenador' })).body.id;
  assert.equal((await rh.put(`/api/rh/employees/${id}`, { ...cur, positionId: pos2, cpf: CPF1, birthDate: cur.birthDate, email: null, state: null })).status, 200);

  // desligamento
  assert.equal((await rh.post('/api/rh/terminations', { employeeId: id, terminationDate: '2025-01-01', reason: 'x' })).status, 422); // antes da admissão
  assert.equal((await rh.post('/api/rh/terminations', { employeeId: id, terminationDate: '2026-02-01', reason: 'Pedido de demissão' })).status, 201);
  assert.equal((await rh.post('/api/rh/terminations', { employeeId: id, terminationDate: '2026-02-01', reason: 'x' })).status, 409);
  const list = await rh.get('/api/rh/employees');
  assert.equal(list.body.rows.length, 0); // desligado fora da listagem padrão
  assert.equal((await rh.get('/api/rh/employees?status=desligado')).body.rows.length, 1);
  assert.equal((await rh.get('/api/rh/employees?q=529.982')).body.total, 0);
  assert.equal((await rh.get('/api/rh/employees?status=todos&q=529.982')).body.total, 1);

  const hist = (await rh.get(`/api/rh/employees/${id}/history`)).body.map((h: any) => h.eventType);
  for (const t of ['cadastro', 'admissao', 'mudanca_cargo', 'desligamento']) assert.ok(hist.includes(t), t);
  const csv = await rh.req('GET', '/api/rh/reports/cadastral?status=todos&format=csv');
  assert.equal(csv.status, 200); assert.match(String(csv.body), /Vale-transporte/); assert.match(String(csv.body), /Sim/);
  assert.equal((await con.req('GET', '/api/rh/reports/ativos?format=csv')).status, 403);
  // histórico imutável
  await assert.rejects(pool.query('DELETE FROM employment_history'));
});

test('Financeiro: lançamento, baixa única, indicadores, cancelados, categorias', async () => {
  const fin = await login('fin@t.local'), con = await login('con@t.local');
  const cats = (await fin.get('/api/fin/categories')).body;
  const catR = cats.find((c: any) => c.type === 'receita').id, catD = cats.find((c: any) => c.type === 'despesa').id;
  assert.equal((await fin.post('/api/fin/transactions', { type: 'receita', description: 'X', categoryId: catD, amount: 10, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).status, 422); // categoria do tipo errado
  assert.equal((await fin.post('/api/fin/transactions', { type: 'receita', description: 'X', categoryId: catR, amount: 0, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).status, 422);
  assert.equal((await fin.post('/api/fin/transactions', { type: 'receita', description: 'X', categoryId: catR, amount: 10.123, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).status, 422);

  const r1 = (await fin.post('/api/fin/transactions', { type: 'receita', description: 'Venda A', categoryId: catR, amount: 1000.1, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).body.id;
  const r2 = (await fin.post('/api/fin/transactions', { type: 'receita', description: 'Venda B', categoryId: catR, amount: 0.2, competenceDate: '2026-03-01', dueDate: '2026-03-12' })).body.id;
  const d1 = (await fin.post('/api/fin/transactions', { type: 'despesa', description: 'Aluguel', categoryId: catD, amount: 400, competenceDate: '2026-03-01', dueDate: '2026-03-05' })).body.id;
  const d2 = (await fin.post('/api/fin/transactions', { type: 'despesa', description: 'Cancelar', categoryId: catD, amount: 999, competenceDate: '2026-03-01', dueDate: '2026-03-06' })).body.id;
  assert.equal((await fin.post(`/api/fin/transactions/${d2}/cancel`, { reason: 'erro' })).status, 200);
  const rec = (await fin.post('/api/fin/transactions', { type: 'despesa', description: 'Internet', categoryId: catD, amount: 100, competenceDate: '2026-04-01', dueDate: '2026-04-15', repeatMonths: 3 })).body.ids;
  assert.equal(rec.length, 3);

  assert.equal((await con.post(`/api/fin/transactions/${r1}/settle`, { effectiveDate: '2026-03-10' })).status, 403);
  assert.equal((await fin.post(`/api/fin/transactions/${r1}/settle`, { effectiveDate: '2999-01-01' })).status, 422);
  assert.equal((await fin.post(`/api/fin/transactions/${r1}/settle`, { effectiveDate: '2026-03-10', method: 'PIX' })).status, 200);
  // baixa duplicada simultânea: só uma passa
  const results = await Promise.all([1, 2, 3].map(() => fin.post(`/api/fin/transactions/${d1}/settle`, { effectiveDate: '2026-03-05' })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM payment_records WHERE transaction_id=$1', [d1])).rows[0].n, 1);
  assert.equal((await fin.post(`/api/fin/transactions/${d2}/settle`, { effectiveDate: '2026-03-05' })).status, 409); // cancelada
  assert.equal((await fin.put(`/api/fin/transactions/${r1}`, { description: 'Venda A', categoryId: catR, amount: 5, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).status, 409); // travado após baixa

  const s = (await fin.get('/api/fin/summary?from=2026-03-01&to=2026-03-31')).body;
  assert.equal(s.receitas.previsto, 1000.3); assert.equal(s.receitas.recebido, 1000.1); assert.equal(s.receitas.aReceber, 0.2);
  assert.equal(s.despesas.previsto, 400); assert.equal(s.despesas.pago, 400); // cancelada (999) fora dos totais
  assert.equal(s.saldoRealizado, 600.1); assert.equal(s.saldoPrevisto, 600.3);
  assert.ok(s.vencidas.pagar >= 300); // parcelas de abril/maio/junho/2026 já vencidas? depende da data atual — apenas garante campo
  const list = (await fin.get('/api/fin/transactions?type=despesa&status=cancelada')).body;
  assert.equal(list.rows.length, 1);
  const pending = await fin.get('/api/fin/transactions?type=receita&status=vencida');
  assert.ok(pending.body.rows.every((r: any) => r.status === 'vencida'));

  // categoria usada não pode ser excluída
  assert.equal((await fin.del(`/api/fin/categories/${catR}`)).status, 409);
  const nova = (await fin.post('/api/fin/categories', { name: 'Teste', type: 'receita' })).body.id;
  assert.equal((await fin.del(`/api/fin/categories/${nova}`)).status, 200);
  const rep = await fin.req('GET', '/api/fin/reports/fluxo-caixa?from=2026-03-01&to=2026-03-31');
  assert.equal(rep.status, 200); assert.ok(rep.body.rows.length > 0);
});

test('Estoque: produto, entrada/saída, custo médio, saldo negativo, idempotência, ajuste, histórico', async () => {
  const est = await login('est@t.local'), admin = await login('admin@t.local');
  const unit = (await est.get('/api/est/units')).body[0].id;
  const p = await est.post('/api/est/products', { name: 'Parafuso', unitId: unit, cost: 2, minStock: 10, initialQuantity: 20, barcode: '789000111' });
  assert.equal(p.status, 201, JSON.stringify(p.body)); assert.match(p.body.code, /^PRD-\d{6}$/);
  assert.equal((await est.post('/api/est/products', { name: 'Dup', unitId: unit, barcode: '789000111' })).status, 409);
  const id = p.body.id;
  assert.equal((await est.get(`/api/est/products/${id}`)).body.quantity, '20.000');

  assert.equal((await est.post('/api/est/exits', { productId: id, quantity: 21, date: '2026-03-01', reason: 'Venda' })).status, 409);
  assert.equal((await est.post('/api/est/exits', { productId: id, quantity: -1, date: '2026-03-01', reason: 'Venda' })).status, 422);
  // entrada com custo → médio ponderado: (20*2 + 20*4)/40 = 3
  assert.equal((await est.post('/api/est/entries', { productId: id, quantity: 20, unitCost: 4, date: '2026-03-01', reason: 'Compra' })).status, 201);
  assert.equal(Number((await est.get(`/api/est/products/${id}`)).body.cost), 3);
  // idempotência
  const key = 'abcdef12345-key';
  const a = await est.post('/api/est/exits', { productId: id, quantity: 5, date: '2026-03-02', reason: 'Venda', idempotencyKey: key });
  const b = await est.post('/api/est/exits', { productId: id, quantity: 5, date: '2026-03-02', reason: 'Venda', idempotencyKey: key });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.body.duplicate, true);
  assert.equal(Number((await est.get(`/api/est/products/${id}`)).body.quantity), 35);
  // concorrência: 5 saídas de 10 com saldo 35 → só 3 passam
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => est.post('/api/est/exits', { productId: id, quantity: 10, date: '2026-03-02', reason: 'Consumo interno', idempotencyKey: `conc-key-${i}` })));
  assert.equal(rs.filter((r) => r.status === 201).length, 3);
  assert.equal(Number((await est.get(`/api/est/products/${id}`)).body.quantity), 5);

  // ajuste exige permissão; Estoque tem est.adjust
  assert.equal((await est.post('/api/est/adjustments', { productId: id, newQuantity: 5, date: '2026-03-03', reason: 'Contagem' })).status, 422); // sem diferença
  assert.equal((await est.post('/api/est/adjustments', { productId: id, newQuantity: 8, date: '2026-03-03', reason: 'Contagem' })).status, 201);
  const con = await login('con@t.local');
  assert.equal((await con.post('/api/est/adjustments', { productId: id, newQuantity: 9, date: '2026-03-03', reason: 'x' })).status, 403);

  // saldo = soma dos deltas
  const sum = (await pool.query('SELECT sum(delta) s FROM stock_movements WHERE product_id=$1', [id])).rows[0].s;
  assert.equal(Number(sum), 8);
  const mv = (await est.get(`/api/est/movements?productId=${id}`)).body;
  assert.ok(mv.rows.every((m: any) => Number(m.balanceAfter) === Number(m.balanceBefore) + Number(m.delta)));
  await assert.rejects(pool.query('DELETE FROM stock_movements'));
  // alertas: 8 <= mínimo 10
  assert.equal((await est.get('/api/est/alerts')).body.length, 1);
  // saldo negativo via configuração
  assert.equal((await est.put('/api/config/settings', { allow_negative_stock: true })).status, 403);
  await admin.put('/api/config/settings', { allow_negative_stock: true });
  assert.equal((await est.post('/api/est/exits', { productId: id, quantity: 10, date: '2026-03-03', reason: 'Venda' })).status, 201);
  await admin.put('/api/config/settings', { allow_negative_stock: false });
  // trigger no banco bloqueia mesmo fora da API
  await assert.rejects(pool.query('UPDATE products SET quantity = -50 WHERE id=$1', [id]));
  // produto inativo não movimenta
  assert.equal((await est.put(`/api/est/products/${id}`, { name: 'Parafuso', unitId: unit, minStock: 10, active: false, cost: 0 })).status, 200);
  assert.equal((await est.post('/api/est/entries', { productId: id, quantity: 1, date: '2026-03-03', reason: 'Compra' })).status, 409);
  assert.equal((await est.get('/api/est/movements?productId=' + id)).body.total > 0, true);
});

test('Dashboard consolida módulos conforme permissões', async () => {
  const admin = await login('admin@t.local'), fin = await login('fin@t.local');
  const d = (await admin.get('/api/dashboard?period=ano')).body;
  assert.ok(d.rh && d.financeiro && d.estoque && d.atividades.length > 0);
  const f = (await fin.get('/api/dashboard')).body;
  assert.ok(f.financeiro && !f.rh && !f.estoque);
  assert.ok(f.atividades.every((a: any) => a.module === 'financeiro'));
  assert.equal((await admin.get('/api/dashboard?period=custom&from=2026-05-01&to=2026-04-01')).status, 422);
});

test('Configurações: usuários, perfis, senha, auditoria', async () => {
  const admin = await login('admin@t.local');
  const roles = (await admin.get('/api/config/roles')).body;
  const roleRh = roles.find((r: any) => r.name === 'RH').id, roleAdm = roles.find((r: any) => r.name === 'Administrador').id;
  assert.equal((await admin.post('/api/config/users', { name: 'Novo', email: 'novo@t.local', roleId: roleRh, password: 'curta' })).status, 422);
  const nu = await admin.post('/api/config/users', { name: 'Novo', email: 'novo@t.local', roleId: roleRh, password: 'SenhaForte123' });
  assert.equal(nu.status, 201);
  assert.equal((await admin.post('/api/config/users', { name: 'Novo2', email: 'NOVO@t.local', roleId: roleRh, password: 'SenhaForte123' })).status, 409);
  // sem perfil: entra com "Sem permissões"
  const np = await admin.post('/api/config/users', { name: 'Sem Perfil', email: 'semperfil@t.local', password: 'SenhaForte123' });
  assert.equal(np.status, 201, JSON.stringify(np.body));
  assert.equal((await admin.get('/api/config/users?q=semperfil')).body.rows[0].role, 'Sem permissões');
  const sp = new Client(); await sp.post('/api/auth/login', { login: 'semperfil@t.local', password: 'SenhaForte123' });
  await sp.post('/api/auth/change-password', { current: 'SenhaForte123', password: 'OutraSenha123', confirm: 'OutraSenha123' });
  assert.equal((await sp.get('/api/rh/employees')).status, 403);
  assert.equal((await sp.get('/api/fin/summary')).status, 403);
  // senha nunca vaza
  assert.ok(!JSON.stringify((await admin.get('/api/config/users')).body).includes('password'));
  assert.ok(!JSON.stringify((await admin.get('/api/config/users')).body).includes('$2'));

  // primeiro login → troca obrigatória
  const u = new Client(); await u.post('/api/auth/login', { login: 'novo@t.local', password: 'SenhaForte123' });
  assert.equal((await u.get('/api/rh/employees')).status, 403);
  assert.equal((await u.post('/api/auth/change-password', { current: 'errada', password: 'OutraSenha123', confirm: 'OutraSenha123' })).status, 422);
  assert.equal((await u.post('/api/auth/change-password', { current: 'SenhaForte123', password: 'OutraSenha123', confirm: 'diferente1' })).status, 422);
  assert.equal((await u.post('/api/auth/change-password', { current: 'SenhaForte123', password: 'OutraSenha123', confirm: 'OutraSenha123' })).status, 200);
  assert.equal((await u.get('/api/rh/employees')).status, 200);

  // inativar encerra sessão e impede login
  assert.equal((await admin.put(`/api/config/users/${nu.body.id}`, { name: 'Novo', email: 'novo@t.local', roleId: roleRh, active: false })).status, 200);
  assert.equal((await u.get('/api/auth/me')).status, 401);
  // último admin protegido
  const me = (await admin.get('/api/auth/me')).body;
  assert.equal((await admin.put(`/api/config/users/${me.id}`, { name: me.name, email: me.email, roleId: roleRh, active: true })).status, 409);
  void roleAdm;

  // alterar permissões vale de imediato
  const rh = await login('rh@t.local');
  assert.equal((await rh.get('/api/rh/employees')).status, 200);
  await admin.put(`/api/config/roles/${roleRh}`, { name: 'RH', permissions: ['dash.view'] });
  assert.equal((await rh.get('/api/rh/employees')).status, 403);
  assert.equal((await admin.put(`/api/config/roles/${roleAdm}`, { name: 'Administrador', permissions: [] })).status, 409);

  const aud = (await admin.get('/api/config/audit?module=config')).body;
  assert.ok(aud.total > 0);
  assert.ok(!JSON.stringify(aud).includes('SenhaForte'));
  await assert.rejects(pool.query('UPDATE audit_logs SET summary=\'x\''));
  await assert.rejects(pool.query('DELETE FROM audit_logs'));
});

test('Dados da empresa: CNPJ validado, leitura por todos, logotipo restrito', async () => {
  const admin = await login('admin@t.local'), con = await login('con@t.local');
  assert.equal((await admin.put('/api/company', { legalName: 'Empresa X', cnpj: '11.222.333/0001-82' })).status, 422);
  assert.equal((await admin.put('/api/company', { legalName: '' })).status, 422);
  assert.equal((await con.put('/api/company', { legalName: 'Hack' })).status, 403);
  assert.equal((await admin.put('/api/company', { legalName: 'Empresa Exemplo Ltda', tradeName: 'Exemplo', cnpj: '11.222.333/0001-81', zip: '01310-100', city: 'São Paulo', state: 'sp', email: 'contato@exemplo.com' })).status, 200);
  const g = (await con.get('/api/company')).body;
  assert.equal(g.cnpj, '11222333000181'); assert.equal(g.state, 'SP'); assert.equal(g.logoVersion, null);
  // PNG 1x1
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = async (c: Client, name: string, type: string, data: Buffer) => { const fd = new FormData(); fd.append('file', new Blob([data], { type }), name); return (await fetch(base + '/api/company/logo', { method: 'POST', body: fd, headers: { cookie: c.cookie, 'x-requested-with': 'gentis' } })).status; };
  assert.equal(await up(con, 'logo.png', 'image/png', png), 403);
  assert.equal(await up(admin, 'logo.svg', 'image/svg+xml', Buffer.from('<svg/>')), 422);
  assert.equal(await up(admin, 'logo.png', 'image/png', png), 200);
  const v = (await con.get('/api/company')).body.logoVersion; assert.ok(v);
  const img = await fetch(base + '/api/company/logo', { headers: { cookie: con.cookie } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(base + '/api/company/logo')).status, 401);
});

test('Backup real: gerar, verificar integridade, baixar e restaurar', async () => {
  const admin = await login('admin@t.local'), con = await login('con@t.local');
  assert.equal((await con.post('/api/config/backups')).status, 403);
  const b = await admin.post('/api/config/backups');
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.ok(b.body.size > 200);
  const list = (await admin.get('/api/config/backups')).body.rows;
  assert.equal(list[0].status, 'concluido');
  assert.equal((await admin.post(`/api/config/backups/${list[0].id}/verify`)).body.ok, true);
  const dl = await fetch(`${base}/api/config/backups/${list[0].id}/download`, { headers: { cookie: admin.cookie } });
  assert.equal(dl.status, 200); assert.ok((await dl.arrayBuffer()).byteLength > 200);

  // restaurar: cria produto depois do backup e confirma que some
  const before = (await pool.query('SELECT count(*)::int n FROM products')).rows[0].n;
  await pool.query(`INSERT INTO products (code,name,unit_id) VALUES ('ZZ-TEMP','Temporário',1)`);
  assert.equal((await admin.post(`/api/config/backups/${list[0].id}/restore`, { confirm: 'nao' })).status, 422);
  const rst = await admin.post(`/api/config/backups/${list[0].id}/restore`, { confirm: 'RESTAURAR' });
  assert.equal(rst.status, 200, JSON.stringify(rst.body));
  assert.equal((await pool.query('SELECT count(*)::int n FROM products')).rows[0].n, before);
  assert.equal((await new Client().get('/api/auth/me')).status, 401);
  const again = await login('admin@t.local');
  assert.ok((await again.get('/api/config/backups')).body.rows.length >= 2); // inclui backup de segurança pré-restauração
});
