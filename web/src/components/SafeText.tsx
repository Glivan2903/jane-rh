import type { ReactNode } from 'react';

/**
 * Desenha a resposta da IA como TEXTO: negrito (**x**), itálico (*x*), listas e quebras de linha.
 * Nunca interpreta HTML, links nem imagens (defesa contra exfiltração por conteúdo injetado).
 */
function inline(s: string, k: string): ReactNode[] {
  const out: ReactNode[] = []; const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] ? <strong key={`${k}-${i++}`}>{m[1]}</strong> : <em key={`${k}-${i++}`}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function SafeText({ text, lead = false }: { text: string; lead?: boolean }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = []; let list: string[] = []; let leadUsed = !lead;
  const flush = (k: number) => { if (list.length) { blocks.push(<ul key={`l${k}`} className="my-1 list-disc space-y-0.5 pl-5">{list.map((x, j) => <li key={j}>{inline(x, `${k}-${j}`)}</li>)}</ul>); list = []; } };
  lines.forEach((ln, idx) => {
    const b = /^\s*[*\-•]\s+(.*)$/.exec(ln);
    if (b) { list.push(b[1]); return; }
    flush(idx);
    if (ln.trim()) {
      const isLead = !leadUsed; leadUsed = true;     // a primeira frase é a resposta: maior e mais forte
      blocks.push(<p key={`p${idx}`} className={isLead ? 'mb-2 text-[17px] font-semibold leading-snug text-foreground' : 'my-1'}>{inline(ln.replace(/^#{1,6}\s+/, ''), `p${idx}`)}</p>);
    }
  });
  flush(lines.length);
  return <div className="text-sm leading-relaxed [overflow-wrap:anywhere]">{blocks}</div>;
}
