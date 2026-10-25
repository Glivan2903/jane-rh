import { pool, tx } from '../db.js';
import { getSettings } from './settings.js';
import { TODAY_SQL } from './finance.js';

/**
 * Alertas de anomalia: regras estatísticas simples sobre o histórico (sem IA), reavaliadas de tempos em tempos.
 * Cada achado tem uma chave estável (dedupe_key): reaparecer não duplica, dispensar é respeitado e, quando a causa some, o alerta é resolvido.
 */
type Cx = Parameters<Parameters<typeof tx>[0]>[0];
export interface Found { kind: string; area: 'fin' | 'est' | 'rh'; severity: 'atencao' | 'alerta'; key: string; title: string; detail: string; link: string; data: Record<string, unknown> }

/** Sensibilidade 1 (baixa), 2 (média), 3 (alta): quanto acima do normal precisa estar para alertar. */
const LEVELS: Record<number, { ratio: number; z: number }> = { 1: { ratio: 2, z: 4 }, 2: { ratio: 1.6, z: 3 }, 3: { ratio: 1.3, z: 2.5 } };
const MIN_FIN = 200;      // diferenças menores que isso (em reais) não são alertadas
const MIN_QTY = 5;        // idem, em quantidade de estoque
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (r: number) => `${Math.round((r - 1) * 100)}%`;
const num = (v: unknown) => Number(v ?? 0);
const q = (c: Cx | typeof pool) => c.query.bind(c);

async function financeCategorySpike(c: Cx | typeof pool, lv: { ratio: number }): Promise<Found[]> {
  const rows = (await q(c)(
    `WITH m AS (
       SELECT t.category_id, date_trunc('month', t.competence_date)::date AS mes, sum(t.amount) AS total
         FROM financial_transactions t
        WHERE t.type='despesa' AND t.status <> 'cancelada'
          AND t.competence_date >= date_trunc('month', ${TODAY_SQL})::date - interval '6 months'
          AND t.competence_date < date_trunc('month', ${TODAY_SQL})::date + interval '1 month'
        GROUP BY 1, 2)
     SELECT c.name, cur.total AS atual, to_char(cur.mes, 'YYYY-MM') AS mes, h.media, h.meses
       FROM m cur
       JOIN financial_categories c ON c.id = cur.category_id
       JOIN LATERAL (SELECT sum(total) / 6 AS media, count(*)::int AS meses FROM m p WHERE p.category_id = cur.category_id AND p.mes < cur.mes) h ON true
      WHERE cur.mes = date_trunc('month', ${TODAY_SQL})::date AND h.meses >= 3`)).rows;
  const out: Found[] = [];
  for (const r of rows) {
    const atual = num(r.atual), media = num(r.media); if (media <= 0) continue;
    const ratio = atual / media;
    if (ratio < lv.ratio || atual - media < MIN_FIN) continue;
    out.push({ kind: 'fin_categoria', area: 'fin', severity: ratio >= 2.5 ? 'alerta' : 'atencao', key: `fin_cat:${r.name}:${r.mes}`,
      title: `Despesa de "${r.name}" acima do normal`,
      detail: `Neste mês já são ${brl(atual)}, ${pct(ratio)} acima da média mensal de ${brl(media)} dos últimos 6 meses.`,
      link: '/financeiro/despesas', data: { categoria: r.name, mes: r.mes, atual, media, ratio: Math.round(ratio * 100) / 100 } });
  }
  return out;
}

async function financeBigEntry(c: Cx | typeof pool, lv: { z: number }): Promise<Found[]> {
  const rows = (await q(c)(
    `SELECT t.id, t.type, t.description, t.amount, c.name AS categoria, s.media, s.desvio, s.n
       FROM financial_transactions t
       JOIN financial_categories c ON c.id = t.category_id
       JOIN LATERAL (SELECT avg(x.amount) AS media, stddev_samp(x.amount) AS desvio, count(*)::int AS n FROM financial_transactions x
                      WHERE x.category_id = t.category_id AND x.type = t.type AND x.status <> 'cancelada' AND x.id <> t.id
                        AND x.competence_date >= ${TODAY_SQL} - 365) s ON true
      WHERE t.status <> 'cancelada' AND t.created_at >= now() - interval '30 days' AND s.n >= 6 AND s.desvio > 0`)).rows;
  const out: Found[] = [];
  for (const r of rows) {
    const amount = num(r.amount), media = num(r.media), z = (amount - media) / num(r.desvio);
    if (z < lv.z || amount - media < MIN_FIN) continue;
    const tipo = r.type === 'despesa' ? 'despesa' : 'receita';
    out.push({ kind: 'fin_valor', area: 'fin', severity: z >= lv.z * 1.7 ? 'alerta' : 'atencao', key: `fin_val:${r.id}`,
      title: `Valor fora do padrão em "${r.categoria}"`,
      detail: `${tipo === 'despesa' ? 'A despesa' : 'A receita'} "${r.description}" é de ${brl(amount)}, enquanto o valor típico da categoria é ${brl(media)}.`,
      link: `/financeiro/${tipo === 'despesa' ? 'despesas' : 'receitas'}`, data: { id: r.id, valor: amount, media, z: Math.round(z * 10) / 10 } });
  }
  return out;
}

