import { Router } from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { HttpError, h, parse } from '../util.js';
import type { Request } from 'express';

export const backupRouter = Router();

/*
 * Backup = arquivo .tar.gz com `db.sql` (pg_dump em SQL puro) + pasta `uploads/` (anexos).
 * Requer o cliente PostgreSQL (pg_dump/psql) no servidor OU PG_DUMP_CMD/PSQL_CMD apontando para ele
 * (ex.: `docker exec -i jane-db pg_dump -U jane -d jane`). Sem isso, a operação FALHA com mensagem clara — nada é simulado.
 */

let busy = false;

function splitCmd(cmd: string): string[] {
  return cmd.match(/(?:[^\s"]+|"[^"]*")+/g)!.map((s) => s.replace(/^"|"$/g, ''));
}

function run(argv: string[], opts: { stdin?: fs.ReadStream; stdout?: fs.WriteStream } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0], argv.slice(1), { stdio: [opts.stdin ? 'pipe' : 'ignore', opts.stdout ? 'pipe' : 'ignore', 'pipe'] });
    let err = '';
    p.stderr!.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    if (opts.stdin) opts.stdin.pipe(p.stdin!);
    if (opts.stdout) p.stdout!.pipe(opts.stdout);
    p.on('error', (e) => reject(new Error(`Não foi possível executar "${argv[0]}": ${e.message}. Instale o cliente PostgreSQL ou configure PG_DUMP_CMD/PSQL_CMD.`)));
    p.on('close', (code) => {
      if (code === 0) resolve(err);
      else reject(new Error(`${argv[0]} terminou com código ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

const dumpArgv = () => [...(config.pgDumpCmd ? splitCmd(config.pgDumpCmd) : ['pg_dump', '--dbname', config.databaseUrl]),
  '--no-owner', '--no-privileges', '--clean', '--if-exists', '--schema=public'];
const psqlArgv = () => config.psqlCmd ? splitCmd(config.psqlCmd) : ['psql', '--dbname', config.databaseUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction'];

const sha = (file: string) => new Promise<string>((resolve, reject) => {
  const hs = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => hs.update(d)).on('end', () => resolve(hs.digest('hex'))).on('error', reject);
});

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

export async function runBackup(req: Request | null, kind: 'manual' | 'automatico' | 'pre-restauracao') {
  if (busy) throw new HttpError(409, 'Outra operação de backup/restauração está em andamento.');
  busy = true;
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const filename = `gentis-${kind}-${stamp()}.tar.gz`;
  const file = path.join(config.backupDir, filename);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gentis-bkp-'));
  const userName = req?.user?.name ?? 'sistema';
  try {
    await run(dumpArgv(), { stdout: fs.createWriteStream(path.join(tmp, 'db.sql'), { mode: 0o600 }) });
    if (fs.statSync(path.join(tmp, 'db.sql')).size < 100) throw new Error('pg_dump gerou arquivo vazio.');
    fs.cpSync(config.uploadDir, path.join(tmp, 'uploads'), { recursive: true });
    await run(['tar', '-czf', file, '-C', tmp, 'db.sql', 'uploads']);
    fs.chmodSync(file, 0o600);
    const size = fs.statSync(file).size;
    const hash = await sha(file);
    const r = await pool.query(`INSERT INTO backup_logs (filename, kind, status, size_bytes, sha256, user_name) VALUES ($1,$2,'concluido',$3,$4,$5) RETURNING id`,
      [filename, kind, size, hash, userName]);
    await audit(req, { action: 'backup', module: 'config', entity: 'backup', entityId: r.rows[0].id, summary: `Backup ${kind} concluído (${filename})` });
    return { id: r.rows[0].id as number, filename, size };
  } catch (e) {
    fs.rmSync(file, { force: true });
    const msg = (e as Error).message;
    await pool.query(`INSERT INTO backup_logs (filename, kind, status, error, user_name) VALUES ($1,$2,'falha',$3,$4)`, [filename, kind, msg, userName]);
    await audit(req, { action: 'backup', module: 'config', entity: 'backup', summary: `Backup ${kind} falhou`, result: 'falha', details: { erro: msg } });
    throw new HttpError(500, `Falha ao gerar backup: ${msg}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    busy = false;
  }
}

/** Agendamento automático (BACKUP_AUTO_HOURS > 0). Mantém os N backups automáticos mais recentes. */
export function startAutoBackup(hours: number, keep: number) {
  if (!hours || hours <= 0) return;
  setInterval(async () => {
    try {
      await runBackup(null, 'automatico');
      const old = (await pool.query(`SELECT id, filename FROM backup_logs WHERE kind='automatico' AND status='concluido' ORDER BY created_at DESC OFFSET $1`, [keep])).rows;
      for (const o of old) {
        fs.rmSync(path.join(config.backupDir, o.filename), { force: true });
        await pool.query(`UPDATE backup_logs SET status='removido' WHERE id=$1`, [o.id]);
      }
    } catch (e) { console.error('[backup automático]', (e as Error).message); }
  }, hours * 3600_000).unref();
}

backupRouter.get('/', requireAuth('cfg.backup'), h(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT id, filename, kind, status, size_bytes AS "sizeBytes", error, user_name AS "userName", created_at AS "createdAt", restored_at AS "restoredAt"
       FROM backup_logs ORDER BY created_at DESC LIMIT 200`)).rows;
  res.json({ rows, info: { dir: config.backupDir, autoHours: Number(process.env.BACKUP_AUTO_HOURS ?? 0) } });
}));

backupRouter.post('/', requireAuth('cfg.backup'), h(async (req, res) => {
  res.status(201).json(await runBackup(req, 'manual'));
}));

async function getFile(id: string) {
  const b = (await pool.query(`SELECT * FROM backup_logs WHERE id=$1 AND status='concluido'`, [id])).rows[0];
  if (!b) throw new HttpError(404, 'Backup não encontrado');
  const file = path.join(config.backupDir, path.basename(b.filename));
  if (!fs.existsSync(file)) throw new HttpError(410, 'Arquivo de backup não encontrado no servidor.');
  return { b, file };
}

backupRouter.get('/:id/download', requireAuth('cfg.backup'), h(async (req, res) => {
  const { b, file } = await getFile(req.params.id);
  await audit(req, { action: 'download_backup', module: 'config', entity: 'backup', entityId: b.id, summary: `Download do backup ${b.filename}` });
  res.download(file, b.filename);
}));

backupRouter.post('/:id/verify', requireAuth('cfg.backup'), h(async (req, res) => {
  const { b, file } = await getFile(req.params.id);
  const ok = (await sha(file)) === b.sha256;
  await audit(req, { action: 'verificar_backup', module: 'config', entity: 'backup', entityId: b.id, summary: `Integridade do backup ${b.filename}: ${ok ? 'íntegro' : 'CORROMPIDO'}`, result: ok ? 'sucesso' : 'falha' });
  res.json({ ok });
}));

backupRouter.post('/:id/restore', requireAuth('cfg.backup'), h(async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
  if (confirm !== 'RESTAURAR') throw new HttpError(422, 'Digite RESTAURAR para confirmar.', { confirm: 'Digite RESTAURAR para confirmar' });
  const { b, file } = await getFile(req.params.id);
  if ((await sha(file)) !== b.sha256) throw new HttpError(409, 'O arquivo falhou na verificação de integridade (SHA-256). Restauração abortada.');
  const actor = { id: req.user!.id, name: req.user!.name };
  const pre = await runBackup(req, 'pre-restauracao'); // rede de segurança
  if (busy) throw new HttpError(409, 'Operação em andamento.');
  busy = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gentis-rst-'));
  try {
    await run(['tar', '-xzf', file, '-C', tmp]);
    await run(psqlArgv(), { stdin: fs.createReadStream(path.join(tmp, 'db.sql')) });
    if (fs.existsSync(path.join(tmp, 'uploads'))) fs.cpSync(path.join(tmp, 'uploads'), config.uploadDir, { recursive: true });
    // O banco restaurado substitui as tabelas de log: registra o que aconteceu no novo estado.
    for (const f of [{ f: pre.filename, size: pre.size, kind: 'pre-restauracao' }, { f: b.filename, size: b.size_bytes, kind: b.kind }]) {
      const hash = await sha(path.join(config.backupDir, f.f));
      await pool.query(`INSERT INTO backup_logs (filename, kind, status, size_bytes, sha256, user_name, restored_at)
                        SELECT $1,$2,'concluido',$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM backup_logs WHERE filename=$1)`,
        [f.f, f.kind, f.size, hash, actor.name, f.f === b.filename ? new Date() : null]);
    }
    await pool.query(`UPDATE backup_logs SET restored_at = now() WHERE filename = $1`, [b.filename]);
    await audit(null, { action: 'restaurar', module: 'config', entity: 'backup', summary: `Backup ${b.filename} restaurado por ${actor.name}. Backup de segurança: ${pre.filename}` }, pool, actor);
    res.json({ ok: true, safetyBackup: pre.filename, note: 'Todas as sessões foram encerradas. Faça login novamente.' });
  } catch (e) {
    await audit(req, { action: 'restaurar', module: 'config', entity: 'backup', entityId: b.id, summary: `Falha ao restaurar ${b.filename}`, result: 'falha', details: { erro: (e as Error).message } });
    throw new HttpError(500, `Falha na restauração: ${(e as Error).message}. Backup de segurança disponível: ${pre.filename}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    busy = false;
  }
}));
