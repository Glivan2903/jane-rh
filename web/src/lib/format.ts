const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v: unknown) => brlFmt.format(Number(v ?? 0));
export const num = (v: unknown, max = 3) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: max });

/** 'YYYY-MM-DD' (ou ISO) → 'DD/MM/AAAA' sem passar por fuso. */
export const dmy = (s?: string | null) => {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
export const dmyTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : '—';

export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+m - 1]}/${y.slice(2)}`; };

export const onlyDigits = (s: string) => s.replace(/\D/g, '');
export const maskCpf = (v: string) => onlyDigits(v).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
export const fmtCpf = (v?: string | null) => (v ? maskCpf(v) : '—');
export const maskPhone = (v: string) => {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};
export const maskCep = (v: string) => onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

export function validCpf(raw: string) {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/** Mês atual/anterior etc. em ISO — usado em filtros de relatório. */
export const monthStart = () => todayIso().slice(0, 8) + '01';

export const maskCnpj = (v: string) => onlyDigits(v).slice(0, 14)
  .replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
export const fmtCnpj = (v?: string | null) => (v ? maskCnpj(v) : '');
export function validCnpj(raw: string) {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, wi, i) => a + Number(c[i]) * wi, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