async function financeDuplicates(c: Cx | typeof pool): Promise<Found[]> {
  const rows = (await q(c)(
    `SELECT a.id AS a, b.id AS b, a.type, a.description, a.amount, to_char(a.due_date,'DD/MM/YYYY') AS da, to_char(b.due_date,'DD/MM/YYYY') AS db
       FROM financial_transactions a JOIN financial_transactions b ON b.id > a.id AND b.type = a.type AND b.amount = a.amount
        AND abs(b.due_date - a.due_date) <= 7
        AND (lower(coalesce(a.party,'')) = lower(coalesce(b.party,'')) AND lower(a.description) = lower(b.description))
      WHERE a.status <> 'cancelada' AND b.status <> 'cancelada' AND a.amount >= 50
        AND (a.series_id IS NULL OR b.series_id IS NULL OR a.series_id <> b.series_id)
        AND greatest(a.created_at, b.created_at) >= now() - interval '30 days'`)).rows;
  return rows.map((r): Found => ({ kind: 'fin_duplicado', area: 'fin', severity: 'atencao', key: `fin_dup:${r.a}:${r.b}`,
    title: 'Possível lançamento duplicado',
    detail: `Dois lançamentos iguais de ${brl(num(r.amount))} ("${r.description}"), com vencimentos em ${r.da} e ${r.db}.`,
    link: `/financeiro/${r.type === 'despesa' ? 'despesas' : 'receitas'}`, data: { ids: [r.a, r.b], valor: num(r.amount) } }));
}

async function stockOutflow(c: Cx | typeof pool, lv: { ratio: number }): Promise<Found[]> {
  const rows = (await q(c)(
    `SELECT p.id, p.code, p.name, recente.qtd AS recente, hist.media, to_char(date_trunc('week', ${TODAY_SQL}), 'YYYY-MM-DD') AS sem
       FROM products p
       JOIN LATERAL (SELECT COALESCE(sum(quantity),0) AS qtd FROM stock_movements WHERE product_id = p.id AND type='saida' AND movement_date > ${TODAY_SQL} - 7) recente ON true
       JOIN LATERAL (SELECT COALESCE(sum(quantity),0) / 8 AS media, count(DISTINCT date_trunc('week', movement_date))::int AS semanas FROM stock_movements
                      WHERE product_id = p.id AND type='saida' AND movement_date <= ${TODAY_SQL} - 7 AND movement_date > ${TODAY_SQL} - 63) hist ON true
      WHERE p.active AND hist.semanas >= 3`)).rows;
  const out: Found[] = [];
  for (const r of rows) {
    const recente = num(r.recente), media = num(r.media); if (media <= 0) continue;
    const ratio = recente / media;
    if (ratio < lv.ratio + 0.4 || recente - media < MIN_QTY) continue;
    out.push({ kind: 'est_saida', area: 'est', severity: ratio >= 3 ? 'alerta' : 'atencao', key: `est_saida:${r.id}:${r.sem}`,
      title: `Saída acima do normal: ${r.name}`,
      detail: `Nos últimos 7 dias saíram ${recente.toLocaleString('pt-BR')} unidades, ${pct(ratio)} acima da média semanal de ${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`,
      link: `/estoque/movimentacoes?q=${encodeURIComponent(r.code)}`, data: { produto: r.code, recente, media, ratio: Math.round(ratio * 100) / 100 } });
  }
  return out;
}

