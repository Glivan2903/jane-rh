import { pool } from '../db.js';

export const TODAY_SQL = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
/** Situação efetiva: "vencida" é derivada (pendente com vencimento passado), nunca armazenada. */
export const EFF = `(CASE WHEN t.status='cancelada' THEN 'cancelada'
  WHEN t.status='realizada' THEN (CASE WHEN t.type='receita' THEN 'recebida' ELSE 'paga' END)
  WHEN t.due_date < ${TODAY_SQL} THEN 'vencida' ELSE 'prevista' END)`;

const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

/**
 * Regras (canceladas nunca entram):
 *  - Previsto = lançamentos com VENCIMENTO no período (qualquer situação exceto cancelada).
 *  - Realizado (recebido/pago) = baixas com DATA EFETIVA no período.
 *  - Resultado do período = receitas − despesas do mesmo período (não é saldo bancário).
 *  - Em atraso (total) = pendentes com vencimento anterior a hoje, independente do período.
 */
export async function financeSummary(from: string, to: string, status?: string) {
  const stFilter = status && status !== 'todos' ? `AND ${EFF} = $3` : '';
  const prevParams: unknown[] = status && status !== 'todos' ? [from, to, status] : [from, to];

  const prev = (await pool.query(
    `SELECT t.type,
            COALESCE(sum(t.amount),0) AS previsto,
            COALESCE(sum(t.amount) FILTER (WHERE t.status='pendente'),0) AS pendente
       FROM financial_transactions t
      WHERE t.status <> 'cancelada' AND t.due_date BETWEEN $1 AND $2 ${stFilter}
      GROUP BY t.type`, prevParams)).rows;
  const real = (await pool.query(
    `SELECT t.type, COALESCE(sum(t.amount),0) AS realizado
       FROM financial_transactions t
      WHERE t.status='realizada' AND t.settled_date BETWEEN $1 AND $2 GROUP BY t.type`, [from, to])).rows;
  const overdue = (await pool.query(
    `SELECT t.type, COALESCE(sum(t.amount),0) AS total, count(*)::int AS qtd
       FROM financial_transactions t WHERE t.status='pendente' AND t.due_date < ${TODAY_SQL} GROUP BY t.type`)).rows;

  const pick = (rows: Record<string, unknown>[], type: string, key: string) => r2(rows.find((x) => x.type === type)?.[key]);
  const receitaPrevista = pick(prev, 'receita', 'previsto'), despesaPrevista = pick(prev, 'despesa', 'previsto');
  const recebido = pick(real, 'receita', 'realizado'), pago = pick(real, 'despesa', 'realizado');

  const months = (await pool.query(
    `WITH m AS (SELECT generate_series(date_trunc('month',$1::date), date_trunc('month',$2::date), interval '1 month')::date AS mes)
     SELECT to_char(m.mes,'YYYY-MM') AS mes,
       COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status='realizada' AND date_trunc('month',t.settled_date)=m.mes),0) AS recebido,
       COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status='realizada' AND date_trunc('month',t.settled_date)=m.mes),0) AS pago,
       COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='receita' AND t.status<>'cancelada' AND date_trunc('month',t.due_date)=m.mes),0) AS "receitaPrevista",
       COALESCE((SELECT sum(amount) FROM financial_transactions t WHERE t.type='despesa' AND t.status<>'cancelada' AND date_trunc('month',t.due_date)=m.mes),0) AS "despesaPrevista"
     FROM m ORDER BY m.mes LIMIT 60`, [from, to])).rows;
  let acc = 0;
  const monthly = months.map((m) => {
    const saldo = r2(Number(m.recebido) - Number(m.pago)); acc = r2(acc + saldo);
    return { mes: m.mes, recebido: r2(m.recebido), pago: r2(m.pago), receitaPrevista: r2(m.receitaPrevista), despesaPrevista: r2(m.despesaPrevista), saldo, saldoAcumulado: acc };
  });

  const byCat = async (type: string) => (await pool.query(
    `SELECT c.name AS categoria, sum(t.amount) AS total FROM financial_transactions t JOIN financial_categories c ON c.id=t.category_id
      WHERE t.type='${type}' AND t.status<>'cancelada' AND t.due_date BETWEEN $1 AND $2 ${stFilter}
      GROUP BY c.name ORDER BY total DESC`, prevParams)).rows.map((x) => ({ categoria: x.categoria, total: r2(x.total) }));

  return {
    period: { from, to },
    receitas: { previsto: receitaPrevista, recebido, aReceber: pick(prev, 'receita', 'pendente') },
    despesas: { previsto: despesaPrevista, pago, aPagar: pick(prev, 'despesa', 'pendente') },
    saldoPrevisto: r2(receitaPrevista - despesaPrevista),
    saldoRealizado: r2(recebido - pago),
    vencidas: {
      receber: pick(overdue, 'receita', 'total'), pagar: pick(overdue, 'despesa', 'total'),
      qtd: (overdue.find((x) => x.type === 'receita')?.qtd ?? 0) + (overdue.find((x) => x.type === 'despesa')?.qtd ?? 0),
    },
    monthly,
    despesasPorCategoria: await byCat('despesa'),
    receitasPorCategoria: await byCat('receita'),
  };
}
