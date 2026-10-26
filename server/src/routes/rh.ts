import { Router, type Request } from 'express';
import { z } from 'zod';
import { pool, tx, type Q } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, Where, h, likeEsc, listParams, onlyDigits, optDate, optInt, optMoney, optStr, parse, qstr, reqDate, reqStr, sendReport, today, validCpf } from '../util.js';
import { lookupRouter } from './lookup.js';

export const rhRouter = Router();

rhRouter.use('/departments', lookupRouter({
  table: 'departments', label: 'Departamento', module: 'rh', viewPerms: ['rh.view'],
  createPerm: 'rh.create', editPerm: 'rh.edit', inactivatePerm: 'rh.inactivate', usedBy: [{ table: 'employees', column: 'department_id' }],
}));
rhRouter.use('/positions', lookupRouter({
  table: 'job_positions', label: 'Cargo', module: 'rh', viewPerms: ['rh.view'],
  createPerm: 'rh.create', editPerm: 'rh.edit', inactivatePerm: 'rh.inactivate', usedBy: [{ table: 'employees', column: 'position_id' }],
}));

const UF = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
const CONTRACTS = ['CLT', 'PJ', 'Estágio', 'Temporário', 'Aprendiz', 'Autônomo', 'Outro'];
const GENDERS = ['Masculino', 'Feminino', 'Outro', 'Não informado'];
const MARITAL = ['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'];

const nullable = (s: z.ZodTypeAny) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable().optional());

const employeeSchema = z.object({
  fullName: reqStr(150, 'Informe o nome completo').refine((n) => n.split(/\s+/).length >= 2, 'Informe nome e sobrenome'),
  cpf: z.string({ required_error: 'Informe o CPF' }).refine(validCpf, 'CPF inválido'),
  pisPasep: nullable(z.string().transform(onlyDigits).refine((s) => s.length >= 10 && s.length <= 12, 'PIS/PASEP deve ter de 10 a 12 dígitos')),
  payrollNumber: optStr(30),
  esocial: optStr(30),
  cbo: nullable(z.string().transform(onlyDigits).refine((s) => s.length === 6, 'CBO deve ter 6 dígitos')),
  identifierNumber: optStr(30),
  transportVoucher: z.boolean().default(false),
  registration: optStr(30),
  birthDate: optDate.refine((d) => !d || d < today(), 'Data de nascimento inválida'),
  gender: nullable(z.enum(GENDERS as [string, ...string[]])),
  maritalStatus: nullable(z.enum(MARITAL as [string, ...string[]])),
  phone: reqStr(30, 'Informe o telefone principal'),
  phoneAlt: optStr(30),
  email: nullable(z.string().trim().toLowerCase().email('E-mail inválido').max(200)),
  zip: nullable(z.string().transform(onlyDigits).refine((s) => s.length === 8, 'CEP deve ter 8 dígitos')),
  street: optStr(200), number: optStr(20), complement: optStr(100), district: optStr(100), city: optStr(100),
  state: nullable(z.string().trim().toUpperCase().regex(UF, 'UF inválida')),
  notes: optStr(2000),
  positionId: optInt, departmentId: optInt,
  contractType: nullable(z.enum(CONTRACTS as [string, ...string[]])),
  admissionDate: optDate,
  salary: optMoney,
  workload: optStr(100),
  managerId: nullable(z.string().uuid()),
  corporateEmail: nullable(z.string().trim().toLowerCase().email('E-mail corporativo inválido').max(200)),
  corporatePhone: optStr(30),
  professionalNotes: optStr(2000),
});
type EmployeeInput = z.infer<typeof employeeSchema>;

