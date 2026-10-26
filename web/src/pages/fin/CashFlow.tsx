import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, TrendingDown, Wallet } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBox, PageHeader, Skeleton, StatCard, Tabs } from '../../components/ui';
import { C, ChartCard } from '../../components/charts';
import { useFetch } from '../../lib/hooks';
import { brl, dmy } from '../../lib/format';
import type { Account } from './Accounts';

interface Flow {
  days: number; from: string; to: string; opening: number; closing: number; totalIn: number; totalOut: number; negative: boolean;
  lowest: { balance: number; date: string }; series: { date: string; in: number; out: number; balance: number }[];
  overdue: { receber: { total: number; qtd: number }; pagar: { total: number; qtd: number } };
}

const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1).replace('.', ',')} mil` : String(Math.round(v)));

export default function CashFlow() {
  const [days, setDays] = useState<'30' | '60' | '90'>('30');
  const [accountId, setAccountId] = useState('');
  const accs = useFetch<{ accounts: Account[] }>('/fin/accounts', { active: 'true' });
  const flow = useFetch<Flow>('/fin/cashflow', { days, accountId });
  const d = flow.data;
  const moves = (d?.series ?? []).filter((s) => s.in || s.out);

  return (
    <div>
      <PageHeader title="Fluxo de caixa projetado" subtitle="Saldo atual das contas + contas a receber e a pagar pelo vencimento. Contas já vencidas entram hoje." />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={days} onChange={setDays} tabs={[{ id: '30', label: '30 dias' }, { id: '60', label: '60 dias' }, { id: '90', label: '90 dias' }]} />
        <select aria-label="Conta" className="input max-w-64" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Todas as contas ativas</option>
          {(accs.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      {flow.error ? <ErrorBox message={flow.error} onRetry={flow.reload} /> : !d ? <Skeleton className="h-72 w-full" /> : (
        <>
          {d.negative && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>O saldo projetado fica <b>negativo</b>: menor valor de <b>{brl(d.lowest.balance)}</b> em {dmy(d.lowest.date)}. Reveja vencimentos ou antecipe recebimentos.</span>
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Saldo atual" value={d.opening} format={brl} icon={Wallet} tone={d.opening < 0 ? 'danger' : 'primary'} />
            <StatCard label="A receber no período" value={d.totalIn} format={brl} icon={ArrowUpCircle} tone="success" />
            <StatCard label="A pagar no período" value={d.totalOut} format={brl} icon={ArrowDownCircle} tone="warning" />
            <StatCard label={`Saldo em ${dmy(d.to)}`} value={d.closing} format={brl} icon={TrendingDown} tone={d.closing < 0 ? 'danger' : 'info'} />
          </div>
          {(d.overdue.pagar.qtd > 0 || d.overdue.receber.qtd > 0) && (
            <p className="mb-4 text-sm text-muted-foreground">
              Já vencidos e incluídos hoje: {d.overdue.pagar.qtd > 0 && <b className="text-foreground">{d.overdue.pagar.qtd} a pagar ({brl(d.overdue.pagar.total)})</b>}
              {d.overdue.pagar.qtd > 0 && d.overdue.receber.qtd > 0 && ' e '}{d.overdue.receber.qtd > 0 && <b className="text-foreground">{d.overdue.receber.qtd} a receber ({brl(d.overdue.receber.total)})</b>}.
              {' '}<Link to="/financeiro/despesas?status=vencida" className="text-primary underline">Ver vencidas</Link>
            </p>
          )}
          <ChartCard title="Saldo projetado" subtitle={`${dmy(d.from)} a ${dmy(d.to)}`} icon={Wallet}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.series} margin={{ left: -6, right: 10, top: 8 }}>
                <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.teal} stopOpacity={0.3} /><stop offset="100%" stopColor={C.teal} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 4" stroke="rgb(128 150 165 / .22)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(v: string) => dmy(v).slice(0, 5)} tick={{ fill: '#7a93a2', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fill: '#7a93a2', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={kfmt} width={52} />
                <Tooltip formatter={(v: number) => brl(v)} labelFormatter={(l: string) => dmy(l)} />
                <ReferenceLine y={0} stroke={C.red} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="balance" name="Saldo" stroke={C.teal} strokeWidth={2.5} fill="url(#cf)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="p-3 text-left font-display text-sm font-bold">Movimentos previstos por dia</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Data</th><th className="px-3 py-2 text-right">A receber</th><th className="px-3 py-2 text-right">A pagar</th><th className="px-3 py-2 text-right">Saldo no dia</th></tr></thead>
              <tbody>
                {moves.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Nenhum vencimento no período.</td></tr>}
                {moves.map((s) => (
                  <tr key={s.date} className="border-t">
                    <td className="px-3 py-2">{dmy(s.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success">{s.in ? brl(s.in) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-warning">{s.out ? brl(s.out) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${s.balance < 0 ? 'text-danger' : ''}`}>{brl(s.balance)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
