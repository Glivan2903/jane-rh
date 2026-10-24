import { Router, type Request } from 'express';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { hasPerm, requireAuth } from '../auth.js';
import { HttpError, h, onlyDigits, today, validCnpj, validCpf } from '../util.js';
import { applyMovement } from '../services/stockmove.js';
import { syncSupplierMirror } from './cad.js';

/**
 * Importação de planilhas. A planilha é lida no navegador; aqui cada linha é validada (prévia) e depois gravada.
 * Só CRIA registros: linhas que já existem (mesmo documento, código de barras ou nome) são ignoradas, nada é alterado.
 */
export const importRouter = Router();

const MAX_ROWS = 1000;
type Row = Record<string, string>;
type Cx = Parameters<Parameters<typeof tx>[0]>[0];
interface Result { status: 'ok' | 'duplicado' | 'erro'; message: string }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
/** "1.234,56", "1234.56" e "R$ 10,00" viram número; vazio vira null; ilegível vira NaN. */
function num(raw: string): number | null {
  let s = raw.replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

interface Entity {
  perms: string[]; module: string; label: string;
  prepare: (c: Cx | typeof pool) => Promise<unknown>;
  check: (row: Row, ctx: any, seen: Set<string>) => { r: Result; data?: any };
  insert: (c: Cx, req: Request, data: any, ctx: any) => Promise<void>;
}

const productEntity: Entity = {
  perms: ['est.create'], module: 'estoque', label: 'Produtos',
  async prepare(c) {
    const units = (await c.query('SELECT id, code, name FROM units_of_measure WHERE active')).rows;
    const cats = (await c.query('SELECT id, name FROM product_categories')).rows;
    const exist = (await c.query('SELECT lower(name) n, barcode b FROM products')).rows;
    return {
      units: new Map(units.flatMap((u: any) => [[norm(u.code), u.id], [norm(u.name), u.id]])),
      cats: new Map(cats.map((x: any) => [norm(x.name), x.id])),
      names: new Set(exist.map((x: any) => norm(x.n))), barcodes: new Set(exist.filter((x: any) => x.b).map((x: any) => x.b.toLowerCase())),
    };
  },
  check(row, ctx, seen) {
    const name = str(row.name); const err = (message: string) => ({ r: { status: 'erro' as const, message } });
    if (!name) return err('Informe o nome');
    if (name.length > 200) return err('Nome com mais de 200 caracteres');
    const unitTxt = str(row.unit); const unitId = ctx.units.get(norm(unitTxt));
    if (!unitTxt) return err('Informe a unidade'); if (!unitId) return err(`Unidade "${unitTxt}" não cadastrada`);
    const barcode = str(row.barcode);
    if (barcode && !/^[0-9A-Za-z-]{4,50}$/.test(barcode)) return err('Código de barras inválido');
    const nums: Record<string, number | null> = {};
    for (const [k, label] of [['cost', 'Custo'], ['salePrice', 'Preço de venda'], ['minStock', 'Estoque mínimo'], ['quantity', 'Quantidade']] as const) {
      const v = num(str(row[k])); if (Number.isNaN(v) || (v !== null && (v < 0 || v > 999999999))) return err(`${label} inválido`); nums[k] = v;
    }
    const nk = 'n:' + norm(name); const bk = barcode ? 'b:' + barcode.toLowerCase() : '';
    if (ctx.names.has(norm(name)) || (barcode && ctx.barcodes.has(barcode.toLowerCase()))) return { r: { status: 'duplicado' as const, message: 'Já cadastrado' } };
    if (seen.has(nk) || (bk && seen.has(bk))) return { r: { status: 'duplicado' as const, message: 'Repetido na planilha' } };
    seen.add(nk); if (bk) seen.add(bk);
    const cat = str(row.category);
    return { r: { status: 'ok' as const, message: cat && !ctx.cats.has(norm(cat)) ? `Cria a categoria "${cat}"` : '' },
      data: { name, unitId, category: cat, barcode: barcode || null, cost: nums.cost ?? 0, salePrice: nums.salePrice, minStock: nums.minStock ?? 0, location: str(row.location) || null, quantity: nums.quantity ?? 0 } };
  },
  async insert(c, req, d, ctx) {
    let categoryId: number | null = null;
    if (d.category) {
      categoryId = ctx.cats.get(norm(d.category)) ?? null;
      if (!categoryId) { categoryId = (await c.query('INSERT INTO product_categories (name) VALUES ($1) RETURNING id', [d.category])).rows[0].id; ctx.cats.set(norm(d.category), categoryId); }
    }
    const code = 'PRD-' + String((await c.query(`SELECT nextval('product_code_seq') n`)).rows[0].n).padStart(6, '0');
    const id = (await c.query(
      `INSERT INTO products (code,name,category_id,unit_id,barcode,cost,sale_price,quantity,min_stock,location,active,tracks_batches)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,true,false) RETURNING id`,
      [code, d.name, categoryId, d.unitId, d.barcode, d.cost, d.salePrice, d.minStock, d.location])).rows[0].id;
    if (d.quantity > 0) await applyMovement(c, req, { productId: id, type: 'entrada', quantity: d.quantity, date: today(), reason: 'Saldo inicial', unitCost: d.cost, key: null });
    await audit(req, { action: 'criar', module: 'estoque', entity: 'product', entityId: id, summary: `Produto importado: ${code} — ${d.name}` }, c);
  },
};

const partyEntity: Entity = {
  perms: ['cad.create'], module: 'cadastros', label: 'Clientes e fornecedores',
  async prepare(c) {
    const rows = (await c.query('SELECT lower(name) n, document d FROM parties')).rows;
    return { names: new Set(rows.map((x: any) => norm(x.n))), docs: new Set(rows.filter((x: any) => x.d).map((x: any) => x.d)) };
  },
  check(row, ctx, seen) {
    const err = (message: string) => ({ r: { status: 'erro' as const, message } });
    const name = str(row.name); if (!name) return err('Informe o nome'); if (name.length > 200) return err('Nome com mais de 200 caracteres');
    const k = norm(str(row.kind)); let isCustomer = false; let isSupplier = false;
    if (!k) isCustomer = true;
    else if (/ambos|^(cliente.*fornecedor|fornecedor.*cliente)|^(c\/f|cf)$/.test(k)) isCustomer = isSupplier = true;
    else if (k.startsWith('cliente')) isCustomer = true;
    else if (k.startsWith('fornec')) isSupplier = true;
    else return err(`Tipo "${str(row.kind)}" inválido (use Cliente, Fornecedor ou Ambos)`);
    const dg = onlyDigits(str(row.document));
    if (dg && (dg.length === 11 ? !validCpf(dg) : dg.length === 14 ? !validCnpj(dg) : true)) return err('CPF ou CNPJ inválido');
    const email = str(row.email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('E-mail inválido');
    const nk = 'n:' + norm(name); const dk = dg ? 'd:' + dg : '';
    if (ctx.names.has(norm(name)) || (dg && ctx.docs.has(dg))) return { r: { status: 'duplicado' as const, message: 'Já cadastrado' } };
    if (seen.has(nk) || (dk && seen.has(dk))) return { r: { status: 'duplicado' as const, message: 'Repetido na planilha' } };
    seen.add(nk); if (dk) seen.add(dk);
    return { r: { status: 'ok' as const, message: '' }, data: { name, isCustomer, isSupplier, document: dg || null, email: email || null, phone: str(row.phone).slice(0, 30) || null, notes: str(row.notes).slice(0, 1000) || null } };
  },
  async insert(c, req, d) {
    const id = (await c.query(`INSERT INTO parties (name, is_customer, is_supplier, document, email, phone, notes, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
      [d.name, d.isCustomer, d.isSupplier, d.document, d.email, d.phone, d.notes])).rows[0].id as number;
    await syncSupplierMirror(c, id, { name: d.name, isSupplier: d.isSupplier, active: true });
    await audit(req, { action: 'criar', module: 'cadastros', entity: 'party', entityId: id, summary: `Cadastro importado: ${d.name}` }, c);
  },
};

const ENTITIES: Record<string, Entity> = { produtos: productEntity, parceiros: partyEntity };

function entityOf(req: Request) {
  const e = ENTITIES[String(req.params.entity)];
  if (!e) throw new HttpError(404, 'Tipo de importação não encontrado');
  if (!e.perms.every((p) => hasPerm(req, p))) throw new HttpError(403, 'Sem permissão para importar este tipo de dado.');
  return e;
}
function rowsOf(req: Request): Row[] {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(422, 'A planilha não tem linhas para importar.');
  if (rows.length > MAX_ROWS) throw new HttpError(422, `Importe até ${MAX_ROWS} linhas por vez.`);
  return rows.map((r) => (r && typeof r === 'object' ? (r as Row) : {}));
}
function evaluate(e: Entity, ctx: unknown, rows: Row[], req: Request) {
  const seen = new Set<string>(); const out: { data?: unknown; r: Result }[] = [];
  const canMove = hasPerm(req, 'est.move');
  for (const row of rows) {
    const x = e.check(row, ctx, seen);
    if (x.r.status === 'ok' && e === productEntity && x.data.quantity > 0 && !canMove) out.push({ r: { status: 'erro', message: 'Sem permissão para lançar saldo inicial' } });
    else out.push(x);
  }
  return out;
}
const summary = (list: { r: Result }[]) => ({ ok: list.filter((x) => x.r.status === 'ok').length, duplicado: list.filter((x) => x.r.status === 'duplicado').length, erro: list.filter((x) => x.r.status === 'erro').length });

importRouter.post('/:entity/preview', requireAuth(), h(async (req, res) => {
  const e = entityOf(req); const rows = rowsOf(req);
  const list = evaluate(e, await e.prepare(pool), rows, req);
  res.json({ ...summary(list), rows: list.map((x, i) => ({ line: i + 1, ...x.r })) });
}));

importRouter.post('/:entity/commit', requireAuth(), h(async (req, res) => {
  const e = entityOf(req); const rows = rowsOf(req);
  const out = await tx(async (c) => {
    const ctx = await e.prepare(c);
    const list = evaluate(e, ctx, rows, req);
    for (const x of list) if (x.r.status === 'ok') await e.insert(c, req, x.data, ctx);
    const s = summary(list);
    await audit(req, { action: 'importar', module: e.module, entity: 'import', entityId: null, summary: `Importação de planilha (${e.label}): ${s.ok} criados, ${s.duplicado} já existiam, ${s.erro} com erro` }, c);
    return s;
  });
  res.json(out);
}));
