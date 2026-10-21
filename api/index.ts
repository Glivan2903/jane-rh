import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';
import { migrate } from '../server/src/db.js';

// Entrada serverless da Vercel: a API Express inteira atrás de /api; o frontend é estático.
const app = createApp();
const ready = migrate(path.resolve(process.cwd(), 'server/migrations'));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ready;
  app(req, res);
}
