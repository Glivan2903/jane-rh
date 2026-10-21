import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, type LucideIcon } from 'lucide-react';
import { brl, monthLabel, num } from '../lib/format';
import { Empty } from './ui';

export const C = { teal: '#0d9488', tealLight: '#2dd4bf', coral: '#ff7a59', navy: '#1e4e6e', amber: '#d99a0b', sky: '#3b82f6', violet: '#8b5cf6', green: '#16a34a', red: '#dc2626' };
export const PALETTE = [C.teal, C.coral, C.navy, C.amber, C.sky, C.violet, C.green, '#e11d8f', '#64748b', '#0ea5e9'];
const axis = { fill: '#7a93a2', fontSize: 11 };
const grid = 'rgb(128 150 165 / .22)';
const cut = (s: unknown, n = 16) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function ChartCard({ title, subtitle, icon: Icon = BarChart3, children, className = '' }: { title: string; subtitle?: string; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section data-reveal className={`card p-4 ${className}`}>
      <div className="flex items-start gap-2.5">
        <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0"><h3 className="font-display text-sm font-bold leading-tight">{title}</h3>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
      </div>
      <div className="mt-3 h-64">{children}</div>
    </section>
  );
}
const NoData = () => <Empty icon={BarChart3} title="Sem dados no período" hint="Os gráficos aparecem assim que houver registros." />;

/** Tooltip no padrão visual do Jet-One: cartão com título em caixa-alta e valores em destaque. */
interface TipProps { active?: boolean; payload?: { name: string; value: number; color?: string; payload: Record<string, unknown> }[]; label?: string; money?: boolean; total?: number }
function Tip({ active, payload, label, money, total }: TipProps) {
  if (!active || !payload?.length) return null;
  const f = (v: number) => (money ? brl(v) : num(v, 2));
  return (
    <div className="min-w-[150px] rounded-xl border bg-card p-3 text-card-foreground shadow-lg">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">{label ?? String(payload[0].payload.name ?? payload[0].name)}</p>
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: p.color ?? PALETTE[i] }} />{p.name}</span>
            <b className="tabular-nums text-foreground">{f(p.value)}</b>
          </div>
        ))}
        {total ? <p className="border-t pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{((payload[0].value / total) * 100).toFixed(1).replace('.', ',')}% do total</p> : null}
      </div>
    </div>
  );
}

const legend = { iconType: 'circle' as const, iconSize: 8, wrapperStyle: { fontSize: 12, paddingTop: 6 } };
const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1).replace('.', ',')}k` : String(v));
// Recharts só renderiza <defs> como filho direto do gráfico (não dentro de componentes): por isso é uma função, não um componente.
const defsEl = (items: { id: string; color: string }[]) => (
  <defs>{items.map((i) => (
    <linearGradient key={i.id} id={i.id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={i.color} stopOpacity={1} /><stop offset="100%" stopColor={i.color} stopOpacity={0.55} /></linearGradient>
  ))}</defs>
);
const empty = (data: Record<string, unknown>[], keys: string[]) => !data.length || data.every((d) => keys.every((k) => !Number(d[k])));

export function MoneyBars({ data, bars }: { data: Record<string, unknown>[]; bars: { key: string; name: string; color: string }[] }) {
  if (empty(data, bars.map((b) => b.key))) return <NoData />;
  const rows = data.map((d) => ({ ...d, label: monthLabel(String(d.mes)) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ left: -6, right: 4, top: 8 }} barGap={4} barCategoryGap="22%">
        {defsEl(bars.map((b) => ({ id: `g-${b.key}`, color: b.color })))}
        <CartesianGrid strokeDasharray="3 4" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={44} />
        <Tooltip content={<Tip money />} cursor={{ fill: 'rgb(128 150 165 / .1)' }} />
        <Legend {...legend} />
        {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={`url(#g-${b.key})`} radius={[8, 8, 2, 2]} maxBarSize={30} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MoneyLine({ data, lines }: { data: Record<string, unknown>[]; lines: { key: string; name: string; color: string }[] }) {
  if (!data.length) return <NoData />;
  const rows = data.map((d) => ({ ...d, label: monthLabel(String(d.mes)) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ left: -6, right: 10, top: 8 }}>
        <defs>{lines.map((l) => <linearGradient key={l.key} id={`a-${l.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={l.color} stopOpacity={0.28} /><stop offset="100%" stopColor={l.color} stopOpacity={0} /></linearGradient>)}</defs>
        <CartesianGrid strokeDasharray="3 4" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={44} />
        <Tooltip content={<Tip money />} />
        <Legend {...legend} />
        {lines.map((l) => <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2.5} fill={`url(#a-${l.key})`} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />)}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CountBars({ data, bars, xKey = 'mes' }: { data: Record<string, unknown>[]; bars: { key: string; name: string; color: string }[]; xKey?: string }) {
  if (empty(data, bars.map((b) => b.key))) return <NoData />;
  const rows = data.map((d) => ({ ...d, label: xKey === 'mes' ? monthLabel(String(d.mes)) : d[xKey] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ left: -22, right: 4, top: 8 }} barGap={2} barCategoryGap="18%">
        {defsEl(bars.map((b) => ({ id: `c-${b.key}`, color: b.color })))}
        <CartesianGrid strokeDasharray="3 4" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgb(128 150 165 / .1)' }} />
        <Legend {...legend} />
        {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={`url(#c-${b.key})`} radius={[6, 6, 2, 2]} maxBarSize={14} minPointSize={2} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey, money }: { data: Record<string, unknown>[]; nameKey: string; valueKey: string; money?: boolean }) {
  const rows = data.filter((d) => Number(d[valueKey]) > 0).map((d) => ({ ...d, name: String(d[nameKey]), value: Number(d[valueKey]) }));
  if (!rows.length) return <NoData />;
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="90%" paddingAngle={rows.length > 1 ? 3 : 0} cornerRadius={5} stroke="none">
              {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<Tip money={money} total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total</span>
          <span className="font-display text-lg font-bold tabular-nums">{money ? brl(total) : num(total, 0)}</span>
        </div>
      </div>
      <ul className="mt-2 flex max-h-14 flex-wrap justify-center gap-x-3 gap-y-1 overflow-hidden text-[11px]">
        {rows.slice(0, 8).map((r, i) => <li key={i} className="flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{cut(r.name, 18)}</li>)}
      </ul>
    </div>
  );
}

export function HBars({ data, nameKey, valueKey, color = C.teal, money }: { data: Record<string, unknown>[]; nameKey: string; valueKey: string; color?: string; money?: boolean }) {
  if (!data.length) return <NoData />;
  const rows = data.slice(0, 8).map((d) => ({ ...d, name: String(d[nameKey]), value: Number(d[valueKey]) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 20, top: 4 }} barCategoryGap="28%">
        {defsEl([{ id: 'hb', color }])}
        <CartesianGrid strokeDasharray="3 4" stroke={grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={104} tickFormatter={(v) => cut(v, 15)} />
        <Tooltip content={<Tip money={money} />} cursor={{ fill: 'rgb(128 150 165 / .1)' }} />
        <Bar dataKey="value" name={valueKey === 'movimentos' ? 'Movimentações' : 'Total'} fill="url(#hb)" radius={[2, 8, 8, 2]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