const COLS: Record<keyof EmployeeInput, string> = {
  fullName: 'full_name', cpf: 'cpf', pisPasep: 'pis_pasep', payrollNumber: 'payroll_number', cbo: 'cbo', esocial: 'esocial', identifierNumber: 'identifier_number',
  transportVoucher: 'transport_voucher', registration: 'registration', birthDate: 'birth_date', gender: 'gender', maritalStatus: 'marital_status',
  phone: 'phone', phoneAlt: 'phone_alt', email: 'email', zip: 'zip', street: 'street', number: 'number', complement: 'complement',
  district: 'district', city: 'city', state: 'state', notes: 'notes', positionId: 'position_id', departmentId: 'department_id',
  contractType: 'contract_type', admissionDate: 'admission_date', salary: 'salary', workload: 'workload', managerId: 'manager_id',
  corporateEmail: 'corporate_email', corporatePhone: 'corporate_phone', professionalNotes: 'professional_notes',
};
const LABELS: Partial<Record<keyof EmployeeInput, string>> = {
  fullName: 'nome', cpf: 'CPF', pisPasep: 'PIS/PASEP', payrollNumber: 'Nº Folha', cbo: 'CBO', esocial: 'eSocial', identifierNumber: 'Nº Identificador',
  transportVoucher: 'vale-transporte', birthDate: 'data de nascimento', gender: 'sexo', maritalStatus: 'estado civil', phone: 'telefone',
  phoneAlt: 'telefone alternativo', email: 'e-mail', zip: 'CEP', street: 'endereço', number: 'número', complement: 'complemento',
  district: 'bairro', city: 'cidade', state: 'UF', notes: 'observações', workload: 'jornada', managerId: 'gestor',
  corporateEmail: 'e-mail corporativo', corporatePhone: 'telefone corporativo', professionalNotes: 'observações profissionais',
  contractType: 'tipo de vínculo', salary: 'salário',
};

const SELECT = `
  e.id, e.registration, e.payroll_number AS "payrollNumber", e.cbo, e.esocial, e.identifier_number AS "identifierNumber", e.pis_pasep AS "pisPasep",
  e.transport_voucher AS "transportVoucher", e.full_name AS "fullName", e.cpf, e.birth_date AS "birthDate", e.gender, e.marital_status AS "maritalStatus",
  e.phone, e.phone_alt AS "phoneAlt", e.email, e.zip, e.street, e.number, e.complement, e.district, e.city, e.state, e.notes,
  e.position_id AS "positionId", jp.name AS position, e.department_id AS "departmentId", d.name AS department,
  e.contract_type AS "contractType", e.admission_date AS "admissionDate", e.termination_date AS "terminationDate",
  e.termination_reason AS "terminationReason", e.salary, e.workload, e.manager_id AS "managerId", m.full_name AS "managerName",
  e.corporate_email AS "corporateEmail", e.corporate_phone AS "corporatePhone", e.professional_notes AS "professionalNotes",
  e.status, e.created_at AS "createdAt", e.updated_at AS "updatedAt"`;
const FROM = `FROM employees e LEFT JOIN job_positions jp ON jp.id = e.position_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN employees m ON m.id = e.manager_id`;

// DATE vira string 'YYYY-MM-DD' (evita deslocamento de fuso)
const stripSalary = <T extends { salary?: unknown }>(req: Request, row: T) => {
  if (!hasPerm(req, 'rh.salary')) delete row.salary;
  return row;
};

