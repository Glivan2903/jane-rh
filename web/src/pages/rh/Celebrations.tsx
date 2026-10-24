import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Cake, ChevronLeft, ChevronRight, PartyPopper } from 'lucide-react';
import { Badge, Empty, ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { useFetch } from '../../lib/hooks';
import { dmy } from '../../lib/format';

interface Person { id: string; name: string; department: string | null; day: number; isToday: boolean; turns?: number; years?: number; pending?: boolean }
interface Up { id: string; name: string; department: string | null; kind: 'aniversario' | 'tempo_de_casa'; date: string; number: number; daysLeft: number; pending?: boolean }
interface Data { month: number; year: number; today: string; birthdays: Person[]; workAnniversaries: Person[]; upcoming: Up[] }
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const when = (n: number) => (n === 0 ? 'hoje' : n === 1 ? 'amanhã' : `em ${n} dias`);
const milestone = (y: number) => y === 1 || y % 5 === 0;

function Day({ day, today }: { day: number; today?: boolean }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums ${today ? 'bg-accent text-white' : 'bg-primary/10 text-primary'}`}>{String(day).padStart(2, '0')}</span>;
}

export default function Celebrations() {
  const [month, setMonth] = useState<number | null>(null);
  const q = useFetch<Data>('/rh/celebrations', month ? { month } : undefined);
  const d = q.data; const m = month ?? d?.month ?? new Date().getMonth() + 1;
  // a data já passou? (compara dia/mês com hoje; meses passados do ano contam como passados)
  const todayM = d ? Number(d.today.slice(5, 7)) : 0; const todayD = d ? Number(d.today.slice(8, 10)) : 0;
  const past = (day: number) => !!d && (m < todayM || (m === todayM && day < todayD));
  const go = (delta: number) => setMonth(((m - 1 + delta + 12) % 12) + 1);
  const todays = d ? [...d.birthdays.filter((b) => b.isToday).map((b) => `${b.name} faz ${b.turns} anos`), ...d.workAnniversaries.filter((w) => w.isToday).map((w) => `${w.name} completa ${w.years} ano${w.years === 1 ? '' : 's'} de empresa`)] : [];

  return (
    <div>
      <PageHeader title="Aniversários e tempo de casa" subtitle="Aniversários dos funcionários (inclusive os aguardando admissão) e tempo de casa dos ativos." />
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !d ? <Skeleton className="h-64" /> : (
        <>
          {todays.length > 0 && (
            <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
              <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><div><b>Hoje:</b> {todays.join(' · ')}.</div>
            </div>)}
          <section className="card mb-4 p-5" aria-label="Próximos 30 dias">
            <h2 className="mb-3 font-display font-bold">Próximos 30 dias</h2>
            {d.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum aniversário ou tempo de casa nos próximos 30 dias.</p> : (
              <ul className="divide-y">
                {d.upcoming.map((u) => (
                  <li key={`${u.id}-${u.kind}`} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${u.kind === 'aniversario' ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary'}`}>{u.kind === 'aniversario' ? <Cake className="h-4 w-4" /> : <Award className="h-4 w-4" />}</span>
                    <div className="min-w-0 flex-1 basis-48">
                      <Link to={`/rh/funcionarios/${u.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{u.name}</Link>
                      <p className="truncate text-xs text-muted-foreground">{u.kind === 'aniversario' ? `Completa ${u.number} anos` : `${u.number} ano${u.number === 1 ? '' : 's'} de empresa`}{u.department ? ` · ${u.department}` : ''}{u.pending ? ' · aguardando admissão' : ''}</p>
                    </div>
                    <span className="text-sm tabular-nums text-muted-foreground">{dmy(u.date).slice(0, 5)}</span>
                    <Badge tone={u.daysLeft === 0 ? 'warning' : 'info'}>{when(u.daysLeft)}</Badge>
                  </li>))}
              </ul>)}
          </section>
          <div className="mb-3 flex items-center justify-center gap-2">
            <button className="btn-ghost btn-sm" onClick={() => go(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <h2 className="min-w-40 text-center font-display text-lg font-bold capitalize">{MONTHS[m - 1]}</h2>
            <button className="btn-ghost btn-sm" onClick={() => go(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
            {month && month !== new Date().getMonth() + 1 && <button className="btn-outline btn-sm" onClick={() => setMonth(null)}>Mês atual</button>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-5" aria-label="Aniversariantes do mês">
              <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><Cake className="h-4 w-4 text-accent" />Aniversariantes ({d.birthdays.length})</h3>
              {d.birthdays.length === 0 ? <Empty icon={Cake} title="Nenhum aniversariante neste mês" /> : (
                <ul className="space-y-2">{d.birthdays.map((b) => (
                  <li key={b.id} className="flex items-center gap-3"><Day day={b.day} today={b.isToday} />
                    <div className="min-w-0 flex-1"><Link to={`/rh/funcionarios/${b.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{b.name}</Link><p className="truncate text-xs text-muted-foreground">{b.isToday ? 'Faz' : past(b.day) ? 'Completou' : 'Completa'} {b.turns} anos{b.department ? ` · ${b.department}` : ''}</p></div>
                    {b.pending && <Badge tone="warning">Aguardando admissão</Badge>}{b.isToday && <Badge tone="warning">Hoje</Badge>}</li>))}</ul>)}
            </section>
            <section className="card p-5" aria-label="Tempo de casa no mês">
              <h3 className="mb-3 flex items-center gap-2 font-display font-bold"><Award className="h-4 w-4 text-primary" />Tempo de casa ({d.workAnniversaries.length})</h3>
              {d.workAnniversaries.length === 0 ? <Empty icon={Award} title="Nenhum aniversário de empresa neste mês" hint="Aparecem funcionários com 1 ano ou mais de casa." /> : (
                <ul className="space-y-2">{d.workAnniversaries.map((w) => (
                  <li key={w.id} className="flex items-center gap-3"><Day day={w.day} today={w.isToday} />
                    <div className="min-w-0 flex-1"><Link to={`/rh/funcionarios/${w.id}`} className="text-sm font-semibold hover:text-primary hover:underline">{w.name}</Link><p className="truncate text-xs text-muted-foreground">{past(w.day) && !w.isToday ? 'Completou' : 'Completa'} {w.years} ano{w.years === 1 ? '' : 's'} de empresa{w.department ? ` · ${w.department}` : ''}</p></div>
                    {w.isToday ? <Badge tone="warning">Hoje</Badge> : milestone(w.years ?? 0) && <Badge tone="success">{w.years} anos</Badge>}</li>))}</ul>)}
            </section>
          </div>
        </>)}
    </div>
  );
}
