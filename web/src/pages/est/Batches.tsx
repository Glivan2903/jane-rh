import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { Badge, DataTable, Empty, PageHeader, StatCard, type Col } from '../../components/ui';
import { FilterBar, FilterSelect, SearchBox } from '../../components/forms';
import { useFetch, useList } from '../../lib/hooks';
import { dmy, num } from '../../lib/format';

interface Batch { id: number; code: string; expiresAt: string | null; quantity: string; productId: string; productCode: string; product: string; unit: string; status: 'vencido' | 'a_vencer' | 'valido' | 'sem_validade'; daysLeft: number | null }
const STATUS = [{ value: 'atencao', label: 'Vencidos e a vencer' }, { value: 'vencido', label: 'Vencidos' }, { value: 'a_vencer', label: 'A vencer' }, { value: 'valido', label: 'Válidos' }, { value: 'sem_validade', label: 'Sem validade' }, { value: 'todos', label: 'Todos' }];
const plural = (n: number) => `${n} dia${n === 1 ? '' : 's'}`;

export function BatchBadge({ b }: { b: Pick<Batch, 'status' | 'daysLeft' | 'expiresAt'> }) {
  if (b.status === 'vencido') return <Badge tone="danger">Vencido há {plural(Math.abs(b.daysLeft ?? 0))}</Badge>;
  if (b.status === 'a_vencer') return <Badge tone="warning">{b.daysLeft === 0 ? 'Vence hoje' : `Vence em ${plural(b.daysLeft ?? 0)}`}</Badge>;
  if (b.status === 'valido') return <Badge tone="success">Válido até {dmy(b.expiresAt)}</Badge>;
  return <Badge>Sem validade</Badge>;
}

/** Lotes com saldo de todos os produtos controlados por lote: por padrão mostra o que exige atenção. */
export default function Batches() {
  const [sp] = useSearchParams(); const [status, setStatus] = useState(sp.get('status') ?? 'atencao');
  const sum = useFetch<{ vencidos: number; aVencer: number; total: number }>('/est/batches/summary');
  const t = useList<Batch>('/est/batches', { sort: 'expiresAt', filters: { status } });
  const cols: Col<Batch>[] = [
    { key: 'product', label: 'Produto', sort: 'product', render: (r) => <div><Link to={`/estoque/movimentacoes?productId=${r.productId}`} className="font-semibold text-primary hover:underline">{r.product}</Link><div className="font-mono text-xs text-muted-foreground">{r.productCode}</div></div> },
    { key: 'code', label: 'Lote', sort: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'expiresAt', label: 'Validade', sort: 'expiresAt', render: (r) => (r.expiresAt ? dmy(r.expiresAt) : '—') },
    { key: 'quantity', label: 'Saldo', sort: 'quantity', className: 'text-right tabular-nums', render: (r) => `${num(r.quantity)} ${r.unit}` },
    { key: 'status', label: 'Situação', render: (r) => <BatchBadge b={r} /> },
  ];
  return (
    <div>
      <PageHeader title="Lotes e validades" subtitle="Lotes com saldo em estoque. A saída usa primeiro o lote que vence antes." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vencidos com saldo" value={sum.data?.vencidos ?? 0} format={(n) => String(n)} icon={AlertTriangle} tone={sum.data?.vencidos ? 'danger' : 'success'} />
        <StatCard label="A vencer" value={sum.data?.aVencer ?? 0} format={(n) => String(n)} icon={CalendarClock} tone={sum.data?.aVencer ? 'warning' : 'success'} hint="dentro do prazo de aviso" />
      </div>
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar produto ou lote…" />
        <FilterSelect label="Situação" placeholder="Situação" value={status} onChange={setStatus} options={STATUS} />
      </FilterBar>
      <DataTable<Batch> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={CalendarClock} title={status === 'atencao' ? 'Nenhum lote vencido ou a vencer' : 'Nenhum lote encontrado'} hint="Os lotes aparecem aqui para produtos com controle por lote e validade." />} />
    </div>
  );
}
