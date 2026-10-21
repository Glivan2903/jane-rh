import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CheckCircle2, Clock, DollarSign, PackageX, Scale, TrendingDown, TrendingUp, UserMinus, UserPlus, Users, Wallet, Activity } from 'lucide-react';
import { ErrorBox, PageHeader, Skeleton, StatCard, Badge, useReveal, Empty } from '../components/ui';
import { PeriodPicker, type Period } from '../components/PeriodPicker';
import { ChartCard, C, CountBars, Donut, HBars, MoneyBars, MoneyLine } from '../components/charts';
import { useAuth } from '../lib/app';
import { useFetch } from '../lib/hooks';
import { brl, dmyTime, num } from '../lib/format';
import { presetRange } from '../lib/period';
import type { FinSummary } from './fin/Overview';

interface Dash {
  rh?: { ativos: number; total: number; desligadosTotal: number; admissoes: number; desligamentos: number; porDepartamento: { nome: string; total: number }[]; porCargo: { nome: string; total: number }[]; historico: { mes: string; admissoes: number; desligamentos: number }[] };
  financeiro?: FinSummary;
  estoque?: { produtos: number; itensEmEstoque: number; valorEstimado: number; abaixoMinimo: number; semEstoque: number; entradas: { qtd: number; total: number }; saidas: { qtd: number; total: number };
    recentMovements: { id: number; type: string; quantity: number; reason: string; date: string; code: string; name: string }[]; topMoved: { code: string; name: string; movimentos: number; quantidade: number }[]; alerts: { id: string; code: string; name: string; quantity: number; minStock: number; status: string }[] };
  atividades: { id: number; at: string; userName: string | null; module: string; summary: string }[];
}
const int = (n: number) => String(Math.round(n));
const MOD_TONE = { rh: 'info', financeiro: 'success', estoque: 'warning', config: 'neutral' } as const;

const Title = ({ icon: I, children }: { icon: typeof Users; children: string }) => <h2 className="mb-3 mt-2 flex items-center gap-2 font-display text-base font-bold"><I className="h-4 w-4 text-primary" />{children}</h2>;