async function stockAdjustments(c: Cx | typeof pool, lv: { ratio: number }): Promise<Found[]> {
  const min = lv.ratio >= 1.9 ? 0.4 : lv.ratio >= 1.5 ? 0.25 : 0.15;
  const rows = (await q(c)(
    `SELECT m.id, p.code, p.name, m.delta, m.balance_before, m.reason, to_char(m.movement_date,'DD/MM/YYYY') AS dia
       FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.type = 'ajuste' AND m.movement_date >= ${TODAY_SQL} - 30 AND abs(m.delta) >= ${MIN_QTY}
        AND m.balance_before > 0 AND abs(m.delta) / m.balance_before >= $1`, [min])).rows;
  return rows.map((r): Found => ({ kind: 'est_ajuste', area: 'est', severity: Math.abs(num(r.delta)) / num(r.balance_before) >= 0.6 ? 'alerta' : 'atencao', key: `est_ajuste:${r.id}`,
    title: `Ajuste grande de estoque: ${r.name}`,
    detail: `Em ${r.dia} o saldo foi ${num(r.delta) > 0 ? 'aumentado' : 'reduzido'} em ${Math.abs(num(r.delta)).toLocaleString('pt-BR')} (de ${num(r.balance_before).toLocaleString('pt-BR')}). Motivo: ${r.reason}.`,
    link: `/estoque/movimentacoes?q=${encodeURIComponent(r.code)}`, data: { produto: r.code, delta: num(r.delta), antes: num(r.balance_before) } }));
}

async function stockNegative(c: Cx | typeof pool): Promise<Found[]> {
  const rows = (await q(c)(`SELECT id, code, name, quantity FROM products WHERE active AND quantity < 0`)).rows;
  return rows.map((r): Found => ({ kind: 'est_negativo', area: 'est', severity: 'alerta', key: `est_neg:${r.id}`,
    title: `Saldo negativo: ${r.name}`, detail: `O saldo de ${r.code} está em ${num(r.quantity).toLocaleString('pt-BR')}. Confira as saídas e o inventário.`,
    link: `/estoque?q=${encodeURIComponent(r.code)}`, data: { produto: r.code, saldo: num(r.quantity) } }));
}

/** Roda todas as regras e sincroniza a tabela. Devolve quantos alertas estão abertos agora. */
export async function runScan(): Promise<{ abertos: number; novos: number; resolvidos: number }> {
  const st = await getSettings();
  const lv = LEVELS[st.anomaly_sensitivity] ?? LEVELS[2];
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(7440014)');
    const found = (await Promise.all([financeCategorySpike(c, lv), financeBigEntry(c, lv), financeDuplicates(c), stockOutflow(c, lv), stockAdjustments(c, lv), stockNegative(c)])).flat();
    let novos = 0;
    for (const f of found) {
      const r = await c.query(
        `INSERT INTO anomalies (kind, area, severity, dedupe_key, title, detail, link, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (dedupe_key) DO UPDATE SET severity = EXCLUDED.severity, title = EXCLUDED.title, detail = EXCLUDED.detail, link = EXCLUDED.link, data = EXCLUDED.data, last_seen = now(),
           status = CASE WHEN anomalies.status = 'resolvido' THEN 'aberto' ELSE anomalies.status END
         RETURNING (xmax = 0) AS inserted`, [f.kind, f.area, f.severity, f.key, f.title, f.detail, f.link, JSON.stringify(f.data)]);
      if (r.rows[0].inserted) novos++;
    }
    const keys = found.map((f) => f.key);
    const res = await c.query(`UPDATE anomalies SET status='resolvido' WHERE status='aberto' AND NOT (dedupe_key = ANY($1))`, [keys]);
    await c.query(`INSERT INTO settings (key, value) VALUES ('anomaly_last_scan', to_jsonb(now()::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    const abertos = (await c.query(`SELECT count(*)::int n FROM anomalies WHERE status='aberto'`)).rows[0].n;
    return { abertos, novos, resolvidos: res.rowCount ?? 0 };
  });
}

let running: Promise<unknown> | null = null;
/** Reavalia se a última verificação tem mais de `hours` horas. Sem agendador externo: quem consulta (o sino, a tela) dispara. */
export async function ensureFreshScan(hours = 6, wait = false) {
  const last = (await pool.query(`SELECT value FROM settings WHERE key='anomaly_last_scan'`)).rows[0]?.value as string | undefined;
  if (last && Date.now() - Date.parse(last) < hours * 3600_000) return;
  if (!running) running = runScan().catch((e) => console.error('anomalias:', e)).finally(() => { running = null; });
  if (wait) await running;
}
