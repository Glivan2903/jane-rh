import { pool } from '../db.js';

export async function hrSummary(from: string, to: string) {
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
  const ativos = (await one(`SELECT count(*)::int n FROM employees WHERE status='ativo'`)).n;
  const total = (await one(`SELECT count(*)::int n FROM employees`)).n;
  const adm = (await one(`SELECT count(*)::int n FROM employment_history WHERE event_type='admissao' AND (data->>'admissionDate')::date BETWEEN $1 AND $2`, [from, to])).n;
  const des = (await one(`SELECT count(*)::int n FROM employment_history WHERE event_type='desligamento' AND (data->>'terminationDate')::date BETWEEN $1 AND $2`, [from, to])).n;
  const porDepartamento = (await pool.query(
    `SELECT COALESCE(d.name,'Sem departamento') AS nome, count(*)::int AS total FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status='ativo' GROUP BY d.name ORDER BY total DESC`)).rows;
  const porCargo = (await pool.query(
    `SELECT COALESCE(j.name,'Sem cargo') AS nome, count(*)::int AS total FROM employees e LEFT JOIN job_positions j ON j.id=e.position_id WHERE e.status='ativo' GROUP BY j.name ORDER BY total DESC LIMIT 12`)).rows;
  // histórico: últimos 12 meses terminando no fim do período
  const historico = (await pool.query(
    `WITH m AS (SELECT generate_series(date_trunc('month',$1::date) - interval '11 months', date_trunc('month',$1::date), interval '1 month')::date AS mes)
     SELECT to_char(m.mes,'YYYY-MM') AS mes,
       (SELECT count(*)::int FROM employment_history h WHERE h.event_type='admissao' AND date_trunc('month',(h.data->>'admissionDate')::date)=m.mes) AS admissoes,
       (SELECT count(*)::int FROM employment_history h WHERE h.event_type='desligamento' AND date_trunc('month',(h.data->>'terminationDate')::date)=m.mes) AS desligamentos
     FROM m ORDER BY m.mes`, [to])).rows;
  return { ativos, total, desligadosTotal: (await one(`SELECT count(*)::int n FROM employees WHERE status='desligado'`)).n, admissoes: adm, desligamentos: des, porDepartamento, porCargo, historico };
}
