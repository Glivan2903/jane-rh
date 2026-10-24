import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool, tx, type Q } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { TODAY_SQL } from '../services/finance.js';
import { decodeOfx, parseOfx } from '../services/ofx.js';
import { HttpError, Where, h, listParams, money, optInt, optStr, parse, qstr, reqDate, reqInt, reqStr, today } from '../util.js';

export const bankingRouter = Router();

const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Conta efetiva de um lançamento: sem account_id (lançamentos antigos) vale a "Conta padrão". */
const DEFAULT_ID = `(SELECT id FROM bank_accounts WHERE is_default)`;
const EFF_ACCOUNT = `COALESCE(t.account_id, ${DEFAULT_ID})`;
/** Saldo = saldo inicial + baixas realizadas (receitas − despesas) + transferências recebidas − enviadas. */
const BALANCE = `a.initial_balance
  + COALESCE((SELECT sum(CASE WHEN t.type='receita' THEN t.amount ELSE -t.amount END) FROM financial_transactions t WHERE t.status='realizada' AND ${EFF_ACCOUNT} = a.id),0)
  + COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.to_account_id = a.id),0)
  - COALESCE((SELECT sum(x.amount) FROM bank_transfers x WHERE x.from_account_id = a.id),0)`;

// ---------- Contas ----------
const accountSchema = z.object({
  name: reqStr(100, 'Informe o nome da conta'),
  kind: z.enum(['corrente', 'poupanca', 'caixa', 'cartao', 'outra']).default('corrente'),
  bank: optStr(80), agency: optStr(20), accountNumber: optStr(30),
  initialBalance: z.coerce.number({ invalid_type_error: 'Saldo inválido' }).min(-999999999999).max(999999999999)
    .refine((n) => Math.round(n * 100) / 100 === n, 'Use no máximo 2 casas decimais').default(0),
  active: z.boolean().default(true),
});
const ACC_SELECT = `a.id, a.name, a.kind, a.bank, a.agency, a.account_number AS "accountNumber", a.initial_balance AS "initialBalance", a.is_default AS "isDefault", a.active,
  ${BALANCE} AS balance,
  (SELECT count(*)::int FROM financial_transactions t WHERE ${EFF_ACCOUNT} = a.id) AS "txCount",
  (SELECT count(*)::int FROM bank_statement_lines l WHERE l.account_id = a.id AND l.status = 'pendente') AS "pendingLines"`;

bankingRouter.get('/accounts', requireAuth('fin.view'), h(async (req, res) => {
  const onlyActive = req.query.active === 'true';
  const rows = (await pool.query(`SELECT ${ACC_SELECT} FROM bank_accounts a ${onlyActive ? 'WHERE a.active' : ''} ORDER BY a.is_default DESC, lower(a.name)`)).rows;
  res.json({ accounts: rows, total: r2(rows.filter((r) => r.active).reduce((s, r) => s + Number(r.balance), 0)) });
}));

const dupAccount = (e: unknown): never => {
  if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Já existe uma conta com este nome', { name: 'Já cadastrada' });
  throw e;
};

