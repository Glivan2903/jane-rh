import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, ChevronsUpDown, Inbox, Loader2, X, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export const Spinner = ({ className = 'h-4 w-4' }: { className?: string }) => <Loader2 className={`animate-spin ${className}`} aria-label="Carregando" />;

/** Entrada animada (GSAP) dos filhos diretos marcados com [data-reveal]; respeita prefers-reduced-motion. */
export function useReveal<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (!ref.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-reveal]', { y: 16, opacity: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out', clearProps: 'all' });
    }, ref);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** `back`: caminho de destino do botão Voltar (canto superior direito); `true` volta no histórico. */
export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: string; actions?: ReactNode; back?: string | boolean }) {
  const nav = useNavigate();
  return (
    <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {(actions || back) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {back && <button type="button" className="btn-outline" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}><ArrowLeft className="h-4 w-4" />Voltar</button>}
        </div>
      )}
    </div>
  );
}

const TONES = {
  success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger', warning: 'bg-warning/15 text-warning',
  info: 'bg-info/10 text-info', neutral: 'bg-muted text-muted-foreground', accent: 'bg-accent/20 text-accent',
} as const;
export type Tone = keyof typeof TONES;
export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>
);

export function Empty({ title, hint, action, icon: Icon = Inbox }: { title: string; hint?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="mb-3 rounded-full bg-muted p-4"><Icon className="h-7 w-7 text-muted-foreground" /></div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
    <span>{message}</span>{onRetry && <button className="btn-outline btn-sm" onClick={onRetry}>Tentar novamente</button>}
  </div>
);

export function Modal({ title, children, footer, onClose, size = 'md' }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.fromTo(ref.current, { y: 24, opacity: 0, scale: 0.98 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'power3.out' });
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[92vh] w-full ${w} flex-col rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button className="rounded-lg p-1.5 hover:bg-muted" onClick={onClose} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Número com contagem animada (GSAP). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const o = { v: last.current };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { if (ref.current) ref.current.textContent = format(value); last.current = value; return; }
    const tw = gsap.to(o, { v: value, duration: 0.9, ease: 'power2.out', onUpdate: () => { if (ref.current) ref.current.textContent = format(o.v); } });
    last.current = value;
    return () => { tw.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}

export function StatCard({ label, value, format, icon: Icon, tone = 'primary', hint, to }: {
  label: string; value: number; format: (n: number) => string; icon: LucideIcon; tone?: 'primary' | 'accent' | 'success' | 'danger' | 'warning' | 'info'; hint?: string; to?: string;
}) {
  const bg = { primary: 'bg-primary/10 text-primary', accent: 'bg-accent/20 text-accent', success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger', warning: 'bg-warning/15 text-warning', info: 'bg-info/10 text-info' }[tone];
  const body = (
    <div data-reveal className="card group flex items-start gap-3.5 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className={`rounded-xl p-2.5 ${bg}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-display text-xl font-bold tabular-nums"><CountUp value={value} format={format} /></p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export const Skeleton = ({ className = 'h-6 w-full' }: { className?: string }) => <div className={`skeleton ${className}`} />;

// ---------- Tabela ----------
export interface Col<T> { key: string; label: string; sort?: string; className?: string; render?: (r: T) => ReactNode }
export interface ListState { page: number; pageSize: number; sort: string; dir: 'asc' | 'desc'; total: number; setPage: (n: number) => void; setPageSize: (n: number) => void; toggleSort: (k: string) => void }

export function DataTable<T extends { id?: string | number }>({ cols, rows, loading, error, onRetry, list, empty, rowKey }: {
  cols: Col<T>[]; rows: T[]; loading: boolean; error?: string | null; onRetry?: () => void; list: ListState; empty: ReactNode; rowKey?: (r: T, i: number) => string | number;
}) {
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return (
    <div className="card overflow-hidden">
      {error ? <ErrorBox message={error} onRetry={onRetry} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b bg-muted/50">
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={`th ${c.className ?? ''}`} aria-sort={c.sort && list.sort === c.sort ? (list.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => list.toggleSort(c.sort!)}>
                        {c.label}
                        {list.sort === c.sort ? (list.dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && rows.length === 0
                ? Array.from({ length: 5 }, (_, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className="td"><Skeleton className="h-5 w-full" /></td>)}</tr>)
                : rows.map((r, i) => (
                  <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className={`transition hover:bg-muted/40 ${loading ? 'opacity-60' : ''}`}>
                    {cols.map((c) => <td key={c.key} className={`td ${c.className ?? ''}`}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}</td>)}
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && empty}
        </div>
      )}
      {!error && list.total > 0 && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">{list.total} registro(s) · página {list.page} de {pages}</span>
          <div className="flex items-center gap-2">
            <select aria-label="Itens por página" className="input !w-auto !py-1 text-xs" value={list.pageSize} onChange={(e) => list.setPageSize(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / pág.</option>)}
            </select>
            <button className="btn-outline btn-sm" disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button className="btn-outline btn-sm" disabled={list.page >= pages} onClick={() => list.setPage(list.page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string }[] }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${value === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>{t.label}</button>
      ))}
    </div>
  );
}

export function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
