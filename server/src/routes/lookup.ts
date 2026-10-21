import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { HttpError, h, parse, reqStr } from '../util.js';

interface LookupOpts {
  table: string;
  label: string;                         // "Departamento"
  module: string;                        // módulo de auditoria
  viewPerms: string[];                   // quem pode listar
  createPerm: string; editPerm: string; inactivatePerm: string;
  hasCode?: boolean;                     // unidades de medida: code + name
  usedBy: { table: string; column: string }[];
}

/** CRUD padrão para cadastros auxiliares: exclusão só se nunca usado; caso contrário, apenas inativação. */
export function lookupRouter(o: LookupOpts) {
  const r = Router();
  const schema = z.object({
    ...(o.hasCode ? { code: reqStr(10, 'Informe a sigla') } : {}),
    name: reqStr(100, 'Informe o nome'),
    active: z.boolean().default(true),
  });
  const cols = o.hasCode ? 'id, code, name, active' : 'id, name, active';
  const usage = o.usedBy.map((u) => `(SELECT count(*)::int FROM ${u.table} x WHERE x.${u.column} = t.id)`).join(' + ');

  r.get('/', requireAuth(...o.viewPerms), h(async (req, res) => {
    const onlyActive = req.query.active === 'true';
    const rows = (await pool.query(`SELECT ${cols.split(', ').map((c) => 't.' + c).join(', ')}, (${usage}) AS "usageCount" FROM ${o.table} t ${onlyActive ? 'WHERE t.active' : ''} ORDER BY lower(t.name)`)).rows;
    res.json(rows);
  }));

  const dup = (e: unknown): never => {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, `${o.label} já cadastrado(a)`, { [o.hasCode ? 'code' : 'name']: 'Já cadastrado' });
    throw e;
  };

  r.post('/', requireAuth(o.createPerm), h(async (req, res) => {
    const d = parse(schema, req.body) as { code?: string; name: string; active: boolean };
    try {
      const q = o.hasCode
        ? await pool.query(`INSERT INTO ${o.table} (code, name, active) VALUES ($1,$2,$3) RETURNING id`, [d.code, d.name, d.active])
        : await pool.query(`INSERT INTO ${o.table} (name, active) VALUES ($1,$2) RETURNING id`, [d.name, d.active]);
      await audit(req, { action: 'criar', module: o.module, entity: o.table, entityId: q.rows[0].id, summary: `${o.label} criado(a): ${d.name}` });
      res.status(201).json({ id: q.rows[0].id });
    } catch (e) { dup(e); }
  }));

  r.put('/:id', requireAuth(o.editPerm, o.inactivatePerm), h(async (req, res) => {
    const d = parse(schema, req.body) as { code?: string; name: string; active: boolean };
    const cur = (await pool.query(`SELECT * FROM ${o.table} WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Registro não encontrado');
    if (cur.active !== d.active && !req.user!.perms.has(o.inactivatePerm)) throw new HttpError(403, 'Sem permissão para inativar/ativar.');
    try {
      if (o.hasCode) await pool.query(`UPDATE ${o.table} SET code=$2, name=$3, active=$4 WHERE id=$1`, [req.params.id, d.code, d.name, d.active]);
      else await pool.query(`UPDATE ${o.table} SET name=$2, active=$3 WHERE id=$1`, [req.params.id, d.name, d.active]);
    } catch (e) { dup(e); }
    await audit(req, { action: cur.active !== d.active ? (d.active ? 'ativar' : 'inativar') : 'editar', module: o.module, entity: o.table, entityId: req.params.id, summary: `${o.label} ${cur.active !== d.active ? (d.active ? 'ativado(a)' : 'inativado(a)') : 'editado(a)'}: ${d.name}` });
    res.json({ ok: true });
  }));

  r.delete('/:id', requireAuth(o.inactivatePerm), h(async (req, res) => {
    const cur = (await pool.query(`SELECT t.*, (${usage}) AS uses FROM ${o.table} t WHERE t.id=$1`, [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Registro não encontrado');
    if (cur.uses > 0) throw new HttpError(409, `${o.label} em uso por ${cur.uses} registro(s). Inative em vez de excluir.`);
    await pool.query(`DELETE FROM ${o.table} WHERE id=$1`, [req.params.id]);
    await audit(req, { action: 'excluir', module: o.module, entity: o.table, entityId: req.params.id, summary: `${o.label} excluído(a): ${cur.name}` });
    res.json({ ok: true });
  }));
  return r;
}
