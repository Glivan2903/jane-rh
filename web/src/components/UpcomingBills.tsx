import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { Badge, Empty, ErrorBox, Skeleton } from './ui';
import { useFetch } from '../lib/hooks';
import { brl, dmy } from '../lib/format';

interface Upcoming { days: number; total: number; count: number; items: { id: string; type: string; description: string; party: string | null; category: string; amount: number; dueDate: string; daysLeft: number }[] }

const when = (d: number) => (d < 0 ? { text: `Vencida há ${-d} dia(s)`, tone: 'danger' as const } : d === 0 ? { text: 'Vence hoje', tone: 'warning' as const } : d <= 3 ? { text: `Em ${d} dia(s)`, tone: 'warning' as const } : { text: `Em ${d} dias`, tone: 'neutral' as const });

/** Próximas contas pendentes (padrão de antecedência definido em Configurações → Parâmetros). */
export function UpcomingBills() {
  const [type, setType] = useState<'despesa' | 'receita' | 'ambos'>('despesa');
  const [days, setDays] = useState('');
  const { data, loading, error, reload } = useFetch<Upcoming>('/fin/upcoming', { type, days: days || undefined });
  const link = type === 'receita' ? '/financeiro/receitas' : '/financeiro/despesas';
  return (
    <section data-reveal className="card p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold"><CalendarClock className="h-4 w-4 text-primary" />Próximas contas {type === 'receita' ? 'a receber' : type === 'ambos' ? 'a pagar e receber' : 'a pagar'}</h3>
        <div className="flex gap-1.5">
          <select aria-label="Tipo" className="input !w-auto !py-1 text-xs" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="despesa">A pagar</option><option value="receita">A receber</option><option value="ambos">Ambas</option>
          </select>
          <select aria-label="Antecedência" className="input !w-auto !py-1 text-xs" value={days || String(data?.days ?? '')} onChange={(e) => setDays(e.target.value)}>
            {[...new Set([data?.days ?? 7, 3, 7, 15, 30, 60])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n === 0 ? 'Hoje' : `${n} dias`}</option>)}
          </select>
        </div>
      </div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <Skeleton className="h-32" /> : !data || data.items.length === 0 ? (
        <Empty icon={CheckCircle2} title="Nenhuma conta no período" hint="Sem contas pendentes vencidas ou a vencer no intervalo escolhido." />
      ) : (
        <>
          <ul className="divide-y">
            {data.items.map((b) => {
              const w = when(b.daysLeft);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <div className="min-w-0 flex-1 basis-40"><p className="truncate font-medium">{b.description}</p><p className="truncate text-xs text-muted-foreground">{b.party || b.category} · {dmy(b.dueDate)}</p></div>
                  <Badge tone={w.tone}>{w.text}</Badge>
                  <span className={`w-24 text-right font-semibold tabular-nums ${b.type === 'receita' ? 'text-success' : ''}`}>{brl(b.amount)}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
            <span>{data.count} conta(s) · total <b className="text-foreground">{brl(data.total)}</b></span>
            <Link to={link} className="font-semibold text-primary hover:underline">Ver todas</Link>
          </div>
        </>
      )}
    </section>
  );
}
