import { todayIso } from './format';

export type Preset = 'hoje' | '7d' | 'mes' | 'mes_anterior' | 'ano' | 'custom';
export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' }, { id: '7d', label: 'Últimos 7 dias' }, { id: 'mes', label: 'Mês atual' },
  { id: 'mes_anterior', label: 'Mês anterior' }, { id: 'ano', label: 'Ano atual' }, { id: 'custom', label: 'Personalizado' },
];

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

export function presetRange(p: Preset): { from: string; to: string } {
  const t = todayIso(); const [y, m] = t.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (p) {
    case 'hoje': return { from: t, to: t };
    case '7d': return { from: addDays(t, -6), to: t };
    case 'mes_anterior': { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${last(py, pm)}` }; }
    case 'ano': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last(y, m)}` };
  }
}
