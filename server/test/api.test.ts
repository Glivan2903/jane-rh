// Testes de integração: sobem a API real contra o banco jane_test (recriado a cada execução).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://jane:dev-local-only-123@127.0.0.1:5439/jane_test';
process.env.PG_DUMP_CMD = 'docker exec -i jane-db pg_dump -U jane -d jane_test';
process.env.PSQL_CMD = 'docker exec -i jane-db psql -U jane -d jane_test -v ON_ERROR_STOP=1';
process.env.BACKUP_DIR = './storage/test-backups';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.FORGOT_RATE_LIMIT = '1000';

import test, { before, after } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';

const { createApp } = await import('../src/app.js');
const { migrate, pool } = await import('../src/db.js');
const { outbox } = await import('../src/services/mail.js');

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

test('Exclusões: produto, lançamento e funcionário com registro em auditoria', async () => {
  const admin = await login('admin@t.local');
  const logs = async (entity: string) => (await pool.query(`SELECT summary, details FROM audit_logs WHERE action='excluir' AND entity=$1`, [entity])).rows;

  // lançamento: pendente exclui; com baixa não
  const catR = (await admin.post('/api/fin/categories', { type: 'receita', name: 'Cat Del R' })).body.id;
  const t1 = (await admin.post('/api/fin/transactions', { type: 'receita', description: 'Apagar', categoryId: catR, amount: 50, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).body.id;
  const t2 = (await admin.post('/api/fin/transactions', { type: 'receita', description: 'Baixada', categoryId: catR, amount: 60, competenceDate: '2026-03-01', dueDate: '2026-03-10' })).body.id;
  assert.equal((await admin.post(`/api/fin/transactions/${t2}/settle`, { effectiveDate: '2026-03-10' })).status, 200);
  assert.equal((await admin.del(`/api/fin/transactions/${t2}`)).status, 409);
  assert.equal((await admin.del(`/api/fin/transactions/${t1}`)).status, 200);
  assert.equal((await admin.del(`/api/fin/transactions/${t1}`)).status, 404);
  assert.equal((await logs('transaction')).length, 1);

  // estorno da baixa: volta a pendente, permite nova baixa, edição de valor e exclusão
  const con = await login('con@t.local');
  assert.equal((await con.post(`/api/fin/transactions/${t2}/unsettle`, {})).status, 403);
  assert.equal((await admin.post(`/api/fin/transactions/${t2}/unsettle`, { reason: 'marcada por engano' })).status, 200);
  assert.equal((await admin.post(`/api/fin/transactions/${t2}/unsettle`, {})).status, 409);
  const st = (await pool.query('SELECT status, settled_date FROM financial_transactions WHERE id=$1', [t2])).rows[0];
  assert.equal(st.status, 'pendente'); assert.equal(st.settled_date, null);
  assert.equal((await pool.query('SELECT 1 FROM payment_records WHERE transaction_id=$1', [t2])).rowCount, 0);
  const est = (await pool.query(`SELECT details FROM audit_logs WHERE action='estornar' AND entity_id=$1`, [t2])).rows;
  assert.equal(est.length, 1); assert.equal(est[0].details.baixa.dataEfetiva, '2026-03-10');
  assert.equal((await admin.post(`/api/fin/transactions/${t2}/settle`, { effectiveDate: '2026-03-11' })).status, 200);
  assert.equal((await admin.post(`/api/fin/transactions/${t2}/unsettle`, {})).status, 200);
  assert.equal((await admin.put(`/api/fin/transactions/${t2}`, { description: 'Baixada', categoryId: catR, amount: 65, competenceDate: '2026-03-01', dueDate: '2026-03-20' })).status, 200);
  assert.equal((await admin.del(`/api/fin/transactions/${t2}`)).status, 200);

  // produto: sem movimentação exclui; com movimentação não
  const unit = (await admin.post('/api/est/units', { code: 'DL', name: 'Del unit' })).body.id;
  const p1 = (await admin.post('/api/est/products', { name: 'Sem mov', unitId: unit })).body.id;
  const p2 = (await admin.post('/api/est/products', { name: 'Com mov', unitId: unit, initialQuantity: 5, cost: 2 })).body.id;
  assert.equal((await admin.del(`/api/est/products/${p2}`)).status, 409);
  assert.equal((await admin.del(`/api/est/products/${p1}`)).status, 200);
  assert.equal((await logs('product')).length, 1);

  // funcionário: não ativo exclui (histórico junto); ativo não
  const e1 = (await admin.post('/api/rh/employees', emp({ cpf: '39053344705', fullName: 'Excluir Pessoa' }))).body.id;
  assert.ok(e1);
  assert.equal((await admin.del(`/api/rh/employees/${e1}`)).status, 200);
  assert.equal((await pool.query('SELECT 1 FROM employment_history WHERE employee_id=$1', [e1])).rowCount, 0);
  const l = await logs('employee');
  assert.equal(l.length, 1); assert.ok(l[0].details.historico.length >= 1);
});

test('Backup real (pg_dump): gerar, verificar, baixar e restaurar por mesclagem sem apagar nada', async () => {
  const admin = await login('admin@t.local'), con = await login('con@t.local');
  assert.equal((await con.post('/api/config/backups')).status, 403);
  await pool.query(`INSERT INTO products (code,name,unit_id) VALUES ('BK-DEL','Vai ser apagado',1), ('BK-MUD','Nome original',1)`);
  const b = await admin.post('/api/config/backups');
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.ok(b.body.size > 200); assert.equal(b.body.method, 'pg_dump');
  const list = (await admin.get('/api/config/backups')).body.rows;
  assert.equal(list[0].status, 'concluido');
  assert.equal((await admin.post(`/api/config/backups/${list[0].id}/verify`)).body.ok, true);
  const dl = await fetch(`${base}/api/config/backups/${list[0].id}/download`, { headers: { cookie: admin.cookie } });
  assert.equal(dl.status, 200); assert.ok((await dl.arrayBuffer()).byteLength > 200);

  // depois do backup: apaga um, altera outro e cria um novo
  await pool.query(`DELETE FROM products WHERE code='BK-DEL'`);
  await pool.query(`UPDATE products SET name='Nome alterado' WHERE code='BK-MUD'`);
  await pool.query(`INSERT INTO products (code,name,unit_id) VALUES ('BK-NOVO','Criado depois',1)`);
  assert.equal((await admin.post(`/api/config/backups/${list[0].id}/restore`, { confirm: 'nao' })).status, 422);
  const rst = await admin.post(`/api/config/backups/${list[0].id}/restore`, { confirm: 'RESTAURAR' });
  assert.equal(rst.status, 200, JSON.stringify(rst.body));
  assert.equal(rst.body.adicionados, 1); assert.ok(rst.body.identicos > 0); assert.ok(rst.body.mantidos >= 1);
  const name = async (code: string) => (await pool.query('SELECT name FROM products WHERE code=$1', [code])).rows[0]?.name;
  assert.equal(await name('BK-DEL'), 'Vai ser apagado');   // apagado volta
  assert.equal(await name('BK-MUD'), 'Nome alterado');     // versão atual é mantida
  assert.equal(await name('BK-NOVO'), 'Criado depois');    // criado depois continua
  assert.equal((await admin.get('/api/auth/me')).status, 200); // ninguém é desconectado
  assert.ok((await admin.get('/api/config/backups')).body.rows.length >= 2); // inclui backup de segurança pré-restauração
});

test('Backup sem pg_dump/psql: dump nativo guardado no banco, baixar e restaurar', async () => {
  const { config } = await import('../src/config.js');
  const saved = { dump: config.pgDumpCmd, psql: config.psqlCmd, path: process.env.PATH };
  config.pgDumpCmd = ''; config.psqlCmd = ''; process.env.BACKUP_STORAGE = 'db';
  process.env.PATH = (saved.path ?? '').split(':').filter((d) => !fs.existsSync(`${d}/pg_dump`)).join(':');
  try {
    const admin = await login('admin@t.local');
    await pool.query(`INSERT INTO products (code,name,unit_id) VALUES ('NAT-1','Aspas '' e \\ barra; fim',1)`);
    // auto-referência: gestor criado DEPOIS do subordinado (ordem de inserção não resolve sozinha)
    const sub = (await admin.post('/api/rh/employees', emp({ cpf: '12345678909', fullName: 'Ana Subordinada' }))).body.id;
    const chefe = (await admin.post('/api/rh/employees', emp({ cpf: '98765432100', fullName: 'Carlos Chefe' }))).body.id;
    assert.ok(sub && chefe);
    await pool.query('UPDATE employees SET manager_id=$1 WHERE id=$2', [chefe, sub]);
    const hist = (await pool.query('SELECT count(*)::int n FROM employment_history')).rows[0].n;
    const b = await admin.post('/api/config/backups');
    assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.method, 'nativo'); assert.equal(b.body.storage, 'banco');
    assert.equal((await pool.query('SELECT 1 FROM backup_files WHERE filename=$1', [b.body.filename])).rowCount, 1);
    assert.equal((await admin.post(`/api/config/backups/${b.body.id}/verify`)).body.ok, true);
    const dl = await fetch(`${base}/api/config/backups/${b.body.id}/download`, { headers: { cookie: admin.cookie } });
    assert.equal(dl.status, 200); assert.equal((await dl.arrayBuffer()).byteLength, b.body.size);

    // depois do backup: some o produto e os dois funcionários (com histórico); entra um produto novo
    await pool.query(`DELETE FROM products WHERE code='NAT-1'`);
    assert.equal((await admin.del(`/api/rh/employees/${sub}`)).status, 200);
    assert.equal((await admin.del(`/api/rh/employees/${chefe}`)).status, 200);
    await pool.query(`INSERT INTO products (code,name,unit_id) VALUES ('NAT-2','Depois do backup',1)`);
    const rst = await admin.post(`/api/config/backups/${b.body.id}/restore`, { confirm: 'RESTAURAR' });
    assert.equal(rst.status, 200, JSON.stringify(rst.body));
    assert.equal((await pool.query(`SELECT count(*)::int n FROM products WHERE code='NAT-2'`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT name FROM products WHERE code='NAT-1'`)).rows[0].name, "Aspas ' e \\ barra; fim");
    assert.equal((await pool.query('SELECT manager_id FROM employees WHERE id=$1', [sub])).rows[0].manager_id, chefe);
    assert.equal((await pool.query('SELECT count(*)::int n FROM employment_history')).rows[0].n, hist);
    const rows = (await admin.get('/api/config/backups')).body.rows;
    assert.ok(rows.some((r: any) => r.filename === b.body.filename && r.restoredAt));
    // sequências não voltam para trás: um novo registro não colide com os restaurados
    const novo = await admin.post('/api/rh/employees', emp({ cpf: '24681357928', fullName: 'Depois da Restauração' }));
    assert.equal(novo.status, 201, JSON.stringify(novo.body));
  } finally {
    config.pgDumpCmd = saved.dump; config.psqlCmd = saved.psql; process.env.PATH = saved.path; delete process.env.BACKUP_STORAGE;
  }
});

test('recuperação de senha por e-mail: link único, expira, encerra sessões e não revela se o e-mail existe', async () => {
  await mkUser('rec@t.local', 'Consulta');
  const c = new Client();
  const antes = outbox.length;
  const a = await c.post('/api/auth/forgot-password', { email: 'inexistente@t.local' });
  const b = await c.post('/api/auth/forgot-password', { email: 'REC@t.local' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.body, b.body);                    // mesma resposta existindo ou não
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(outbox.length, antes + 1);
  assert.equal(outbox.at(-1)!.to, 'rec@t.local');
  const token = /token=([0-9a-f]+)/.exec(outbox.at(-1)!.text)![1];
  // o banco guarda só o hash
  assert.equal((await pool.query('SELECT 1 FROM password_resets WHERE token_hash = $1', [token])).rowCount, 0);

  // reenvio imediato não gera novo e-mail
  await c.post('/api/auth/forgot-password', { email: 'rec@t.local' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(outbox.length, antes + 1);

  const sess = await login('rec@t.local');             // sessão anterior deve cair
  assert.equal((await c.post('/api/auth/reset-password', { token, password: 'fraca', confirm: 'fraca' })).status, 422);
  assert.equal((await c.post('/api/auth/reset-password', { token: 'x'.repeat(64), password: 'NovaSenha123', confirm: 'NovaSenha123' })).status, 400);
  const ok = await c.post('/api/auth/reset-password', { token, password: 'NovaSenha123', confirm: 'NovaSenha123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await sess.get('/api/auth/me')).status, 401);
  assert.equal((await c.post('/api/auth/reset-password', { token, password: 'OutraSenha123', confirm: 'OutraSenha123' })).status, 400); // uso único
  assert.equal((await new Client().post('/api/auth/login', { login: 'rec@t.local', password: PW })).status, 401);
  assert.equal((await new Client().post('/api/auth/login', { login: 'rec@t.local', password: 'NovaSenha123' })).status, 200);

  // token expirado
  await pool.query(`UPDATE users SET failed_attempts=0 WHERE email='rec@t.local'`);
  await c.post('/api/auth/forgot-password', { email: 'rec@t.local' });
  await new Promise((r) => setTimeout(r, 100));
  const t2 = /token=([0-9a-f]+)/.exec(outbox.at(-1)!.text)![1];
  await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute'`);
  assert.equal((await c.post('/api/auth/reset-password', { token: t2, password: 'OutraSenha123', confirm: 'OutraSenha123' })).status, 400);
});

test('cadastro único: cliente/fornecedor, documento, espelho no estoque e vínculo no financeiro', async () => {
  const admin = await login('admin@t.local'), fin = await login('fin@t.local'), con = await login('con@t.local'), rh = await login('rh@t.local');
  assert.equal((await rh.get('/api/cad/parties')).status, 403);
  assert.equal((await con.post('/api/cad/parties', { name: 'X', isCustomer: true })).status, 403);
  assert.equal((await con.get('/api/cad/parties')).status, 200);

  assert.equal((await fin.post('/api/cad/parties', { name: 'Sem tipo' })).status, 422);
  assert.equal((await fin.post('/api/cad/parties', { name: 'Doc ruim', isCustomer: true, document: '123' })).status, 422);
  const cli = await fin.post('/api/cad/parties', { name: 'Cliente Alfa', isCustomer: true, document: '529.982.247-25', email: 'ALFA@x.com' });
  assert.equal(cli.status, 201, JSON.stringify(cli.body));
  assert.equal((await fin.post('/api/cad/parties', { name: 'cliente alfa', isCustomer: true })).status, 409);
  assert.equal((await fin.post('/api/cad/parties', { name: 'Outro', isCustomer: true, document: '52998224725' })).status, 409);
  const g = (await fin.get(`/api/cad/parties/${cli.body.id}`)).body;
  assert.equal(g.document, '52998224725'); assert.equal(g.email, 'alfa@x.com'); assert.equal(g.isSupplier, false);

  const forn = await fin.post('/api/cad/parties', { name: 'Fornecedor Beta', isSupplier: true, document: '11222333000181' });
  assert.equal(forn.status, 201, JSON.stringify(forn.body));
  // espelho: aparece na lista de fornecedores do estoque
  const sups = (await admin.get('/api/est/suppliers?active=true')).body as { name: string }[];
  assert.ok(sups.some((s) => s.name === 'Fornecedor Beta')); assert.ok(!sups.some((s) => s.name === 'Cliente Alfa'));
  assert.equal((await admin.post('/api/est/suppliers', { name: 'Direto' })).status, 404); // cadastro só pelo novo módulo

  // listagem e filtros
  assert.equal((await admin.get('/api/cad/parties?kind=customer&q=alfa')).body.total, 1);
  assert.equal((await admin.get('/api/cad/parties?kind=supplier&q=alfa')).body.total, 0);
  assert.deepEqual((await admin.get('/api/cad/parties/options?kind=supplier')).body.map((p: any) => p.name), ['Fornecedor Beta']);

  // financeiro: o cadastro vira o texto exibido; tipo errado é recusado
  const cat = (await admin.post('/api/fin/categories', { name: 'Vendas Cad', type: 'receita' })).body.id;
  const catD = (await admin.post('/api/fin/categories', { name: 'Compras Cad', type: 'despesa' })).body.id;
  const base = { description: 'Venda', categoryId: cat, amount: 100, competenceDate: '2026-02-01', dueDate: '2026-02-10' };
  assert.equal((await fin.post('/api/fin/transactions', { type: 'receita', ...base, partyId: forn.body.id })).status, 422);
  const t = await fin.post('/api/fin/transactions', { type: 'receita', ...base, partyId: cli.body.id, party: 'texto ignorado' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const row = (await fin.get(`/api/fin/transactions/${t.body.id}`)).body;
  assert.equal(row.party, 'Cliente Alfa'); assert.equal(row.partyId, cli.body.id);
  assert.equal((await fin.post('/api/fin/transactions', { type: 'despesa', ...base, categoryId: catD, partyId: forn.body.id })).status, 201);
  assert.equal((await fin.post('/api/fin/transactions', { type: 'despesa', ...base, categoryId: catD, party: 'Texto livre' })).status, 201); // texto livre segue valendo

  // uso, inativação e espelho
  assert.equal((await admin.get(`/api/cad/parties/${cli.body.id}`)).body.usageCount, 1);
  const off = await admin.put(`/api/cad/parties/${forn.body.id}`, { name: 'Fornecedor Beta', isSupplier: true, active: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.ok(!(await admin.get('/api/est/suppliers?active=true')).body.some((s: any) => s.name === 'Fornecedor Beta'));
  assert.equal((await fin.post('/api/fin/transactions', { type: 'despesa', ...base, categoryId: catD, partyId: forn.body.id })).status, 422); // inativo
  assert.equal((await fin.put(`/api/cad/parties/${forn.body.id}`, { name: 'Fornecedor Beta', isSupplier: true, active: true })).status, 403); // fin não tem cad.inactivate
});