async function addHistory(c: Q, req: Request, employeeId: string, type: string, description: string, data?: object) {
  await c.query(
    `INSERT INTO employment_history (employee_id, event_type, description, data, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
    [employeeId, type, description, data ? JSON.stringify(data) : null, req.user!.id, req.user!.name]);
}

function dupError(e: unknown): never {
  const err = e as { code?: string; constraint?: string };
  if (err.code === '23505') {
    const map: Record<string, [string, string]> = {
      employees_cpf_key: ['cpf', 'CPF já cadastrado'], employees_registration_key: ['registration', 'Matrícula já em uso'],
      employees_pis_uq: ['pisPasep', 'PIS/PASEP já cadastrado'], employees_payroll_uq: ['payrollNumber', 'Nº Folha já cadastrado'],
    };
    const [f, m] = map[err.constraint ?? ''] ?? ['cpf', 'Registro duplicado'];
    throw new HttpError(409, m, { [f]: m });
  }
  throw e;
}

async function checkRefs(c: Q, d: EmployeeInput) {
  if (d.positionId && !(await c.query('SELECT 1 FROM job_positions WHERE id=$1 AND active', [d.positionId])).rowCount) throw new HttpError(422, 'Cargo inválido ou inativo', { positionId: 'Cargo inválido ou inativo' });
  if (d.departmentId && !(await c.query('SELECT 1 FROM departments WHERE id=$1 AND active', [d.departmentId])).rowCount) throw new HttpError(422, 'Departamento inválido ou inativo', { departmentId: 'Departamento inválido ou inativo' });
}

// ---------- Listagem ----------
rhRouter.get('/employees', requireAuth('rh.view'), h(async (req, res) => {
  const p = listParams(req, { name: 'lower(e.full_name)', admission: 'e.admission_date', position: 'lower(jp.name)', department: 'lower(d.name)', status: 'e.status', registration: 'e.registration' }, 'name');
  const w = new Where();
  if (p.q) {
    const dig = onlyDigits(p.q);
    w.add(`(e.full_name ILIKE ? OR jp.name ILIKE ? OR d.name ILIKE ? OR e.registration ILIKE ? OR e.payroll_number ILIKE ?${dig ? ' OR e.cpf LIKE ? OR e.pis_pasep LIKE ?' : ''})`,
      ...[likeEsc(p.q), likeEsc(p.q), likeEsc(p.q), likeEsc(p.q), likeEsc(p.q)], ...(dig ? [`%${dig}%`, `%${dig}%`] : []));
  }
  const st = qstr(req, 'status') ?? 'ativo';
  if (st !== 'todos') w.add('e.status = ?', st);
  const from = qstr(req, 'admissionFrom'); if (from) w.add('e.admission_date >= ?', from);
  const to = qstr(req, 'admissionTo'); if (to) w.add('e.admission_date <= ?', to);
  const dep = qstr(req, 'departmentId'); if (dep) w.add('e.department_id = ?', Number(dep));
  const pos = qstr(req, 'positionId'); if (pos) w.add('e.position_id = ?', Number(pos));
  const total = (await pool.query(`SELECT count(*)::int n ${FROM} ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${SELECT} ${FROM} ${w.sql} ORDER BY ${p.sort} ${p.dir}, e.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows: rows.map((r) => stripSalary(req, r)), total, page: p.page, pageSize: p.pageSize });
}));

rhRouter.get('/employees/options', requireAuth('rh.view'), h(async (req, res) => {
  const w = new Where();
  const st = qstr(req, 'status'); if (st) w.add('status = ?', st);
  if (req.query.q) w.add('(full_name ILIKE ? OR cpf LIKE ?)', likeEsc(String(req.query.q)), `%${onlyDigits(String(req.query.q)) || 'x'}%`);
  res.json((await pool.query(`SELECT id, full_name AS "fullName", status, registration FROM employees ${w.sql} ORDER BY lower(full_name) LIMIT 50`, w.params)).rows);
}));

