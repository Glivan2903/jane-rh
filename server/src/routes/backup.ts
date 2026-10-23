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
import { createTarGz, extractTarGz } from '../services/tar.js';
import { mergeRestore, nativeDump } from '../services/dbdump.js';
import type { Request } from 'express';

export const backupRouter = Router();

/*
 * Backup = arquivo .tar.gz com `db.sql` + pasta `uploads/` (anexos).
 * O `db.sql` vem do pg_dump (PG_DUMP_CMD ou `pg_dump` no PATH) quando disponível; se não houver pg_dump
 * ou ele falhar (ex.: versão incompatível), o sistema gera o dump pela própria conexão (services/dbdump.ts).
 * O arquivo fica em BACKUP_DIR; sem disco gravável/persistente (Vercel ou BACKUP_STORAGE=db), fica na tabela backup_files.
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
      // Só termina depois que o arquivo de saída foi gravado por inteiro.
      if (code === 0) opts.stdout && !opts.stdout.closed ? opts.stdout.once('close', () => resolve(err)) : resolve(err);
      else reject(new Error(`${argv[0]} terminou com código ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

const dumpArgv = () => [...(config.pgDumpCmd ? splitCmd(config.pgDumpCmd) : ['pg_dump', '--dbname', config.databaseUrl]),
  '--no-owner', '--no-privileges', '--clean', '--if-exists', '--schema=public', '--exclude-table-data=public.backup_files'];
const hasBin = (bin: string) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, bin)));

/**
 * Gera o db.sql: pg_dump se houver; senão (ou se falhar) o dump nativo. Retorna o método usado e o motivo do fallback.
 * Com armazenamento no banco usa sempre o nativo: a restauração de um pg_dump (--clean) recriaria o schema e apagaria backup_files.
 */
async function dumpDb(out: string, where: 'disco' | 'banco'): Promise<{ method: 'pg_dump' | 'nativo'; aviso?: string }> {
  let aviso: string | undefined;
  if (where === 'disco' && (config.pgDumpCmd || hasBin('pg_dump'))) {
    try {
      await run(dumpArgv(), { stdout: fs.createWriteStream(out, { mode: 0o600 }) });
      if (fs.statSync(out).size < 100) throw new Error('pg_dump gerou arquivo vazio.');
      return { method: 'pg_dump' };
    } catch (e) {
      aviso = (e as Error).message;
      console.warn('[backup] pg_dump falhou, usando dump nativo:', aviso);
    }
  }
  await nativeDump(out);
  return { method: 'nativo', aviso };
}

const dbStorage = () => !!process.env.VERCEL || process.env.BACKUP_STORAGE === 'db';

/** Onde guardar: BACKUP_DIR; se o disco não for gravável (ou for efêmero), no banco. */
function storageFor(): 'disco' | 'banco' {
  if (dbStorage()) return 'banco';
  try {
    fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
    fs.accessSync(config.backupDir, fs.constants.W_OK);
    return 'disco';
  } catch (e) {
    console.warn(`[backup] sem acesso de escrita a ${config.backupDir}, guardando no banco:`, (e as Error).message);
    return 'banco';
  }
}

async function store(src: string, filename: string, where: 'disco' | 'banco') {
  if (where === 'disco') {
    fs.copyFileSync(src, path.join(config.backupDir, filename));
    fs.chmodSync(path.join(config.backupDir, filename), 0o600);
  } else await pool.query(`INSERT INTO backup_files (filename, data) VALUES ($1, $2)`, [filename, fs.readFileSync(src)]);
}

async function discard(filename: string) {
  fs.rmSync(path.join(config.backupDir, filename), { force: true });
  await pool.query(`DELETE FROM backup_files WHERE filename = $1`, [filename]);
}

const sha = (file: string) => new Promise<string>((resolve, reject) => {
  const hs = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => hs.update(d)).on('end', () => resolve(hs.digest('hex'))).on('error', reject);
});

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

