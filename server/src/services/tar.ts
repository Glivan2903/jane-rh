import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';

/*
 * .tar.gz em Node puro (formato ustar), para não depender do binário `tar` no servidor.
 * O leitor também entende os arquivos gerados pelo GNU tar (nomes longos via ././@LongLink e cabeçalhos pax).
 */

function header(name: string, size: number, type: '0' | '5') {
  const h = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Nome de arquivo longo demais para o backup: ${name}`);
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
  }
  const put = (s: string, off: number, len: number) => h.write(s, off, len, 'utf8');
  const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(type === '5' ? 0o755 : 0o600, 8), 100, 8);
  put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(Math.floor(Date.now() / 1000), 12), 136, 12);
  h.fill(' ', 148, 156);
  put(type, 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

/** Cria `file` (.tar.gz) com os arquivos/pastas de `baseDir` listados em `entries` (recursivo). */
export async function createTarGz(file: string, baseDir: string, entries: string[]) {
  const gz = zlib.createGzip();
  const out = fs.createWriteStream(file, { mode: 0o600 });
  gz.pipe(out);
  const write = async (b: Buffer) => { if (!gz.write(b)) await once(gz, 'drain'); };
  const add = async (rel: string) => {
    const abs = path.join(baseDir, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      await write(header(rel.replace(/\/?$/, '/'), 0, '5'));
      for (const c of fs.readdirSync(abs).sort()) await add(path.posix.join(rel, c));
      return;
    }
    if (!st.isFile()) return;
    await write(header(rel, st.size, '0'));
    for await (const chunk of fs.createReadStream(abs)) await write(chunk as Buffer);
    if (st.size % 512) await write(Buffer.alloc(512 - (st.size % 512)));
  };
  for (const e of entries) await add(e);
  gz.end(Buffer.alloc(1024));
  await once(out, 'close');
}

/** Extrai um .tar.gz para `destDir` (só arquivos e pastas; ignora caminhos fora do destino). */
export function extractTarGz(file: string, destDir: string) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const str = (b: Buffer) => b.toString('utf8').replace(/\0.*$/s, '');
  let off = 0; let longName: string | null = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(data); continue; }
    if (type === 'x') { const m = data.toString('utf8').match(/^\d+ path=(.*)$/m); if (m) longName = m[1]; continue; }
    const prefix = str(h.subarray(257, 263)).startsWith('ustar') ? str(h.subarray(345, 500)) : '';
    const name = longName ?? (prefix ? `${prefix}/` : '') + str(h.subarray(0, 100));
    longName = null;
    const target = path.resolve(destDir, name);
    if (!target.startsWith(path.resolve(destDir) + path.sep)) continue;
    if (type === '5') fs.mkdirSync(target, { recursive: true });
    else if (type === '0' || type === '7') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { mode: 0o600 });
    }
  }
}