rhRouter.get('/employees/:id', requireAuth('rh.view'), h(async (req, res) => {
  const r = (await pool.query(`SELECT ${SELECT} ${FROM} WHERE e.id = $1`, [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Funcionário não encontrado');
  res.json(stripSalary(req, r));
}));

rhRouter.get('/employees/:id/history', requireAuth('rh.view'), h(async (req, res) => {
  const rows = (await pool.query(
    `SELECT id, at, event_type AS "eventType", description, data, user_name AS "userName"
       FROM employment_history WHERE employee_id=$1 ORDER BY at DESC, id DESC`, [req.params.id])).rows;
  if (!hasPerm(req, 'rh.salary')) for (const r of rows) if (r.data) { delete r.data.salary; delete r.data.de?.salary; delete r.data.para?.salary; }
  res.json(rows);
}));

// ---------- Cadastro ----------
rhRouter.post('/employees', requireAuth('rh.create'), h(async (req, res) => {
  const d = parse(employeeSchema, req.body);
  const admitting = !!d.admissionDate;
  if (admitting && !hasPerm(req, 'rh.admit')) throw new HttpError(403, 'Sem permissão para registrar admissão.');
  if (d.salary != null && !hasPerm(req, 'rh.salary')) d.salary = null;
  if (d.admissionDate && d.admissionDate > today()) throw new HttpError(422, 'Data de admissão não pode ser futura', { admissionDate: 'Data de admissão não pode ser futura' });
  try {
    const id = await tx(async (c) => {
      await checkRefs(c, d);
      const reg = d.registration || `M${String((await c.query(`SELECT nextval('employee_registration_seq') n`)).rows[0].n).padStart(6, '0')}`;
      const keys = Object.keys(COLS) as (keyof EmployeeInput)[];
      const vals = keys.map((k) => (k === 'registration' ? reg : (d[k] ?? null)));
      const q = await c.query(
        `INSERT INTO employees (${keys.map((k) => COLS[k]).join(',')}, status) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}, $${keys.length + 1}) RETURNING id`,
        [...vals, admitting ? 'ativo' : 'pre_cadastro']);
      const id = q.rows[0].id as string;
      await addHistory(c, req, id, 'cadastro', 'Cadastro inicial do funcionário');
      if (admitting) await addHistory(c, req, id, 'admissao', `Admissão em ${d.admissionDate!.split('-').reverse().join('/')}`, { admissionDate: d.admissionDate, positionId: d.positionId, departmentId: d.departmentId, contractType: d.contractType, salary: d.salary });
      await audit(req, { action: admitting ? 'cadastrar_admitir' : 'criar', module: 'rh', entity: 'employee', entityId: id, summary: `Funcionário cadastrado${admitting ? ' e admitido' : ''}: ${d.fullName}` }, c);
      return id;
    });
    res.status(201).json({ id });
  } catch (e) { dupError(e); }
}));

rhRouter.put('/employees/:id', requireAuth('rh.edit'), h(async (req, res) => {
  const d = parse(employeeSchema, req.body);
  try {
    await tx(async (c) => {
      const cur = (await c.query(`SELECT ${SELECT} ${FROM} WHERE e.id=$1 FOR UPDATE OF e`, [req.params.id])).rows[0];
      if (!cur) throw new HttpError(404, 'Funcionário não encontrado');
      await checkRefs(c, d);
      // salário e data de admissão: só mudam com permissão / via admissão
      const canSalary = hasPerm(req, 'rh.salary');
      const next = { ...d, salary: canSalary ? d.salary : (cur.salary == null ? null : Number(cur.salary)), admissionDate: cur.admissionDate };
      if (d.managerId === req.params.id) throw new HttpError(422, 'O gestor não pode ser o próprio funcionário', { managerId: 'Gestor inválido' });
      const keys = Object.keys(COLS) as (keyof EmployeeInput)[];
      await c.query(`UPDATE employees SET ${keys.map((k, i) => `${COLS[k]}=$${i + 2}`).join(',')}, updated_at=now() WHERE id=$1`, [req.params.id, ...keys.map((k) => next[k] ?? null)]);

      const norm = (v: unknown) => (v == null || v === '' ? null : String(v));
      const curN: Record<string, unknown> = { ...cur, salary: cur.salary == null ? null : Number(cur.salary), birthDate: cur.birthDate };
      const changed = (k: keyof EmployeeInput) => norm(curN[k]) !== norm(next[k]);
      if (changed('positionId')) {
        const np = next.positionId ? (await c.query('SELECT name FROM job_positions WHERE id=$1', [next.positionId])).rows[0]?.name : null;
        await addHistory(c, req, req.params.id, 'mudanca_cargo', `Cargo alterado: ${cur.position ?? '—'} → ${np ?? '—'}`, { de: cur.position, para: np });
      }
      if (changed('departmentId')) {
        const nd = next.departmentId ? (await c.query('SELECT name FROM departments WHERE id=$1', [next.departmentId])).rows[0]?.name : null;
        await addHistory(c, req, req.params.id, 'mudanca_departamento', `Departamento alterado: ${cur.department ?? '—'} → ${nd ?? '—'}`, { de: cur.department, para: nd });
      }
      const contractual = (['contractType', 'salary', 'workload', 'managerId'] as const).filter(changed);
      if (contractual.length) {
        await addHistory(c, req, req.params.id, 'contratual', `Alteração contratual: ${contractual.map((k) => LABELS[k]).join(', ')}`,
          { de: Object.fromEntries(contractual.map((k) => [k, curN[k]])), para: Object.fromEntries(contractual.map((k) => [k, next[k]])) });
      }
      const other = (Object.keys(LABELS) as (keyof EmployeeInput)[]).filter((k) => !['contractType', 'salary', 'workload', 'managerId'].includes(k) && changed(k));
      if (other.length) await addHistory(c, req, req.params.id, 'alteracao', `Dados alterados: ${other.map((k) => LABELS[k]).join(', ')}`);
      await audit(req, { action: 'editar', module: 'rh', entity: 'employee', entityId: req.params.id, summary: `Funcionário editado: ${d.fullName}`, details: { campos: [...contractual, ...other] } }, c);
    });
  } catch (e) { dupError(e); }
  res.json({ ok: true });
}));

// ---------- Admissão ----------
const admissionSchema = z.object({
  employeeId: z.string().uuid('Selecione o funcionário'),
  admissionDate: reqDate,
  positionId: z.coerce.number().int().positive('Selecione o cargo'),
  departmentId: z.coerce.number().int().positive('Selecione o departamento'),
  contractType: z.enum(CONTRACTS as [string, ...string[]], { errorMap: () => ({ message: 'Selecione o tipo de vínculo' }) }),
  salary: optMoney,
  notes: optStr(1000),
});

rhRouter.delete('/employees/:id', requireAuth('rh.terminate'), h(async (req, res) => {
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Funcionário não encontrado');
    if (cur.status === 'ativo') throw new HttpError(409, 'Funcionário ativo não pode ser excluído. Registre o desligamento primeiro.');
    const history = (await c.query('SELECT at, event_type, description, data, user_name FROM employment_history WHERE employee_id=$1 ORDER BY id', [cur.id])).rows;
    const subs = (await c.query('UPDATE employees SET manager_id=NULL WHERE manager_id=$1 RETURNING id', [cur.id])).rowCount;
    await c.query(`SELECT set_config('app.allow_history_delete','on',true)`);
    await c.query('DELETE FROM employment_history WHERE employee_id=$1', [cur.id]);
    await c.query('DELETE FROM employees WHERE id=$1', [cur.id]);
    await audit(req, { action: 'excluir', module: 'rh', entity: 'employee', entityId: cur.id, summary: `Funcionário excluído: ${cur.registration} — ${cur.full_name}`, details: { funcionario: cur, historico: history, subordinadosSemGestor: subs } }, c);
  });
  res.json({ ok: true });
}));

rhRouter.post('/admissions', requireAuth('rh.admit'), h(async (req, res) => {
  const d = parse(admissionSchema, req.body);
  if (d.admissionDate > today()) throw new HttpError(422, 'Data de admissão não pode ser futura', { admissionDate: 'Data de admissão não pode ser futura' });
  await tx(async (c) => {
    const e = (await c.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [d.employeeId])).rows[0];
    if (!e) throw new HttpError(404, 'Funcionário não encontrado');
    if (e.status === 'ativo') throw new HttpError(409, 'Funcionário já está ativo.', { employeeId: 'Funcionário já está ativo' });
    if (e.termination_date && d.admissionDate < e.termination_date) throw new HttpError(422, 'Readmissão anterior ao desligamento', { admissionDate: 'Data anterior ao desligamento anterior' });
    await checkRefs(c, { positionId: d.positionId, departmentId: d.departmentId } as EmployeeInput);
    const salary = hasPerm(req, 'rh.salary') ? (d.salary ?? e.salary) : e.salary;
    await c.query(
      `UPDATE employees SET status='ativo', admission_date=$2, position_id=$3, department_id=$4, contract_type=$5, salary=$6,
              termination_date=NULL, termination_reason=NULL, updated_at=now() WHERE id=$1`,
      [d.employeeId, d.admissionDate, d.positionId, d.departmentId, d.contractType, salary]);
    const pos = (await c.query('SELECT name FROM job_positions WHERE id=$1', [d.positionId])).rows[0].name;
    const dep = (await c.query('SELECT name FROM departments WHERE id=$1', [d.departmentId])).rows[0].name;
    await addHistory(c, req, d.employeeId, 'admissao',
      `${e.status === 'desligado' ? 'Readmissão' : 'Admissão'} em ${d.admissionDate.split('-').reverse().join('/')} — ${pos} / ${dep} (${d.contractType})${d.notes ? ` — ${d.notes}` : ''}`,
      { admissionDate: d.admissionDate, position: pos, department: dep, contractType: d.contractType, salary, notes: d.notes });
    await audit(req, { action: 'admitir', module: 'rh', entity: 'employee', entityId: d.employeeId, summary: `Admissão registrada: ${e.full_name} (${pos})` }, c);
  });
  res.status(201).json({ ok: true });
}));

