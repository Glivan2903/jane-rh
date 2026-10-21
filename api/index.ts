import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';
import { migrate } from '../server/src/db.js';

// Entrada serverless da Vercel: a API Express inteira atrás de /api; o frontend é estático.
const app = createApp();
let ready: Promise<unknown> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // Migrações pendentes rodam uma vez por instância; se falhar, tenta de novo na próxima requisição.
    ready ??= migrate(path.resolve(process.cwd(), 'server/migrations')).catch((e) => { ready = null; throw e; });
    await ready;
  } catch (e) {
    console.error('[erro] banco de dados indisponível:', (e as Error).message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Banco de dados indisponível. Verifique a variável DATABASE_URL.' }));
    return;
  }
  app(req, res);
}