bankingRouter.post('/accounts', requireAuth('fin.accounts'), h(async (req, res) => {
  const d = parse(accountSchema, req.body);
  try {
    const id = (await pool.query(
      `INSERT INTO bank_accounts (name, kind, bank, agency, account_number, initial_balance, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.name, d.kind, d.bank ?? null, d.agency ?? null, d.accountNumber ?? null, d.initialBalance, d.active])).rows[0].id;
    await audit(req, { action: 'criar', module: 'financeiro', entity: 'bank_account', entityId: id, summary: `Conta criada: ${d.name}` });
    res.status(201).json({ id });
  } catch (e) { dupAccount(e); }
}));

bankingRouter.put('/accounts/:id', requireAuth('fin.accounts'), h(async (req, res) => {
  const d = parse(accountSchema, req.body);
  const cur = (await pool.query('SELECT * FROM bank_accounts WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) throw new HttpError(404, 'Conta não encontrada');
  if (cur.is_default && !d.active) throw new HttpError(409, 'A conta padrão não pode ser inativada.');
  try {
    await pool.query(
      `UPDATE bank_accounts SET name=$2, kind=$3, bank=$4, agency=$5, account_number=$6, initial_balance=$7, active=$8, updated_at=now() WHERE id=$1`,
      [req.params.id, d.name, d.kind, d.bank ?? null, d.agency ?? null, d.accountNumber ?? null, d.initialBalance, d.active]);
  } catch (e) { dupAccount(e); }
  await audit(req, { action: cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar', module: 'financeiro', entity: 'bank_account', entityId: req.params.id,
    summary: `Conta ${cur.active !== d.active ? (d.active ? 'ativada' : 'inativada') : 'editada'}: ${d.name}`, details: { saldoInicialAnterior: cur.initial_balance, saldoInicialNovo: d.initialBalance } });
  res.json({ ok: true });
}));

// ---------- Transferências entre contas ----------
const transferSchema = z.object({
  fromAccountId: reqInt, toAccountId: reqInt, amount: money, date: reqDate, description: optStr(200),
}).refine((d) => d.fromAccountId !== d.toAccountId, { path: ['toAccountId'], message: 'Escolha contas diferentes' });

bankingRouter.get('/transfers', requireAuth('fin.view'), h(async (req, res) => {
  const p = listParams(req, { date: 'x.transfer_date', amount: 'x.amount' }, 'date', 'DESC');
  const w = new Where();
  const acc = qstr(req, 'accountId'); if (acc) w.add('(x.from_account_id = ? OR x.to_account_id = ?)', Number(acc), Number(acc));
  const from = qstr(req, 'from'); if (from) w.add('x.transfer_date >= ?', from);
  const to = qstr(req, 'to'); if (to) w.add('x.transfer_date <= ?', to);
  const total = (await pool.query(`SELECT count(*)::int n FROM bank_transfers x ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT x.id, x.from_account_id AS "fromAccountId", f.name AS "fromAccount", x.to_account_id AS "toAccountId", t.name AS "toAccount", x.amount,
            x.transfer_date AS date, x.description, x.created_by_name AS "createdBy"
       FROM bank_transfers x JOIN bank_accounts f ON f.id = x.from_account_id JOIN bank_accounts t ON t.id = x.to_account_id
       ${w.sql} ORDER BY ${p.sort} ${p.dir}, x.id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

bankingRouter.post('/transfers', requireAuth('fin.accounts'), h(async (req, res) => {
  const d = parse(transferSchema, req.body);
  if (d.date > today()) throw new HttpError(422, 'A data da transferência não pode ser futura', { date: 'Data futura não permitida' });
  const id = await tx(async (c) => {
    const accs = (await c.query('SELECT id, name, active FROM bank_accounts WHERE id = ANY($1)', [[d.fromAccountId, d.toAccountId]])).rows;
    if (accs.length !== 2 || accs.some((a) => !a.active)) throw new HttpError(422, 'Conta inválida ou inativa', { fromAccountId: 'Conta inválida ou inativa' });
    const id = (await c.query(
      `INSERT INTO bank_transfers (from_account_id, to_account_id, amount, transfer_date, description, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.fromAccountId, d.toAccountId, d.amount, d.date, d.description ?? null, req.user!.id, req.user!.name])).rows[0].id;
    const nm = (i: number) => accs.find((a) => a.id === i)!.name;
    await audit(req, { action: 'transferir', module: 'financeiro', entity: 'bank_transfer', entityId: id, summary: `Transferência de R$ ${brl(d.amount)}: ${nm(d.fromAccountId)} → ${nm(d.toAccountId)}` }, c);
    return id;
  });
  res.status(201).json({ id });
}));

bankingRouter.delete('/transfers/:id', requireAuth('fin.accounts'), h(async (req, res) => {
  await tx(async (c) => {
    const cur = (await c.query('DELETE FROM bank_transfers WHERE id=$1 RETURNING *', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Transferência não encontrada');
    await audit(req, { action: 'excluir', module: 'financeiro', entity: 'bank_transfer', entityId: req.params.id, summary: `Transferência excluída: R$ ${brl(cur.amount)} de ${cur.transfer_date}`, details: { transferencia: cur } }, c);
  });
  res.json({ ok: true });
}));

// ---------- Fluxo de caixa projetado ----------
bankingRouter.get('/cashflow', requireAuth('fin.view'), h(async (req, res) => {
  const days = [30, 60, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const accountId = qstr(req, 'accountId') ? Number(qstr(req, 'accountId')) : null;
  const scope = accountId ? 'a.id = $1' : 'a.active';
  const sp = accountId ? [accountId] : [];
  const opening = r2((await pool.query(`SELECT COALESCE(sum(${BALANCE}),0) AS s FROM bank_accounts a WHERE ${scope}`, sp)).rows[0].s);
  const t0 = (await pool.query(`SELECT ${TODAY_SQL}::text AS d`)).rows[0].d as string;
  // pendentes entram na data de vencimento; os já vencidos entram hoje (ainda precisam ser pagos/recebidos)
  const rows = (await pool.query(
    `SELECT GREATEST(t.due_date, ${TODAY_SQL})::text AS dia, t.type, sum(t.amount) AS total, count(*)::int AS qtd,
            bool_or(t.due_date < ${TODAY_SQL}) AS atrasado
       FROM financial_transactions t
      WHERE t.status = 'pendente' AND GREATEST(t.due_date, ${TODAY_SQL}) <= ${TODAY_SQL} + $${sp.length + 1}::int
        AND ${accountId ? `${EFF_ACCOUNT} = $1` : `${EFF_ACCOUNT} IN (SELECT id FROM bank_accounts WHERE active)`}
      GROUP BY 1, 2`, [...sp, days])).rows;
  const byDay = new Map<string, { in: number; out: number; inCount: number; outCount: number; late: boolean }>();
  for (const r of rows) {
    const e = byDay.get(r.dia) ?? { in: 0, out: 0, inCount: 0, outCount: 0, late: false };
    if (r.type === 'receita') { e.in += Number(r.total); e.inCount += r.qtd; } else { e.out += Number(r.total); e.outCount += r.qtd; }
    e.late = e.late || r.atrasado; byDay.set(r.dia, e);
  }
  const series: { date: string; in: number; out: number; balance: number }[] = [];
  let bal = opening, min = { balance: opening, date: t0 }, totIn = 0, totOut = 0;
  const start = new Date(`${t0}T12:00:00Z`);
  for (let i = 0; i <= days; i++) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const e = byDay.get(date);
    bal = r2(bal + (e?.in ?? 0) - (e?.out ?? 0)); totIn += e?.in ?? 0; totOut += e?.out ?? 0;
    if (bal < min.balance) min = { balance: bal, date };
    series.push({ date, in: r2(e?.in ?? 0), out: r2(e?.out ?? 0), balance: bal });
  }
  const overdue = (await pool.query(
    `SELECT t.type, COALESCE(sum(t.amount),0) AS total, count(*)::int AS qtd FROM financial_transactions t
      WHERE t.status='pendente' AND t.due_date < ${TODAY_SQL} AND ${accountId ? `${EFF_ACCOUNT} = $1` : `${EFF_ACCOUNT} IN (SELECT id FROM bank_accounts WHERE active)`} GROUP BY t.type`, sp)).rows;
  const ov = (type: string) => ({ total: r2(overdue.find((x) => x.type === type)?.total), qtd: overdue.find((x) => x.type === type)?.qtd ?? 0 });
  res.json({
    days, from: t0, to: series.at(-1)!.date, accountId, opening, closing: series.at(-1)!.balance,
    totalIn: r2(totIn), totalOut: r2(totOut), lowest: min, negative: min.balance < 0, series,
    overdue: { receber: ov('receita'), pagar: ov('despesa') },
  });
}));

// ---------- Conciliação bancária (OFX) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

bankingRouter.post('/accounts/:id/ofx', requireAuth('fin.accounts'), upload.single('file'), h(async (req, res) => {
  const acc = (await pool.query('SELECT id, name, active FROM bank_accounts WHERE id=$1', [req.params.id])).rows[0];
  if (!acc) throw new HttpError(404, 'Conta não encontrada');
  if (!acc.active) throw new HttpError(409, 'Conta inativa.');
  if (!req.file) throw new HttpError(422, 'Envie o arquivo OFX.', { file: 'Arquivo obrigatório' });
  let lines;
  try { lines = parseOfx(decodeOfx(req.file.buffer)); } catch (e) { throw new HttpError(422, (e as Error).message, { file: 'Arquivo OFX inválido' }); }
  if (!lines.length) throw new HttpError(422, 'Nenhuma transação encontrada no arquivo.', { file: 'Sem transações' });
  if (lines.length > 5000) throw new HttpError(422, 'Arquivo com transações demais (máximo 5.000).', { file: 'Muitas transações' });
  const result = await tx(async (c) => {
    let imported = 0;
    for (const l of lines) {
      const r = await c.query(
        `INSERT INTO bank_statement_lines (account_id, fitid, posted_date, amount, memo, imported_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id, fitid) DO NOTHING`,
        [acc.id, l.fitid, l.date, l.amount, l.memo || null, req.user!.id]);
      imported += r.rowCount ?? 0;
    }
    await audit(req, { action: 'importar', module: 'financeiro', entity: 'bank_statement', entityId: acc.id, summary: `Extrato OFX importado em ${acc.name}: ${imported} nova(s) de ${lines.length} linha(s)` }, c);
    return { imported, duplicates: lines.length - imported, total: lines.length };
  });
  res.status(201).json(result);
}));

const CAND_DAYS = 10;
async function suggestions(line: { id: string; account_id: number; amount: string; posted_date: string }) {
  const amt = Math.abs(Number(line.amount));
  return (await pool.query(
    `SELECT t.id, t.type, t.description, t.party, t.amount, t.due_date AS "dueDate", t.settled_date AS "settledDate", t.status AS "storedStatus"
       FROM financial_transactions t
      WHERE t.type = $1 AND t.amount = $2 AND t.status <> 'cancelada'
        AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.transaction_id = t.id)
        AND (t.status = 'pendente' OR ${EFF_ACCOUNT} = $3)
        AND abs(COALESCE(t.settled_date, t.due_date) - $4::date) <= ${CAND_DAYS}
      ORDER BY abs(COALESCE(t.settled_date, t.due_date) - $4::date), t.created_at LIMIT 5`,
    [Number(line.amount) > 0 ? 'receita' : 'despesa', amt, line.account_id, line.posted_date])).rows;
}

bankingRouter.get('/accounts/:id/statement', requireAuth('fin.view'), h(async (req, res) => {
  const p = listParams(req, { date: 'l.posted_date', amount: 'l.amount' }, 'date', 'DESC');
  const w = new Where().add('l.account_id = ?', Number(req.params.id));
  const st = qstr(req, 'status'); if (st && ['pendente', 'conciliado', 'ignorado'].includes(st)) w.add('l.status = ?', st);
  const total = (await pool.query(`SELECT count(*)::int n FROM bank_statement_lines l ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(
    `SELECT l.id, l.fitid, l.posted_date, l.amount, l.memo, l.status, l.transaction_id, l.account_id, t.description AS "transactionDescription"
       FROM bank_statement_lines l LEFT JOIN financial_transactions t ON t.id = l.transaction_id
       ${w.sql} ORDER BY ${p.sort} ${p.dir}, l.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  const out = [];
  for (const r of rows) {
    out.push({ id: r.id, fitid: r.fitid, postedDate: r.posted_date, amount: r.amount, memo: r.memo, status: r.status, transactionId: r.transaction_id,
      transactionDescription: r.transactionDescription, suggestions: r.status === 'pendente' ? await suggestions(r) : [] });
  }
  const counts = (await pool.query(`SELECT status, count(*)::int n FROM bank_statement_lines WHERE account_id=$1 GROUP BY status`, [req.params.id])).rows;
  res.json({ rows: out, total, page: p.page, pageSize: p.pageSize, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
}));

async function lockLine(c: Q, req: Request) {
  const line = (await c.query('SELECT * FROM bank_statement_lines WHERE id=$1 FOR UPDATE', [req.params.lineId])).rows[0];
  if (!line) throw new HttpError(404, 'Linha do extrato não encontrada');
  return line;
}
const lineLabel = (l: { posted_date: string; amount: string; memo: string | null }) => `${l.memo ?? 'linha do extrato'} (${l.posted_date}, R$ ${brl(Math.abs(Number(l.amount)))})`;

bankingRouter.post('/statement/:lineId/match', requireAuth('fin.accounts', 'fin.settle'), h(async (req, res) => {
  const d = parse(z.object({ transactionId: z.string().uuid('Lançamento inválido'), settle: z.boolean().default(true) }), req.body);
  await tx(async (c) => {
    const line = await lockLine(c, req);
    if (line.status !== 'pendente') throw new HttpError(409, 'Esta linha já foi tratada.');
    const t = (await c.query('SELECT * FROM financial_transactions WHERE id=$1 FOR UPDATE', [d.transactionId])).rows[0];
    if (!t) throw new HttpError(404, 'Lançamento não encontrado');
    if (t.status === 'cancelada') throw new HttpError(409, 'Lançamento cancelado não pode ser conciliado.');
    if (t.type !== (Number(line.amount) > 0 ? 'receita' : 'despesa')) throw new HttpError(422, 'O tipo do lançamento não corresponde ao sinal da linha do extrato.');
    if (Number(t.amount) !== Math.abs(Number(line.amount))) throw new HttpError(422, `O valor do lançamento (R$ ${brl(t.amount)}) difere do extrato (R$ ${brl(Math.abs(Number(line.amount)))}).`);
    if ((await c.query('SELECT 1 FROM bank_statement_lines WHERE transaction_id=$1', [t.id])).rowCount) throw new HttpError(409, 'Lançamento já conciliado com outra linha.');
    if (t.status === 'pendente') {
      if (!req.user!.perms.has('fin.settle')) throw new HttpError(403, 'Sem permissão para registrar pagamento/recebimento.');
      if (!d.settle) throw new HttpError(422, 'Lançamento pendente: confirme a baixa para conciliar.');
      const eff = line.posted_date > today() ? today() : line.posted_date;
      await c.query(`INSERT INTO payment_records (transaction_id, amount, effective_date, method, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6)`,
        [t.id, t.amount, eff, t.method, req.user!.id, req.user!.name]);
      await c.query(`UPDATE financial_transactions SET status='realizada', settled_date=$2, account_id=$3, updated_at=now() WHERE id=$1`, [t.id, eff, line.account_id]);
    } else {
      const effAcc = t.account_id ?? (await c.query('SELECT id FROM bank_accounts WHERE is_default')).rows[0].id;
      if (effAcc !== line.account_id) throw new HttpError(422, 'O lançamento já foi baixado em outra conta.');
    }
    await c.query(`UPDATE bank_statement_lines SET status='conciliado', transaction_id=$2 WHERE id=$1`, [line.id, t.id]);
    await audit(req, { action: 'conciliar', module: 'financeiro', entity: 'bank_statement', entityId: line.id, summary: `Conciliado: ${lineLabel(line)} com "${t.description}"${t.status === 'pendente' ? ' (baixa registrada)' : ''}` }, c);
  });
  res.json({ ok: true });
}));

bankingRouter.post('/statement/:lineId/create', requireAuth('fin.accounts'), h(async (req, res) => {
  const d = parse(z.object({ categoryId: reqInt, description: optStr(200), partyId: optInt, costCenterId: optInt }), req.body);
  const id = await tx(async (c) => {
    if (!req.user!.perms.has('fin.create') || !req.user!.perms.has('fin.settle')) throw new HttpError(403, 'Sem permissão para criar e baixar lançamentos.');
    const line = await lockLine(c, req);
    if (line.status !== 'pendente') throw new HttpError(409, 'Esta linha já foi tratada.');
    const type = Number(line.amount) > 0 ? 'receita' : 'despesa';
    const cat = (await c.query('SELECT type, active FROM financial_categories WHERE id=$1', [d.categoryId])).rows[0];
    if (!cat || cat.type !== type || !cat.active) throw new HttpError(422, 'Categoria inválida para este tipo', { categoryId: 'Categoria inválida ou inativa' });
    let party: string | null = null;
    if (d.partyId) {
      const p = (await c.query('SELECT name, active, is_customer, is_supplier FROM parties WHERE id=$1', [d.partyId])).rows[0];
      if (!p || !p.active || !(type === 'receita' ? p.is_customer : p.is_supplier)) throw new HttpError(422, 'Cadastro inválido ou inativo', { partyId: 'Cadastro inválido ou inativo' });
      party = p.name;
    }
    if (d.costCenterId && !(await c.query('SELECT 1 FROM cost_centers WHERE id=$1 AND active', [d.costCenterId])).rowCount) throw new HttpError(422, 'Centro de custo inválido', { costCenterId: 'Centro de custo inválido ou inativo' });
    const eff = line.posted_date > today() ? today() : line.posted_date;
    const amount = Math.abs(Number(line.amount));
    const desc = d.description ?? (line.memo || 'Lançamento do extrato');
    const row = (await c.query(
      `INSERT INTO financial_transactions (type, description, category_id, party, party_id, amount, competence_date, due_date, settled_date, status, account_id, cost_center_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$7,'realizada',$8,$9,$10) RETURNING id`,
      [type, desc, d.categoryId, party, d.partyId ?? null, amount, eff, line.account_id, d.costCenterId ?? null, req.user!.id])).rows[0];
    await c.query(`INSERT INTO payment_records (transaction_id, amount, effective_date, user_id, user_name) VALUES ($1,$2,$3,$4,$5)`, [row.id, amount, eff, req.user!.id, req.user!.name]);
    await c.query(`UPDATE bank_statement_lines SET status='conciliado', transaction_id=$2 WHERE id=$1`, [line.id, row.id]);
    await audit(req, { action: 'conciliar', module: 'financeiro', entity: 'bank_statement', entityId: line.id, summary: `Lançamento criado a partir do extrato: ${desc} — R$ ${brl(amount)}` }, c);
    return row.id as string;
  });
  res.status(201).json({ id });
}));

bankingRouter.post('/statement/:lineId/ignore', requireAuth('fin.accounts'), h(async (req, res) => {
  await tx(async (c) => {
    const line = await lockLine(c, req);
    if (line.status !== 'pendente') throw new HttpError(409, 'Esta linha já foi tratada.');
    await c.query(`UPDATE bank_statement_lines SET status='ignorado' WHERE id=$1`, [line.id]);
    await audit(req, { action: 'ignorar', module: 'financeiro', entity: 'bank_statement', entityId: line.id, summary: `Linha do extrato ignorada: ${lineLabel(line)}` }, c);
  });
  res.json({ ok: true });
}));

/** Desfaz o tratamento da linha (conciliada ou ignorada). A baixa do lançamento, se houve, permanece; estorne-a no lançamento. */
bankingRouter.post('/statement/:lineId/undo', requireAuth('fin.accounts'), h(async (req, res) => {
  await tx(async (c) => {
    const line = await lockLine(c, req);
    if (line.status === 'pendente') throw new HttpError(409, 'Esta linha já está pendente.');
    await c.query(`UPDATE bank_statement_lines SET status='pendente', transaction_id=NULL WHERE id=$1`, [line.id]);
    await audit(req, { action: 'desfazer_conciliacao', module: 'financeiro', entity: 'bank_statement', entityId: line.id, summary: `Conciliação desfeita: ${lineLabel(line)}` }, c);
  });
  res.json({ ok: true });
}));