// ---------- Desligamento ----------
const terminationSchema = z.object({
  employeeId: z.string().uuid('Selecione o funcionário'),
  terminationDate: reqDate,
  reason: reqStr(200, 'Informe o motivo'),
  notes: optStr(1000),
});

rhRouter.post('/terminations', requireAuth('rh.terminate'), h(async (req, res) => {
  const d = parse(terminationSchema, req.body);
  if (d.terminationDate > today()) throw new HttpError(422, 'Data de desligamento não pode ser futura', { terminationDate: 'Data de desligamento não pode ser futura' });
  await tx(async (c) => {
    const e = (await c.query(`SELECT *, admission_date::text AS adm FROM employees WHERE id=$1 FOR UPDATE`, [d.employeeId])).rows[0];
    if (!e) throw new HttpError(404, 'Funcionário não encontrado');
    if (e.status !== 'ativo') throw new HttpError(409, 'Somente funcionários ativos podem ser desligados.', { employeeId: 'Funcionário não está ativo' });
    if (e.adm && d.terminationDate < e.adm) throw new HttpError(422, 'Desligamento anterior à admissão', { terminationDate: 'Data anterior à admissão' });
    await c.query(`UPDATE employees SET status='desligado', termination_date=$2, termination_reason=$3, updated_at=now() WHERE id=$1`, [d.employeeId, d.terminationDate, d.reason]);
    await addHistory(c, req, d.employeeId, 'desligamento',
      `Desligamento em ${d.terminationDate.split('-').reverse().join('/')} — ${d.reason}${d.notes ? ` — ${d.notes}` : ''}`,
      { terminationDate: d.terminationDate, reason: d.reason, notes: d.notes });
    await audit(req, { action: 'desligar', module: 'rh', entity: 'employee', entityId: d.employeeId, summary: `Desligamento registrado: ${e.full_name}` }, c);
  });
  res.status(201).json({ ok: true });
}));

