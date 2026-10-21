import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

export function onlyDigits(s: string | null | undefined) {
  return (s ?? '').replace(/\D/g, '');
}

export function validCpf(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(c[i]) * (n + 1 - i);
    const d = ((sum * 10) % 11) % 10;
    if (d !== Number(c[n])) return false;
  }
  return true;
}

export function validCnpj(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, wi, i) => a + Number(c[i]) * wi, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

// ---- Schemas reutilizáveis ----
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const optStr = (max = 500) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
export const reqStr = (max = 500, msg = 'Campo obrigatório') => z.string({ required_error: msg }).trim().min(1, msg).max(max);
export const optDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullable().optional());
export const reqDate = z.string({ required_error: 'Data obrigatória' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida');
export const optInt = z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional());
export const reqInt = z.coerce.number({ invalid_type_error: 'Seleção obrigatória' }).int().positive('Seleção obrigatória');
export const money = z.coerce.number({ invalid_type_error: 'Valor inválido' }).positive('Informe um valor maior que zero')
  .max(999999999999).refine((n) => Math.round(n * 100) / 100 === n, 'Use no máximo 2 casas decimais');
export const optMoney = z.preprocess(emptyToNull, z.coerce.number().min(0, 'Valor inválido').max(999999999999).nullable().optional());
export const qty = z.coerce.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade deve ser maior que zero')
  .max(999999999).refine((n) => Math.round(n * 1000) / 1000 === n, 'Use no máximo 3 casas decimais');

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '_';
    if (!fields[k]) fields[k] = i.message;
  }
  throw new HttpError(422, 'Verifique os campos informados', fields);
}

// ---- Listagens ----
export interface ListParams { page: number; pageSize: number; sort: string; dir: 'ASC' | 'DESC'; q: string }

export function listParams(req: Request, sortable: Record<string, string>, defSort: string, defDir: 'ASC' | 'DESC' = 'ASC'): ListParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  const key = String(req.query.sort ?? defSort);
  const sort = sortable[key] ?? sortable[defSort];
  const dir = String(req.query.dir ?? defDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return { page, pageSize, sort, dir, q: String(req.query.q ?? '').trim() };
}

export const qstr = (req: Request, k: string): string | undefined => {
  const v = req.query[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
};

export const likeEsc = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

/** Acumula condições WHERE com parâmetros posicionais. */
export class Where {
  conds: string[] = [];
  params: unknown[] = [];
  add(sql: string, ...vals: unknown[]) {
    let s = sql;
    for (const v of vals) { this.params.push(v); s = s.replace('?', `$${this.params.length}`); }
    this.conds.push(s);
    return this;
  }
  get sql() { return this.conds.length ? 'WHERE ' + this.conds.join(' AND ') : ''; }
}

// ---- CSV (separador ; e BOM para abrir corretamente no Excel pt-BR) ----
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita injeção de fórmula
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(';'));
  return '﻿' + lines.join('\r\n');
}

export function sendReport(req: Request, res: Response, name: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[], extra: object = {}) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(toCsv(columns, rows));
  }
  return res.json({ columns, rows, ...extra });
}

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