export async function runBackup(req: Request | null, kind: 'manual' | 'automatico' | 'pre-restauracao') {
  if (busy) throw new HttpError(409, 'Outra operação de backup/restauração está em andamento.');
  busy = true;
  const filename = `gentis-${kind}-${stamp()}.tar.gz`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gentis-bkp-'));
  const file = path.join(tmp, filename);
  const userName = req?.user?.name ?? 'sistema';
  let stored = false;
  try {
    const where = storageFor();
    const dump = await dumpDb(path.join(tmp, 'db.sql'), where);
    fs.mkdirSync(path.join(tmp, 'uploads'));
    if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(tmp, 'uploads'), { recursive: true });
    await createTarGz(file, tmp, ['db.sql', 'uploads']);
    const size = fs.statSync(file).size;
    const hash = await sha(file);
    await store(file, filename, where); stored = true;
    const r = await pool.query(`INSERT INTO backup_logs (filename, kind, status, size_bytes, sha256, user_name) VALUES ($1,$2,'concluido',$3,$4,$5) RETURNING id`,
      [filename, kind, size, hash, userName]);
    await audit(req, { action: 'backup', module: 'config', entity: 'backup', entityId: r.rows[0].id, summary: `Backup ${kind} concluído (${filename})`,
      details: { metodo: dump.method, armazenamento: where, ...(dump.aviso ? { aviso_pg_dump: dump.aviso } : {}) } });
    return { id: r.rows[0].id as number, filename, size, sha256: hash, method: dump.method, storage: where };
  } catch (e) {
    if (stored) await discard(filename).catch(() => {});
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
        await discard(o.filename);
        await pool.query(`UPDATE backup_logs SET status='removido' WHERE id=$1`, [o.id]);
      }
    } catch (e) { console.error('[backup automático]', (e as Error).message); }
  }, hours * 3600_000).unref();
}

