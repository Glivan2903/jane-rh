import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config, isProd } from './config.js';
import { loadUser } from './auth.js';
import { HttpError } from './util.js';
import { authRouter } from './routes/auth.js';
import { configRouter } from './routes/config.js';
import { backupRouter } from './routes/backup.js';
import { rhRouter } from './routes/rh.js';
import { finRouter } from './routes/fin.js';
import { estRouter } from './routes/est.js';
import { dashboardRouter } from './routes/dashboard.js';
import { companyRouter } from './routes/company.js';
import { cadRouter } from './routes/cad.js';
import { bankingRouter } from './routes/banking.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', isProd ? 1 : false);
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // CSRF: cookie SameSite=Strict + cabeçalho customizado obrigatório em operações que alteram dados.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'gentis') {
      return next(new HttpError(403, 'Requisição não autorizada.'));
    }
    next();
  });
  app.use('/api', loadUser);

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/auth', authRouter);
  app.use('/api/config', configRouter);
  app.use('/api/config/backups', backupRouter);
  app.use('/api/rh', rhRouter);
  app.use('/api/fin', finRouter);
  app.use('/api/fin', bankingRouter);
  app.use('/api/est', estRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/company', companyRouter);
  app.use('/api/cad', cadRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Recurso não encontrado')));

  // Produção: serve o frontend compilado (mesma origem).
  const dist = path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, fields: err.fields });
    const e = err as { code?: string; message?: string; type?: string; constraint?: string };
    if (e.type === 'entity.parse.failed') return void res.status(400).json({ error: 'JSON inválido' });
    if (e.type === 'entity.too.large') return void res.status(413).json({ error: 'Requisição muito grande' });
    if (e.code === '23514') return void res.status(409).json({ error: e.message?.includes('Saldo') ? e.message : 'Operação viola uma regra de integridade.' });
    if (e.code === '23503') return void res.status(409).json({ error: 'Registro vinculado a outros dados.' });
    if (e.code === '23505') return void res.status(409).json({ error: 'Registro duplicado.' });
    if (e.code === '22P02' || e.code === '22007' || e.code === '22008') return void res.status(422).json({ error: 'Valor inválido informado.' });
    if (e.code?.startsWith('LIMIT_')) return void res.status(422).json({ error: 'Arquivo inválido ou acima de 5 MB.' });
    console.error(`[erro] ${req.method} ${req.path}`, err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });
  return app;
}
