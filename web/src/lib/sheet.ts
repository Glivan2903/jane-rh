/** Leitura de planilhas no navegador (CSV e XLSX). Devolve linhas de texto; a validação fica no servidor. */
export interface Sheet { headers: string[]; rows: string[][] }

function decode(buf: ArrayBuffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
}

export async function readSheet(file: File): Promise<Sheet> {
  let all: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsx } = await import('read-excel-file');
    all = (await readXlsx(file)).map((r) => r.map((v) => (v == null ? '' : v instanceof Date ? v.toLocaleDateString('en-CA') : String(v))));
  } else if (/\.(csv|txt|tsv)$/i.test(file.name)) {
    all = parseCsv(decode(await file.arrayBuffer()));
  } else throw new Error('Use um arquivo .xlsx ou .csv.');
  all = all.filter((r) => r.some((c) => c.trim() !== ''));
  if (all.length < 2) throw new Error('A planilha precisa ter a linha de títulos e ao menos uma linha de dados.');
  return { headers: all[0].map((h) => h.trim()), rows: all.slice(1) };
}

export function downloadCsv(name: string, lines: string[][]) {
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const blob = new Blob(['﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
