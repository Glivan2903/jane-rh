// Popula o banco de DEMONSTRAÇÃO (jane_demo, API na porta 3003) com dados fictícios para o vídeo.
// Nunca aponte para o banco real.
const base = process.env.DEMO_API ?? 'http://localhost:3003/api';
let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'gentis', cookie }, body: body ? JSON.stringify(body) : undefined });
  const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status} ${t}`);
  return j;
}
const cpf = (seed) => { const d = String(seed).padStart(9, '0').split('').map(Number); for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); d.push(((s * 10) % 11) % 10); } return d.join(''); };
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

await call('POST', '/auth/login', { login: 'admin@gentis.demo', password: 'GentisDemo2026' });

// ---- RH ----
const dep = {}; for (const n of ['Administrativo', 'Atendimento', 'Comercial', 'Operações', 'Recursos Humanos']) dep[n] = (await call('POST', '/rh/departments', { name: n })).id;
const pos = {}; for (const n of ['Analista Administrativo', 'Atendente', 'Consultor Comercial', 'Coordenador de Operações', 'Analista de RH', 'Auxiliar de Operações']) pos[n] = (await call('POST', '/rh/positions', { name: n })).id;
const people = [
  ['Juliana Ferreira Lima', 'Analista de RH', 'Recursos Humanos', '2025-02-03', 4200, true],
  ['Rafael Souza Martins', 'Consultor Comercial', 'Comercial', '2025-05-12', 3800, false],
  ['Camila Rocha Andrade', 'Atendente', 'Atendimento', '2025-08-01', 2300, true],
  ['Bruno Almeida Castro', 'Coordenador de Operações', 'Operações', '2024-11-18', 6200, false],
  ['Patrícia Gomes Nunes', 'Analista Administrativo', 'Administrativo', '2026-03-09', 3900, true],
  ['Lucas Pereira Duarte', 'Auxiliar de Operações', 'Operações', '2026-06-02', 2100, true],
  ['Fernanda Ribeiro Alves', 'Atendente', 'Atendimento', '2026-09-15', 2300, true],
  ['Diego Carvalho Pinto', 'Consultor Comercial', 'Comercial', '2026-10-06', 3800, false],
];
const ids = [];
for (const [i, [name, p, d, adm, sal, vt]] of people.entries()) {
  const r = await call('POST', '/rh/employees', {
    fullName: name, cpf: cpf(310000101 + i * 7919), phone: `(11) 9${8100 + i}-${4000 + i * 13}`, email: name.split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() + '@email.demo',
    pisPasep: String(12000000000 + i * 7771), payrollNumber: String(100500 + i), identifierNumber: String(100500 + i), transportVoucher: vt,
    positionId: pos[p], departmentId: dep[d], contractType: 'CLT', admissionDate: adm, salary: sal, workload: '44h semanais', city: 'São Paulo', state: 'SP',
  });
  ids.push(r.id);
}
await call('POST', '/rh/terminations', { employeeId: ids[1], terminationDate: '2026-09-30', reason: 'Pedido de demissão' });
await call('POST', '/rh/employees', { fullName: 'Gabriel Moreira Santos', cpf: cpf(310999001), phone: '(11) 98777-1234' }); // aguardando admissão

// ---- Financeiro ----
const cats = await call('GET', '/fin/categories');
const C = (n) => cats.find((c) => c.name === n).id;
for (let m = 5; m <= 10; m++) {
  const mm = String(m).padStart(2, '0');
  const settled = m < 10;
  await call('POST', '/fin/transactions', { type: 'receita', description: `Vendas do mês ${mm}/2026`, categoryId: C('Vendas'), party: 'Clientes diversos', amount: 18000 + m * 1350.5, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 10), method: 'PIX', settledDate: settled ? iso(2026, m, 10) : undefined });
  await call('POST', '/fin/transactions', { type: 'receita', description: `Contrato de serviços ${mm}/2026`, categoryId: C('Serviços prestados'), party: 'Empresa Alfa (fictícia)', amount: 6500, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 15), method: 'Boleto', settledDate: settled ? iso(2026, m, 16) : undefined });
  await call('POST', '/fin/transactions', { type: 'despesa', description: `Aluguel ${mm}/2026`, categoryId: C('Aluguel'), party: 'Imobiliária Exemplo', amount: 5200, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 5), method: 'Boleto', settledDate: settled ? iso(2026, m, 5) : undefined });
  await call('POST', '/fin/transactions', { type: 'despesa', description: `Folha de pagamento ${mm}/2026`, categoryId: C('Salários'), amount: 24500, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 5), method: 'Transferência', settledDate: settled ? iso(2026, m, 5) : undefined });
  await call('POST', '/fin/transactions', { type: 'despesa', description: `Energia elétrica ${mm}/2026`, categoryId: C('Água e energia'), party: 'Concessionária', amount: 890 + m * 23.4, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 20), method: 'Boleto', settledDate: settled ? iso(2026, m, 19) : undefined });
  await call('POST', '/fin/transactions', { type: 'despesa', description: `Marketing digital ${mm}/2026`, categoryId: C('Marketing'), amount: 1800, competenceDate: iso(2026, m, 1), dueDate: iso(2026, m, 25), method: 'Cartão de crédito', settledDate: settled ? iso(2026, m, 25) : undefined });
}
await call('POST', '/fin/transactions', { type: 'despesa', description: 'Internet e telefonia', categoryId: C('Internet e telefonia'), party: 'Operadora', amount: 420, competenceDate: '2026-11-01', dueDate: '2026-11-10', method: 'Boleto', repeatMonths: 3 });
await call('POST', '/fin/transactions', { type: 'despesa', description: 'Manutenção do ar-condicionado', categoryId: C('Manutenção'), party: 'Clima Serviços', amount: 750, competenceDate: '2026-10-01', dueDate: '2026-10-12', method: 'PIX' });

// ---- Estoque ----
const units = await call('GET', '/est/units'); const U = (c) => units.find((u) => u.code === c).id;
const pc = {}; for (const n of ['Escritório', 'Limpeza', 'Informática', 'Copa']) pc[n] = (await call('POST', '/est/categories', { name: n })).id;
const sup = (await call('POST', '/est/suppliers', { name: 'Distribuidora Central (fictícia)' })).id;
const prods = [
  ['Papel A4 75g (resma)', 'Escritório', 'PCT', 22.9, 40, 15], ['Caneta esferográfica azul', 'Escritório', 'CX', 18.5, 12, 5],
  ['Toner impressora laser', 'Informática', 'UN', 189, 3, 2], ['Mouse sem fio', 'Informática', 'UN', 59.9, 8, 3],
  ['Detergente neutro 5L', 'Limpeza', 'UN', 32.4, 4, 6], ['Papel toalha (fardo)', 'Limpeza', 'PCT', 41, 0, 4], ['Café torrado 500g', 'Copa', 'PCT', 24.9, 10, 8],
];
const pid = {};
for (const [name, cat, u, cost, q, min] of prods) pid[name] = (await call('POST', '/est/products', { name, categoryId: pc[cat], unitId: U(u), cost, minStock: min, initialQuantity: q, supplierId: sup, location: 'Almoxarifado' })).id;
await call('POST', '/est/exits', { productId: pid['Papel A4 75g (resma)'], quantity: 12, date: '2026-10-14', reason: 'Consumo interno', destination: 'Administrativo' });
await call('POST', '/est/exits', { productId: pid['Café torrado 500g'], quantity: 4, date: '2026-10-16', reason: 'Consumo interno', destination: 'Copa' });
await call('POST', '/est/entries', { productId: pid['Caneta esferográfica azul'], quantity: 6, unitCost: 20.5, date: '2026-10-17', reason: 'Compra', docNumber: '4821', supplierId: sup });

// ---- Usuários ----
const roles = await call('GET', '/config/roles'); const R = (n) => roles.find((r) => r.name === n).id;
await call('POST', '/config/users', { name: 'Juliana Ferreira Lima', email: 'juliana@gentis.demo', roleId: R('RH'), password: 'GentisDemo2026' });
await call('POST', '/config/users', { name: 'Carlos Mendes', email: 'financeiro@gentis.demo', roleId: R('Financeiro'), password: 'GentisDemo2026' });
console.log('Dados de demonstração criados.');