export default function Dashboard() {
  const { me } = useAuth();
  const [p, setP] = useState<Period>(presetRange('mes'));
  const { data, loading, error, reload } = useFetch<Dash>('/dashboard', { period: 'custom', ...p });
  const ref = useReveal<HTMLDivElement>([!!data, p.from, p.to]);
  const { rh, financeiro: fin, estoque: est } = data ?? {};

  return (
    <div>
      <PageHeader title={`Olá, ${me!.name.split(' ')[0]}`} subtitle="Resumo operacional calculado com os dados registrados no sistema." actions={<PeriodPicker value={p} onChange={setP} />} />
      {error ? <ErrorBox message={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : data && (
        <div ref={ref} className="space-y-2">
          {rh && (<>
            <Title icon={Users}>Pessoas</Title>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Funcionários ativos" value={rh.ativos} format={int} icon={Users} to="/rh/funcionarios" />
              <StatCard label="Desligados (total)" value={rh.desligadosTotal} format={int} icon={UserMinus} tone="danger" to="/rh/funcionarios" />
              <StatCard label="Admissões no período" value={rh.admissoes} format={int} icon={UserPlus} tone="success" />
              <StatCard label="Desligamentos no período" value={rh.desligamentos} format={int} icon={UserMinus} tone="accent" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Por departamento" subtitle="Funcionários ativos"><Donut data={rh.porDepartamento} nameKey="nome" valueKey="total" /></ChartCard>
              <ChartCard title="Por cargo" subtitle="Funcionários ativos"><HBars data={rh.porCargo} nameKey="nome" valueKey="total" /></ChartCard>
              <ChartCard title="Admissões e desligamentos" subtitle="Últimos 12 meses"><CountBars data={rh.historico} bars={[{ key: 'admissoes', name: 'Admissões', color: C.teal }, { key: 'desligamentos', name: 'Desligamentos', color: C.coral }]} /></ChartCard>
            </div>
          </>)}

          {fin && (<>
            <Title icon={Wallet}>Financeiro</Title>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Receitas no período (previstas)" value={fin.receitas.previsto} format={brl} icon={TrendingUp} tone="success" to="/financeiro/receitas" />
              <StatCard label="Despesas no período (previstas)" value={fin.despesas.previsto} format={brl} icon={TrendingDown} tone="danger" to="/financeiro/despesas" />
              <StatCard label="Saldo do período (previsto)" value={fin.saldoPrevisto} format={brl} icon={Scale} tone={fin.saldoPrevisto >= 0 ? 'primary' : 'danger'} hint="Receitas − despesas" />
              <StatCard label="Saldo realizado" value={fin.saldoRealizado} format={brl} icon={DollarSign} tone={fin.saldoRealizado >= 0 ? 'primary' : 'danger'} hint="Recebido − pago" />
              <StatCard label="Receitas recebidas" value={fin.receitas.recebido} format={brl} icon={CheckCircle2} tone="success" />
              <StatCard label="Despesas pagas" value={fin.despesas.pago} format={brl} icon={CheckCircle2} tone="info" />
              <StatCard label="A receber (pendente)" value={fin.receitas.aReceber} format={brl} icon={Clock} tone="warning" to="/financeiro/receitas" />
              <StatCard label="A pagar (pendente)" value={fin.despesas.aPagar} format={brl} icon={Clock} tone="warning" to="/financeiro/despesas" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label="Contas vencidas a pagar" value={fin.vencidas.pagar} format={brl} icon={AlertTriangle} tone="danger" to="/financeiro/despesas?status=vencida" />
              <StatCard label="Contas vencidas a receber" value={fin.vencidas.receber} format={brl} icon={AlertTriangle} tone="danger" to="/financeiro/receitas?status=vencida" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Receitas × despesas" subtitle="Realizado por mês"><MoneyBars data={fin.monthly} bars={[{ key: 'recebido', name: 'Recebido', color: C.teal }, { key: 'pago', name: 'Pago', color: C.coral }]} /></ChartCard>
              <ChartCard title="Evolução do saldo mensal" subtitle="Resultado do mês e acumulado"><MoneyLine data={fin.monthly} lines={[{ key: 'saldo', name: 'Mês', color: C.coral }, { key: 'saldoAcumulado', name: 'Acumulado', color: C.teal }]} /></ChartCard>
            </div>
          </>)}

          {est && (<>
            <Title icon={Boxes}>Estoque</Title>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Produtos cadastrados" value={est.produtos} format={int} icon={Boxes} to="/estoque" />
              <StatCard label="Itens em estoque" value={est.itensEmEstoque} format={(n) => num(n, 0)} icon={ArrowDownToLine} tone="info" />
              <StatCard label="Valor estimado (custo médio)" value={est.valorEstimado} format={brl} icon={DollarSign} tone="success" />
              <StatCard label="Abaixo do mínimo" value={est.abaixoMinimo} format={int} icon={AlertTriangle} tone="warning" to="/estoque?stockStatus=baixo" />
              <StatCard label="Sem estoque" value={est.semEstoque} format={int} icon={PackageX} tone="danger" to="/estoque?stockStatus=sem_estoque" />
              <StatCard label="Entradas no período" value={est.entradas.qtd} format={int} icon={ArrowDownToLine} tone="success" hint={`${num(est.entradas.total)} un.`} to="/estoque/movimentacoes" />
              <StatCard label="Saídas no período" value={est.saidas.qtd} format={int} icon={ArrowUpFromLine} tone="accent" hint={`${num(est.saidas.total)} un.`} to="/estoque/movimentacoes" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <section data-reveal className="card p-4"><h3 className="mb-2 font-display text-sm font-bold">Alertas de estoque</h3>
                {est.alerts.length === 0 ? <Empty icon={CheckCircle2} title="Tudo em ordem" hint="Nenhum produto abaixo do mínimo." /> : <ul className="divide-y">{est.alerts.slice(0, 7).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{a.name}</span><Badge tone={a.status === 'sem_estoque' ? 'danger' : 'warning'}>{num(a.quantity)} / mín. {num(a.minStock)}</Badge></li>))}</ul>}</section>
              <section data-reveal className="card p-4"><h3 className="mb-2 font-display text-sm font-bold">Movimentações recentes</h3>
                {est.recentMovements.length === 0 ? <Empty title="Sem movimentações" /> : <ul className="divide-y">{est.recentMovements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{m.name}</span><Badge tone={m.type === 'entrada' ? 'success' : m.type === 'saida' ? 'danger' : 'info'}>{m.type} {num(m.quantity)}</Badge></li>))}</ul>}</section>
              <ChartCard title="Mais movimentados" subtitle="Nº de movimentações no período"><HBars data={est.topMoved} nameKey="name" valueKey="movimentos" color={C.coral} /></ChartCard>
            </div>
          </>)}

          <Title icon={Activity}>Atividades recentes</Title>
          <section data-reveal className="card p-2">
            {data.atividades.length === 0 ? <Empty title="Nenhuma atividade registrada ainda" hint="As operações realizadas no sistema aparecerão aqui." /> : (
              <ul className="divide-y">{data.atividades.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <Badge tone={MOD_TONE[a.module as keyof typeof MOD_TONE] ?? 'neutral'}>{a.module}</Badge><span className="min-w-0 flex-1">{a.summary}</span>
                  <span className="text-xs text-muted-foreground">{a.userName ?? 'sistema'} · {dmyTime(a.at)}</span></li>))}</ul>)}
          </section>
          {!rh && !fin && !est && <Empty title="Seu perfil não tem acesso aos indicadores" hint="Peça a um administrador para ajustar suas permissões." action={<Link to="/perfil/senha" className="btn-outline">Alterar senha</Link>} />}
        </div>
      )}
    </div>
  );
}