backupRouter.get('/', requireAuth('cfg.backup'), h(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT id, filename, kind, status, size_bytes AS "sizeBytes", error, user_name AS "userName", created_at AS "createdAt", restored_at AS "restoredAt"
       FROM backup_logs ORDER BY created_at DESC LIMIT 200`)).rows;
  res.json({ rows, info: { dir: dbStorage() ? null : config.backupDir, autoHours: Number(process.env.BACKUP_AUTO_HOURS ?? 0) } });
}));

backupRouter.post('/', requireAuth('cfg.backup'), h(async (req, res) => {
  res.status(201).json(await runBackup(req, 'manual'));
}));

/** Localiza o arquivo do backup (disco ou banco). Se veio do banco, `tmp` é a pasta temporária a remover depois. */
async function getFile(id: string) {
  const b = (await pool.query(`SELECT * FROM backup_logs WHERE id=$1 AND status='concluido'`, [id])).rows[0];
  if (!b) throw new HttpError(404, 'Backup não encontrado');
  const name = path.basename(b.filename);
  const onDisk = path.join(config.backupDir, name);
  if (fs.existsSync(onDisk)) return { b, file: onDisk, tmp: null as string | null };
  const row = (await pool.query(`SELECT data FROM backup_files WHERE filename=$1`, [name])).rows[0];
  if (!row) throw new HttpError(410, 'Arquivo de backup não encontrado no servidor.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gentis-get-'));
  fs.writeFileSync(path.join(tmp, name), row.data, { mode: 0o600 });
  return { b, file: path.join(tmp, name), tmp };
}
const dropTmp = (tmp: string | null) => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); };

backupRouter.get('/:id/download', requireAuth('cfg.backup'), h(async (req, res) => {
  const { b, file, tmp } = await getFile(req.params.id);
  await audit(req, { action: 'download_backup', module: 'config', entity: 'backup', entityId: b.id, summary: `Download do backup ${b.filename}` });
  res.download(file, b.filename, () => dropTmp(tmp));
}));

backupRouter.post('/:id/verify', requireAuth('cfg.backup'), h(async (req, res) => {
  const { b, file, tmp } = await getFile(req.params.id);
  const ok = await sha(file).finally(() => dropTmp(tmp)) === b.sha256;
  await audit(req, { action: 'verificar_backup', module: 'config', entity: 'backup', entityId: b.id, summary: `Integridade do backup ${b.filename}: ${ok ? 'íntegro' : 'CORROMPIDO'}`, result: ok ? 'sucesso' : 'falha' });
  res.json({ ok });
}));

backupRouter.post('/:id/restore', requireAuth('cfg.backup'), h(async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
  if (confirm !== 'RESTAURAR') throw new HttpError(422, 'Digite RESTAURAR para confirmar.', { confirm: 'Digite RESTAURAR para confirmar' });
  const { b, file, tmp: fileTmp } = await getFile(req.params.id);
  if ((await sha(file)) !== b.sha256) { dropTmp(fileTmp); throw new HttpError(409, 'O arquivo falhou na verificação de integridade (SHA-256). Restauração abortada.'); }
  const actor = { id: req.user!.id, name: req.user!.name };
  const pre = await runBackup(req, 'pre-restauracao').catch((e) => { dropTmp(fileTmp); throw e; }); // rede de segurança
  if (busy) { dropTmp(fileTmp); throw new HttpError(409, 'Operação em andamento.'); }
  busy = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gentis-rst-'));
  try {
    extractTarGz(file, tmp);
    const sqlFile = path.join(tmp, 'db.sql');
    if (!fs.existsSync(sqlFile)) throw new Error('o arquivo não contém db.sql.');
    const tabelas = await mergeRestore(sqlFile);
    // Anexos: só entram os que não existem; nenhum arquivo atual é sobrescrito.
    const up = path.join(tmp, 'uploads');
    if (fs.existsSync(up) && fs.readdirSync(up).length) {
      try { fs.mkdirSync(config.uploadDir, { recursive: true }); fs.cpSync(up, config.uploadDir, { recursive: true, force: false, errorOnExist: false }); }
      catch (e) { console.warn('[restauração] anexos não copiados:', (e as Error).message); }
    }
    const total = (k: 'adicionados' | 'identicos' | 'mantidos') => tabelas.reduce((a, r) => a + r[k], 0);
    const resumo = { adicionados: total('adicionados'), identicos: total('identicos'), mantidos: total('mantidos') };
    // Garante que os dois arquivos aparecem no histórico (o backup restaurado pode vir de outro banco).
    for (const f of [{ f: pre.filename, size: pre.size, kind: 'pre-restauracao', hash: pre.sha256 }, { f: b.filename, size: b.size_bytes, kind: b.kind, hash: b.sha256 }]) {
      const hash = f.hash;
      await pool.query(`INSERT INTO backup_logs (filename, kind, status, size_bytes, sha256, user_name, restored_at)
                        SELECT $1,$2,'concluido',$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM backup_logs WHERE filename=$1)`,
        [f.f, f.kind, f.size, hash, actor.name, f.f === b.filename ? new Date() : null]);
    }
    await pool.query(`UPDATE backup_logs SET restored_at = now() WHERE filename = $1`, [b.filename]);
    await audit(null, { action: 'restaurar', module: 'config', entity: 'backup', summary: `Backup ${b.filename} restaurado (mesclagem) por ${actor.name}: ${resumo.adicionados} registros adicionados, ${resumo.identicos} já existiam idênticos, ${resumo.mantidos} mantidos como estavam. Backup de segurança: ${pre.filename}`,
      details: { ...resumo, tabelas } }, pool, actor);
    res.json({ ok: true, safetyBackup: pre.filename, ...resumo, tabelas });
  } catch (e) {
    await audit(req, { action: 'restaurar', module: 'config', entity: 'backup', entityId: b.id, summary: `Falha ao restaurar ${b.filename}`, result: 'falha', details: { erro: (e as Error).message } });
    throw new HttpError(500, `Falha na restauração: ${(e as Error).message}. Backup de segurança disponível: ${pre.filename}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    dropTmp(fileTmp);
    busy = false;
  }
}));
