export interface OfxLine { fitid: string; date: string; amount: number; memo: string }

const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim() : '';
};

/** Decodifica o arquivo: OFX brasileiro costuma vir em windows-1252 (CHARSET:1252). */
export function decodeOfx(buf: Buffer): string {
  const head = buf.subarray(0, 600).toString('latin1');
  if (/CHARSET:\s*1252|ENCODING:\s*USASCII/i.test(head) && !/ENCODING:\s*UTF-8/i.test(head)) return buf.toString('latin1');
  const utf = buf.toString('utf8');
  return utf.includes('�') ? buf.toString('latin1') : utf;
}

function parseAmount(raw: string): number {
  let s = raw.replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Math.round(n * 100) / 100;
}

/** Extrai as transações (STMTTRN) de um OFX 1.x (SGML) ou 2.x (XML). */
export function parseOfx(text: string): OfxLine[] {
  if (!/<OFX>/i.test(text) && !/<STMTTRN>/i.test(text)) throw new Error('Arquivo não parece ser um OFX válido.');
  const out: OfxLine[] = [];
  for (const chunk of text.split(/<STMTTRN>/i).slice(1)) {
    const block = chunk.split(/<\/STMTTRN>/i)[0];
    const dt = /^(\d{4})(\d{2})(\d{2})/.exec(tag(block, 'DTPOSTED'));
    const amount = parseAmount(tag(block, 'TRNAMT'));
    const fitid = tag(block, 'FITID');
    if (!dt || !fitid || !Number.isFinite(amount) || amount === 0) continue;
    out.push({ fitid: fitid.slice(0, 80), date: `${dt[1]}-${dt[2]}-${dt[3]}`, amount, memo: (tag(block, 'MEMO') || tag(block, 'NAME')).slice(0, 200) });
  }
  return out;
}
