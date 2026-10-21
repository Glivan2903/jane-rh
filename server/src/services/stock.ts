import { pool } from '../db.js';

export const STOCK_STATUS = `(CASE WHEN NOT p.active THEN 'inativo' WHEN p.quantity <= 0 THEN 'sem_estoque' WHEN p.quantity <= p.min_stock THEN 'baixo' ELSE 'normal' END)`;
const n = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

export async function stockSummary(from: string, to: string) {
  const t = (await pool.query(
    `SELECT count(*)::int AS produtos, count(*) FILTER (WHERE active)::int AS ativos,
            COALESCE(sum(quantity) FILTER (WHERE quantity > 0),0) AS itens,
            COALESCE(sum(quantity * cost) FILTER (WHERE quantity > 0),0) AS valor,
            count(*) FILTER (WHERE active AND quantity > 0 AND quantity <= min_stock)::int AS baixo,
            count(*) FILTER (WHERE active AND quantity <= 0)::int AS zerado
       FROM products`)).rows[0];
  const mov = (await pool.query(
    `SELECT type, count(*)::int AS qtd, COALESCE(sum(quantity),0) AS total FROM stock_movements WHERE movement_date BETWEEN $1 AND $2 GROUP BY type`, [from, to])).rows;
  const recent = (await pool.query(
    `SELECT m.id, m.type, m.quantity, m.reason, m.movement_date AS "date", p.code, p.name
       FROM stock_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 8`)).rows;
  const top = (await pool.query(
    `SELECT p.code, p.name, count(*)::int AS movimentos, sum(m.quantity) AS quantidade
       FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.movement_date BETWEEN $1 AND $2
      GROUP BY p.code, p.name ORDER BY movimentos DESC, quantidade DESC LIMIT 5`, [from, to])).rows;
  const alerts = (await pool.query(
    `SELECT p.id, p.code, p.name, p.quantity, p.min_stock AS "minStock", ${STOCK_STATUS} AS status
       FROM products p WHERE p.active AND p.quantity <= GREATEST(p.min_stock, 0) AND (p.quantity <= 0 OR p.quantity <= p.min_stock)
      ORDER BY p.quantity, p.name LIMIT 20`)).rows;
  return {
    produtos: t.produtos, produtosAtivos: t.ativos, itensEmEstoque: Number(t.itens), valorEstimado: n(t.valor),
    abaixoMinimo: t.baixo, semEstoque: t.zerado,
    entradas: { qtd: mov.find((x) => x.type === 'entrada')?.qtd ?? 0, total: Number(mov.find((x) => x.type === 'entrada')?.total ?? 0) },
    saidas: { qtd: mov.find((x) => x.type === 'saida')?.qtd ?? 0, total: Number(mov.find((x) => x.type === 'saida')?.total ?? 0) },
    recentMovements: recent.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    topMoved: top.map((r) => ({ ...r, quantidade: Number(r.quantidade) })),
    alerts: alerts.map((r) => ({ ...r, quantity: Number(r.quantity), minStock: Number(r.minStock) })),
  };
}
