import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { HttpError, h, onlyDigits, optStr, parse, reqStr, validCnpj } from '../util.js';

/** Dados da empresa (cabeçalho de relatórios e documentos). Leitura: qualquer usuário logado; alteração: cfg.settings. */
export const companyRouter = Router();

const nullable = (s: z.ZodTypeAny) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable().optional());
const companySchema = z.object({
  legalName: reqStr(200, 'Informe a razão social'),
  tradeName: optStr(200),
  cnpj: nullable(z.string().refine(validCnpj, 'CNPJ inválido').transform(onlyDigits)),
  stateRegistration: optStr(30),
  zip: nullable(z.string().transform(onlyDigits).refine((s) => s.length === 8, 'CEP deve ter 8 dígitos')),
  street: optStr(200), number: optStr(20), complement: optStr(100), district: optStr(100), city: optStr(100),
  state: nullable(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida')),
  phone: optStr(30),
  email: nullable(z.string().trim().toLowerCase().email('E-mail inválido').max(200)),
  website: optStr(200),
});

const LOGO_TYPES = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]);

async function getSetting(key: string) {
  return (await pool.query('SELECT value FROM settings WHERE key=$1', [key])).rows[0]?.value ?? null;
}
async function putSetting(key: string, value: unknown) {
  await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
}

companyRouter.get('/', requireAuth(), h(async (_req, res) => {
  const data = (await getSetting('company')) ?? {};
  const logo = await getSetting('company_logo');
  res.json({ ...data, logoVersion: logo?.version ?? null });
}));

companyRouter.get('/logo', requireAuth(), h(async (_req, res) => {
  const logo = await getSetting('company_logo');
  if (!logo) throw new HttpError(404, 'Sem logotipo');
  const file = path.join(config.uploadDir, path.basename(logo.file));
  if (!fs.existsSync(file)) throw new HttpError(404, 'Sem logotipo');
  res.setHeader('Content-Type', logo.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(file);
}));

companyRouter.put('/', requireAuth('cfg.settings'), h(async (req, res) => {
  const d = parse(companySchema, req.body);
  await putSetting('company', d);
  await audit(req, { action: 'editar', module: 'config', entity: 'company', summary: `Dados da empresa atualizados: ${d.legalName}` });
  res.json({ ok: true });
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => cb(null, LOGO_TYPES.get(path.extname(f.originalname).toLowerCase()) === f.mimetype),
});

companyRouter.post('/logo', requireAuth('cfg.settings'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(422, 'Envie uma imagem PNG, JPG ou WEBP de até 1 MB.');
  const ext = path.extname(req.file.originalname).toLowerCase();
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const old = await getSetting('company_logo');
  const name = `company-logo-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, name), req.file.buffer, { mode: 0o640 });
  await putSetting('company_logo', { file: name, mime: req.file.mimetype, version: Date.now() });
  if (old?.file) fs.rmSync(path.join(config.uploadDir, path.basename(old.file)), { force: true });
  await audit(req, { action: 'editar', module: 'config', entity: 'company', summary: 'Logotipo da empresa atualizado' });
  res.json({ ok: true });
}));

companyRouter.delete('/logo', requireAuth('cfg.settings'), h(async (req, res) => {
  const old = await getSetting('company_logo');
  if (old?.file) fs.rmSync(path.join(config.uploadDir, path.basename(old.file)), { force: true });
  await pool.query(`DELETE FROM settings WHERE key='company_logo'`);
  await audit(req, { action: 'excluir', module: 'config', entity: 'company', summary: 'Logotipo da empresa removido' });
  res.json({ ok: true });
}));
