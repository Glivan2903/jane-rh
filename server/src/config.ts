import 'dotenv/config';
import path from 'node:path';
import dotenv from 'dotenv';

// Em desenvolvimento o .env fica na raiz do projeto.
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const required = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: Number(process.env.SESSION_HOURS ?? 8),
  pgDumpCmd: process.env.PG_DUMP_CMD?.trim() || '',
  psqlCmd: process.env.PSQL_CMD?.trim() || '',
  backupDir: path.resolve(process.cwd(), process.env.BACKUP_DIR ?? './storage/backups'),
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './storage/uploads'),
};
export const isProd = config.env === 'production';