// ---------- Relatórios ----------
const REPORTS: Record<string, string> = {
  'ativos': 'Relação de funcionários ativos', 'desligados': 'Relação de funcionários desligados',
  'admissoes': 'Admissões por período', 'desligamentos': 'Desligamentos por período',
  'por-departamento': 'Funcionários por departamento', 'cadastral': 'Dados cadastrais e profissionais',
};

rhRouter.get('/reports', requireAuth('rh.view'), (_req, res) => { res.json(REPORTS); });

rhRouter.get('/reports/:name', requireAuth('rh.view', 'rh.export'), h(async (req, res) => {
  const name = req.params.name;
  if (!REPORTS[name]) throw new HttpError(404, 'Relatório inexistente');
  if (req.query.format === 'csv' && !hasPerm(req, 'rh.export')) throw new HttpError(403, 'Sem permissão para exportar.');
  const w = new Where();
  const from = qstr(req, 'from'), to = qstr(req, 'to');
  const dep = qstr(req, 'departmentId'); if (dep) w.add('e.department_id = ?', Number(dep));
  const pos = qstr(req, 'positionId'); if (pos) w.add('e.position_id = ?', Number(pos));
  const st = qstr(req, 'status');
  const dateCol = name === 'desligamentos' || name === 'desligados' ? 'e.termination_date' : 'e.admission_date';
  if (name === 'ativos') w.add(`e.status = 'ativo'`);
  else if (name === 'desligados' || name === 'desligamentos') w.add(`e.status = 'desligado'`);
  else if (st && st !== 'todos') w.add('e.status = ?', st);
  if (name === 'admissoes') w.add('e.admission_date IS NOT NULL');
  // período só se aplica aos relatórios de movimentação (admissões/desligamentos)
  if (name === 'admissoes' || name === 'desligamentos') {
    if (from) w.add(`${dateCol} >= ?`, from);
    if (to) w.add(`${dateCol} <= ?`, to);
  }

  const fmtd = (c: string) => `to_char(${c},'DD/MM/YYYY')`;
  if (name === 'por-departamento') {
    const rows = (await pool.query(
      `SELECT COALESCE(d.name,'(sem departamento)') AS departamento, count(*)::int AS total,
              count(*) FILTER (WHERE e.status='ativo')::int AS ativos, count(*) FILTER (WHERE e.status='desligado')::int AS desligados
         ${FROM} ${w.sql} GROUP BY d.name ORDER BY d.name NULLS LAST`, w.params)).rows;
    return sendReport(req, res, `rh-${name}`, [{ key: 'departamento', label: 'Departamento' }, { key: 'total', label: 'Total' }, { key: 'ativos', label: 'Ativos' }, { key: 'desligados', label: 'Desligados' }], rows, { title: REPORTS[name] });
  }
  const showSalary = name === 'cadastral' && hasPerm(req, 'rh.salary');
  const cols = [
    { key: 'registration', label: 'Matrícula' }, { key: 'payrollNumber', label: 'Nº Folha' }, { key: 'fullName', label: 'Nome' }, { key: 'cpf', label: 'CPF' },
    { key: 'pisPasep', label: 'PIS/PASEP' }, { key: 'position', label: 'Cargo' }, { key: 'cbo', label: 'CBO' }, { key: 'esocial', label: 'eSocial' }, { key: 'department', label: 'Departamento' },
    { key: 'admission', label: 'Admissão' }, ...(name.startsWith('deslig') ? [{ key: 'termination', label: 'Desligamento' }, { key: 'reason', label: 'Motivo' }] : []),
    { key: 'status', label: 'Situação' },
    ...(name === 'cadastral' ? [{ key: 'contractType', label: 'Vínculo' }, { key: 'transportVoucher', label: 'Vale-transporte' }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail' }, { key: 'birth', label: 'Nascimento' }, { key: 'city', label: 'Cidade/UF' }, ...(showSalary ? [{ key: 'salary', label: 'Salário' }] : [])] : []),
  ];
  const rows = (await pool.query(
    `SELECT e.registration, e.payroll_number AS "payrollNumber", e.full_name AS "fullName", e.cpf, e.pis_pasep AS "pisPasep", e.cbo, e.esocial,
            jp.name AS position, d.name AS department, ${fmtd('e.admission_date')} AS admission, ${fmtd('e.termination_date')} AS termination,
            e.termination_reason AS reason, e.status, e.contract_type AS "contractType",
            CASE WHEN e.transport_voucher THEN 'Sim' ELSE 'Não' END AS "transportVoucher", e.phone, e.email, ${fmtd('e.birth_date')} AS birth,
            concat_ws('/', e.city, e.state) AS city, e.salary
       ${FROM} ${w.sql} ORDER BY lower(e.full_name) LIMIT 5000`, w.params)).rows;
  if (req.query.format === 'csv') await audit(req, { action: 'exportar', module: 'rh', entity: 'report', summary: `Relatório RH exportado (CSV): ${REPORTS[name]}` });
  const STATUS: Record<string, string> = { ativo: 'Ativo', desligado: 'Desligado', pre_cadastro: 'Aguardando admissão' };
  const fmtCpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const brl = (v: unknown) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  sendReport(req, res, `rh-${name}`, cols, rows.map((r) => ({ ...r, cpf: fmtCpf(r.cpf), status: STATUS[r.status] ?? r.status, salary: brl(r.salary) })), { title: REPORTS[name] });
}));
