import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { HttpError, Where, h, likeEsc, listParams, onlyDigits, optStr, parse, qstr, reqStr, validCnpj, validCpf } from '../util.js';

export const cadRouter = Router();

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const partySchema = z.object({
  name: reqStr(200, 'Informe o nome'),
  isCustomer: z.boolean().default(false),
  isSupplier: z.boolean().default(false),
  document: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email('E-mail inválido').max(160).nullable().optional()),
  phone: optStr(30),
  notes: optStr(1000),
  active: z.boolean().default(true),
}).refine((d) => d.isCustomer || d.isSupplier, { path: ['isCustomer'], message: 'Marque cliente, fornecedor ou ambos' });

const SELECT = `p.id, p.name, p.is_customer AS "isCustomer", p.is_supplier AS "isSupplier", p.document, p.email, p.phone, p.notes, p.active,
  p.created_at AS "createdAt",
  ((SELECT count(*) FROM financial_transactions x WHERE x.party_id = p.id)
   + (SELECT count(*) FROM products x WHERE x.supplier_id = p.legacy_supplier_id)
   + (SELECT count(*) FROM stock_movements x WHERE x.supplier_id = p.legacy_supplier_id))::int AS "usageCount"`;

function cleanDocument(raw: string | null | undefined) {
  const dg = onlyDigits(raw);
  if (!dg) return null;
  if (dg.length === 11 ? !validCpf(dg) : dg.length === 14 ? !validCnpj(dg) : true) throw new HttpError(422, 'Documento inválido', { document: 'Informe um CPF ou CNPJ válido' });
  return dg;
}

// Opções leves para selects de outros módulos (financeiro e estoque também podem ler).
cadRouter.get('/parties/options', requireAuth('cad.view', 'fin.view', 'est.view'), h(async (req, res) => {
  const kind = qstr(req, 'kind');
  const w = new Where().add('p.active');
  if (kind === 'customer') w.add('p.is_customer');
  if (kind === 'supplier') w.add('p.is_supplier');
  res.json((await pool.query(`SELECT p.id, p.name FROM parties p ${w.sql} ORDER BY lower(p.name)`, w.params)).rows);
}));

cadRouter.get('/parties', requireAuth('cad.view'), h(async (req, res) => {
  const p = listParams(req, { name: 'lower(p.name)', createdAt: 'p.created_at' }, 'name');
  const w = new Where();
  if (p.q) {
    const dg = onlyDigits(p.q);
    if (dg) w.add('(p.name ILIKE ? OR p.document LIKE ? OR p.email ILIKE ?)', likeEsc(p.q), `%${dg}%`, likeEsc(p.q));
    else w.add('(p.name ILIKE ? OR p.email ILIKE ?)', likeEsc(p.q), likeEsc(p.q));
  }
  const kind = qstr(req, 'kind');
  if (kind === 'customer') w.add('p.is_customer'); else if (kind === 'supplier') w.add('p.is_supplier');
  const active = qstr(req, 'active'); if (active === 'true' || active === 'false') w.add('p.active = ?', active === 'true');
  const total = (await pool.query(`SELECT count(*)::int n FROM parties p ${w.sql}`, w.params)).rows[0].n;
  const rows = (await pool.query(`SELECT ${SELECT} FROM parties p ${w.sql} ORDER BY ${p.sort} ${p.dir}, p.id LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`, w.params)).rows;
  res.json({ rows, total, page: p.page, pageSize: p.pageSize });
}));

cadRouter.get('/parties/:id', requireAuth('cad.view'), h(async (req, res) => {
  const r = (await pool.query(`SELECT ${SELECT} FROM parties p WHERE p.id = $1`, [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Cadastro não encontrado');
  res.json(r);
}));

/** O estoque ainda referencia a tabela suppliers: manter uma linha espelho para cada parceiro fornecedor. */
async function syncSupplierMirror(c: { query: typeof pool.query }, id: number, d: { name: string; isSupplier: boolean; active: boolean }) {
  const cur = (await c.query('SELECT legacy_supplier_id AS sid FROM parties WHERE id = $1', [id])).rows[0];
  if (d.isSupplier) {
    if (cur.sid) await c.query('UPDATE suppliers SET name = $2, active = $3 WHERE id = $1', [cur.sid, d.name, d.active]);
    else {
      const sid = (await c.query('INSERT INTO suppliers (name, active) VALUES ($1,$2) RETURNING id', [d.name, d.active])).rows[0].id;
      await c.query('UPDATE parties SET legacy_supplier_id = $2 WHERE id = $1', [id, sid]);
    }
  } else if (cur.sid) await c.query('UPDATE suppliers SET active = false WHERE id = $1', [cur.sid]);
}

const dupMsg = (e: unknown): never => {
  const x = e as { code?: string; constraint?: string };
  if (x.code === '23505') {
    if (x.constraint === 'parties_document_uq') throw new HttpError(409, 'Documento já cadastrado', { document: 'Já cadastrado' });
    throw new HttpError(409, 'Já existe um cadastro com este nome', { name: 'Já cadastrado' });
  }
  throw e;
};

cadRouter.post('/parties', requireAuth('cad.create'), h(async (req, res) => {
  const d = parse(partySchema, req.body);
  const doc = cleanDocument(d.document);
  const id = await tx(async (c) => {
    const id = (await c.query(
      `INSERT INTO parties (name, is_customer, is_supplier, document, email, phone, notes, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [d.name, d.isCustomer, d.isSupplier, doc, d.email ?? null, d.phone ?? null, d.notes ?? null, d.active])).rows[0].id as number;
    await syncSupplierMirror(c, id, d);
    await audit(req, { action: 'criar', module: 'cadastros', entity: 'party', entityId: id, summary: `Cadastro criado: ${d.name}` }, c);
    return id;
  }).catch(dupMsg);
  res.status(201).json({ id });
}));

cadRouter.put('/parties/:id', requireAuth('cad.edit', 'cad.inactivate'), h(async (req, res) => {
  const d = parse(partySchema, req.body);
  const doc = cleanDocument(d.document);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM parties WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Cadastro não encontrado');
    if (cur.active !== d.active && !req.user!.perms.has('cad.inactivate')) throw new HttpError(403, 'Sem permissão para inativar/ativar.');
    if (!req.user!.perms.has('cad.edit') && (cur.name !== d.name || cur.document !== doc)) throw new HttpError(403, 'Sem permissão para editar.');
    await c.query(
      `UPDATE parties SET name=$2, is_customer=$3, is_supplier=$4, document=$5, email=$6, phone=$7, notes=$8, active=$9, updated_at=now() WHERE id=$1`,
      [req.params.id, d.name, d.isCustomer, d.isSupplier, doc, d.email ?? null, d.phone ?? null, d.notes ?? null, d.active]);
    await syncSupplierMirror(c, Number(req.params.id), d);
    const act = cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar';
    await audit(req, { action: act, module: 'cadastros', entity: 'party', entityId: req.params.id, summary: `Cadastro ${act === 'ativar' ? 'ativado' : act === 'inativar' ? 'inativado' : 'editado'}: ${d.name}` }, c);
  }).catch(dupMsg);
  res.json({ ok: true });
}));
