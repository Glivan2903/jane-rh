import { pool } from '../db.js';

/**
 * Sugestões de ação: o sistema propõe, a pessoa confirma. Nada aqui grava dados; a execução fica na rota de confirmação,
 * que usa as mesmas regras e permissões das telas.
 */
export interface SuggestedItem { productId: string; code: string; name: string; unit: string; current: number; pending: number; min: number; suggested: number; unitCost: number }
export interface PurchaseSuggestion { id: string; type: 'purchase_order'; title: string; detail: string; partyId: number | null; partyName: string | null; items: SuggestedItem[] }

const num = (v: unknown) => Number(v ?? 0);

/** Produtos ativos no estoque mínimo (ou abaixo), já descontando o que está em pedidos em aberto. A sugestão repõe até o dobro do mínimo. */
export async function purchaseSuggestions(): Promise<PurchaseSuggestion[]> {
  const rows = (await pool.query(
    `SELECT p.id, p.code, p.name, u.code AS unit, p.quantity, p.min_stock, p.cost, par.id AS party_id, par.name AS party_name, COALESCE(pend.qty, 0) AS pending
       FROM products p
       JOIN units_of_measure u ON u.id = p.unit_id
       LEFT JOIN parties par ON par.legacy_supplier_id = p.supplier_id AND par.active AND par.is_supplier
       LEFT JOIN LATERAL (SELECT sum(i.quantity - i.received_qty) AS qty FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id
                           WHERE i.product_id = p.id AND o.status IN ('rascunho','enviado','parcial')) pend ON true
      WHERE p.active AND p.min_stock > 0 AND p.quantity + COALESCE(pend.qty, 0) <= p.min_stock
      ORDER BY par.name NULLS LAST, lower(p.name)`)).rows;
  const groups = new Map<string, PurchaseSuggestion>();
  for (const r of rows) {
    const min = num(r.min_stock), current = num(r.quantity), pending = num(r.pending);
    const suggested = Math.max(1, Math.ceil(min * 2 - current - pending));
    const key = r.party_id ? `po:${r.party_id}` : 'po:sem-fornecedor';
    let g = groups.get(key);
    if (!g) { g = { id: key, type: 'purchase_order', title: '', detail: '', partyId: r.party_id ?? null, partyName: r.party_name ?? null, items: [] }; groups.set(key, g); }
    g.items.push({ productId: r.id, code: r.code, name: r.name, unit: r.unit, current, pending, min, suggested, unitCost: num(r.cost) });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    title: `Repor ${g.items.length} produto${g.items.length > 1 ? 's' : ''}${g.partyName ? ` de ${g.partyName}` : ' sem fornecedor definido'}`,
    detail: `${g.items.some((i) => i.current <= 0) ? 'Alguns estão sem estoque. ' : ''}As quantidades repõem até o dobro do estoque mínimo e já descontam o que está em pedidos em aberto. Você pode ajustá-las antes de criar o rascunho.`,
  }));
}
