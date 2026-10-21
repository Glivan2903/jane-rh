import { useState } from 'react';
import { AlertOctagon, ArrowDownCircle, ArrowUpCircle, CheckCircle2, Clock, HandCoins, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader, StatCard, useReveal, ErrorBox, Skeleton } from '../../components/ui';
import { PeriodPicker, type Period } from '../../components/PeriodPicker';
import { ChartCard, C, Donut, MoneyBars, MoneyLine } from '../../components/charts';
import { FilterSelect } from '../../components/forms';
import { useFetch } from '../../lib/hooks';
import { brl } from '../../lib/format';
import { presetRange } from '../../lib/period';

export interface FinSummary {
  receitas: { previsto: number; recebido: number; aReceber: number }; despesas: { previsto: number; pago: number; aPagar: number };
  saldoPrevisto: number; saldoRealizado: number; vencidas: { receber: number; pagar: number; qtd: number };
  monthly: { mes: string; recebido: number; pago: number; receitaPrevista: number; despesaPrevista: number; saldo: number; saldoAcumulado: number }[];
  despesasPorCategoria: { categoria: string; total: number }[]; receitasPorCategoria: { categoria: string; total: number }[];
}

export default function FinOverview() {
  const [p, setP] = useState<Period>(presetRange('mes'));
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch<FinSummary>('/fin/summary', { ...p, status });
  const ref = useReveal<HTMLDivElement>([!!data]);
  const fmt = brl;
  return (
    <div>
      <PageHeader title="Financeiro" subtitle="Resultado financeiro do período — não representa saldo bancário." actions={<PeriodPicker value={p} onChange={setP} />} />
      <div className="no-print mb-4 max-w-xs"><FilterSelect label="Situação" placeholder="Todas as situações" value={status} onChange={setStatus} options={[{ value: 'prevista', label: 'Previstas' }, { value: 'vencida', label: 'Vencidas' }, { value: 'recebida', label: 'Recebidas' }, { value: 'paga', label: 'Pagas' }]} /></div>
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div> : data && (
        <div ref={ref} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Receitas previstas (vencimento)" value={data.receitas.previsto} format={fmt} icon={TrendingUp} tone="success" />
            <StatCard label="Despesas previstas (vencimento)" value={data.despesas.previsto} format={fmt} icon={TrendingDown} tone="danger" />
            <StatCard label="Resultado previsto" value={data.saldoPrevisto} format={fmt} icon={Scale} tone={data.saldoPrevisto >= 0 ? 'primary' : 'danger'} hint="Receitas − despesas previstas" />
            <StatCard label="Resultado realizado" value={data.saldoRealizado} format={fmt} icon={HandCoins} tone={data.saldoRealizado >= 0 ? 'primary' : 'danger'} hint="Recebido − pago no período" />
            <StatCard label="Receitas recebidas" value={data.receitas.recebido} format={fmt} icon={CheckCircle2} tone="success" />
            <StatCard label="Despesas pagas" value={data.despesas.pago} format={fmt} icon={CheckCircle2} tone="info" />
            <StatCard label="A receber (pendentes)" value={data.receitas.aReceber} format={fmt} icon={ArrowDownCircle} tone="warning" to="/financeiro/receitas" />
            <StatCard label="A pagar (pendentes)" value={data.despesas.aPagar} format={fmt} icon={ArrowUpCircle} tone="warning" to="/financeiro/despesas" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Contas vencidas a pagar (total em atraso)" value={data.vencidas.pagar} format={fmt} icon={AlertOctagon} tone="danger" to="/financeiro/despesas?status=vencida" />
            <StatCard label="Contas vencidas a receber (total em atraso)" value={data.vencidas.receber} format={fmt} icon={Clock} tone="danger" to="/financeiro/receitas?status=vencida" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Receitas × despesas" subtitle="Valores realizados (data efetiva) por mês"><MoneyBars data={data.monthly} bars={[{ key: 'recebido', name: 'Recebido', color: C.teal }, { key: 'pago', name: 'Pago', color: C.coral }]} /></ChartCard>
            <ChartCard title="Evolução do resultado mensal" subtitle="Resultado do mês e acumulado no período"><MoneyLine data={data.monthly} lines={[{ key: 'saldo', name: 'Resultado do mês', color: C.coral }, { key: 'saldoAcumulado', name: 'Acumulado', color: C.teal }]} /></ChartCard>
            <ChartCard title="Despesas por categoria" subtitle="Por vencimento, exceto cancelados"><Donut data={data.despesasPorCategoria} nameKey="categoria" valueKey="total" money /></ChartCard>
            <ChartCard title="Receitas por categoria" subtitle="Por vencimento, exceto cancelados"><Donut data={data.receitasPorCategoria} nameKey="categoria" valueKey="total" money /></ChartCard>
          </div>
          <p className="text-xs text-muted-foreground">Previsto = lançamentos com vencimento no período. Realizado = baixas com data efetiva no período. Lançamentos cancelados não entram nos totais.</p>
        </div>
      )}
    </div>
  );
}
