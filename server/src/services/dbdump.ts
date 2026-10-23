import fs from 'node:fs';
import readline from 'node:readline';
import { once } from 'node:events';
import { pool } from '../db.js';

/*
 * Dump "nativo": gerado pela própria conexão do sistema, sem pg_dump no servidor.
 * Só DADOS do schema public, no mesmo formato COPY do pg_dump (a estrutura vem das migrações).
 */
export const NATIVE_MARK = '-- gentis-dump-nativo v2';
// schema_migrations descreve a estrutura atual; backup_files guarda os próprios backups.
const SKIP = new Set(['schema_migrations', 'backup_files']);
const id = (s: string) => `"${s.replace(/"/g, '""')}"`;
const BATCH = 500;

// Formato texto do COPY: \N = nulo; barra, tab e quebras de linha escapadas.
const copyEsc = (v: string | null) => (v == null ? '\\N' : v.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
const copyUnesc = (f: string) => (f === '\\N' ? null : f.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, e: string) => {
  if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
  if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
  return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' } as Record<string, string>)[e] ?? e;
}));

export async function nativeDump(file: string) {
  const c = await pool.connect();
  const out = fs.createWriteStream(file, { mode: 0o600 });
  const write = async (s: string) => { if (!out.write(s)) await once(out, 'drain'); };
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // retrato consistente do banco
    const tables: string[] = (await c.query(
      `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relispartition ORDER BY 1`)).rows.map((r) => r.t).filter((t) => !SKIP.has(t));
    await write(`${NATIVE_MARK}\n-- Gerado pelo Gentis em ${new Date().toISOString()} sem pg_dump. Somente dados do schema public.\n\n`);
    for (const t of tables) {
      const cols: string[] = (await c.query(
        `SELECT attname::text AS name FROM pg_attribute
          WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' ORDER BY attnum`, [`public.${id(t)}`])).rows.map((r) => r.name);
      await write(`COPY public.${id(t)} (${cols.map(id).join(', ')}) FROM stdin;\n`);
      await c.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT ${cols.map((col, i) => `${id(col)}::text AS c${i}`).join(', ')} FROM public.${id(t)}`);
      for (;;) {
        const rows = (await c.query({ text: `FETCH ${BATCH} FROM cur`, rowMode: 'array' })).rows as (string | null)[][];
        if (!rows.length) break;
        await write(rows.map((r) => r.map(copyEsc).join('\t')).join('\n') + '\n');
      }
      await c.query('CLOSE cur');
      await write('\\.\n\n');
    }
    const seqs = (await c.query(
      `SELECT format('SELECT pg_catalog.setval(%L, %s, %s);', quote_ident(schemaname) || '.' || quote_ident(sequencename),
              COALESCE(last_value, start_value), CASE WHEN last_value IS NULL THEN 'false' ELSE 'true' END) AS s
         FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`)).rows.map((r) => r.s);
    await write(seqs.join('\n') + '\n');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    out.end();
    await once(out, 'close').catch(() => {});
  }
}

export interface MergeResult { tabela: string; noBackup: number; adicionados: number; identicos: number; mantidos: number }

/*
 * Restauração por MESCLAGEM: nada do banco atual é apagado nem alterado.
 * Lê os blocos COPY do db.sql (dump nativo ou pg_dump) para tabelas temporárias e insere só as linhas
 * que ainda não existem. Linha com a mesma chave/valor único de uma existente é ignorada: se for idêntica,
 * conta como "idêntica"; se diferir, a versão atual é mantida. Linhas cujas referências (chaves estrangeiras)
 * não existem também ficam de fora. Tudo numa transação: em erro, nada muda.
 */
export async function mergeRestore(file: string): Promise<MergeResult[]> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const staged: { t: string; stg: string; cols: string[] }[] = [];
    const seqs: { name: string; value: string }[] = [];
    // Tabelas que nunca voltam de um backup: estrutura, os próprios backups e sessões de login antigas.
    const skip = new Set([...SKIP, 'sessions']);
    const current = new Map<string, Set<string>>();
    for (const r of (await c.query(
      `SELECT c.relname::text AS t, array_agg(a.attname::text) AS cols FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        WHERE n.nspname = 'public' AND c.relkind = 'r' GROUP BY c.relname`)).rows) current.set(r.t, new Set(r.cols));

    // 1) Carrega os dados do arquivo em tabelas temporárias.
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    let cur: { stg: string; keep: number[]; cols: string[] } | null = null; let ignore = false; let buf: (string | null)[][] = [];
    const flush = async () => {
      if (cur && buf.length && cur.cols.length) {
        const params: (string | null)[] = []; const tuples: string[] = [];
        for (const row of buf) { tuples.push(`(${cur.keep.map((_, j) => `$${params.length + j + 1}`).join(',')})`); for (const k of cur.keep) params.push(row[k] ?? null); }
        await c.query(`INSERT INTO ${cur.stg} (${cur.cols.map(id).join(', ')}) VALUES ${tuples.join(',')}`, params);
      }
      buf = [];
    };
    for await (const line of rl) {
      if (cur || ignore) {
        if (line === '\\.') { await flush(); cur = null; ignore = false; continue; }
        if (ignore) continue;
        buf.push(line.split('\t').map(copyUnesc));
        if (buf.length * Math.max(1, cur!.cols.length) >= 30000) await flush();
        continue;
      }
      const m = line.match(/^COPY (?:public\.)?("(?:[^"]|"")+"|[\w$]+) \((.*)\) FROM stdin;$/);
      if (m) {
        const t = m[1].startsWith('"') ? m[1].slice(1, -1).replace(/""/g, '"') : m[1];
        const have = current.get(t);
        if (!have || skip.has(t)) { ignore = true; continue; }
        const fileCols = m[2].match(/"(?:[^"]|"")+"|[^, ]+/g)!.map((s) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s));
        // Colunas que não existem mais na estrutura atual são descartadas.
        const keep = fileCols.map((col, i) => (have.has(col) ? i : -1)).filter((i) => i >= 0);
        const cols = keep.map((i) => fileCols[i]);
        const name = id(`rst_${staged.length}`);
        await c.query(`CREATE TEMP TABLE ${name} ON COMMIT DROP AS SELECT ${cols.map(id).join(', ')} FROM public.${id(t)} WITH NO DATA`);
        staged.push({ t, stg: `pg_temp.${name}`, cols });
        cur = { stg: `pg_temp.${name}`, keep, cols };
        continue;
      }
      const s = line.match(/^SELECT pg_catalog\.setval\('([^']+)', (\d+), true\);$/);
      if (s) seqs.push({ name: s[1], value: s[2] });
    }

    // 2) Insere o que falta, respeitando chaves estrangeiras (repete até estabilizar, para dependências entre linhas).
    const fks: { child: string; parent: string; cols: string[]; pcols: string[] }[] = (await c.query(
      `SELECT cl.relname::text AS child, pr.relname::text AS parent,
              array_agg(ca.attname::text ORDER BY k.i) AS cols, array_agg(pa.attname::text ORDER BY k.i) AS pcols
         FROM pg_constraint co CROSS JOIN LATERAL unnest(co.conkey, co.confkey) WITH ORDINALITY AS k(c, p, i)
         JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_class pr ON pr.oid = co.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
         JOIN pg_attribute ca ON ca.attrelid = co.conrelid AND ca.attnum = k.c JOIN pg_attribute pa ON pa.attrelid = co.confrelid AND pa.attnum = k.p
        WHERE co.contype = 'f' AND n.nspname = 'public' GROUP BY co.oid, cl.relname, pr.relname`)).rows;
    const identity = new Set((await c.query(
      `SELECT c.relname::text AS t FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND a.attidentity = 'a'`)).rows.map((r) => r.t));
    const result = new Map<string, MergeResult>();
    // Idêntica = já existe uma linha com exatamente os mesmos valores.
    const same = (s: typeof staged[number]) => `EXISTS (SELECT 1 FROM public.${id(s.t)} p WHERE ${
      s.cols.map((col) => `p.${id(col)}::text IS NOT DISTINCT FROM s.${id(col)}::text`).join(' AND ') || 'true'})`;
    for (const s of staged) {
      const r = result.get(s.t) ?? { tabela: s.t, noBackup: 0, adicionados: 0, identicos: 0, mantidos: 0 };
      const n = (await c.query(`SELECT count(*) AS n, count(*) FILTER (WHERE ${same(s)}) AS i FROM ${s.stg} s`)).rows[0];
      r.noBackup += Number(n.n); r.identicos += Number(n.i);
      result.set(s.t, r);
    }
    const tables = [...new Set(staged.map((s) => s.t))];
    // Os triggers só validam/impedem alterações; os dados do backup já passaram por eles quando foram gravados.
    for (const t of tables) await c.query(`ALTER TABLE public.${id(t)} DISABLE TRIGGER USER`);
    for (let progress = true; progress;) {
      progress = false;
      for (const s of staged) {
        const checks = [`NOT ${same(s)}`, ...fks.filter((f) => f.child === s.t && f.cols.every((col) => s.cols.includes(col))).map((f) =>
          `(${f.cols.map((col) => `s.${id(col)} IS NULL`).join(' OR ')} OR EXISTS (SELECT 1 FROM public.${id(f.parent)} p WHERE ${
            f.pcols.map((pc, i) => `p.${id(pc)} = s.${id(f.cols[i])}`).join(' AND ')}))`)];
        const ins = await c.query(`INSERT INTO public.${id(s.t)} (${s.cols.map(id).join(', ')})${identity.has(s.t) ? ' OVERRIDING SYSTEM VALUE' : ''}
          SELECT ${s.cols.map((col) => `s.${id(col)}`).join(', ')} FROM ${s.stg} s WHERE ${checks.join(' AND ')} ON CONFLICT DO NOTHING`);
        if (ins.rowCount) { progress = true; result.get(s.t)!.adicionados += ins.rowCount; }
      }
    }
    for (const t of tables) await c.query(`ALTER TABLE public.${id(t)} ENABLE TRIGGER USER`);
    for (const r of result.values()) r.mantidos = r.noBackup - r.adicionados - r.identicos;

    // 3) Sequências nunca voltam para trás (evita colisão de códigos/IDs novos).
    for (const s of seqs) {
      await c.query(
        `SELECT setval(q.seq, GREATEST($2::bigint, COALESCE(q.last_value, 0)))
           FROM (SELECT (quote_ident(schemaname) || '.' || quote_ident(sequencename))::regclass AS seq, last_value FROM pg_sequences) q
          WHERE q.seq = to_regclass($1)`, [s.name, s.value]);
    }
    await c.query('COMMIT');
    return [...result.values()].filter((r) => r.noBackup > 0);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
