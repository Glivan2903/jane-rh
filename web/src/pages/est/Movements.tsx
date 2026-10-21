import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { Badge, DataTable, Empty, PageHeader, type Col } from '../../components/ui';
import { FilterBar, FilterDate, FilterSelect, SearchBox } from '../../components/forms';
import { useFetch, useList } from '../../lib/hooks';
import { dmy, dmyTime, num } from '../../lib/format';

interface Mv { id: number; at: string; date: string; productId: string; code: string; product: string; type: 'entrada' | 'saida' | 'ajuste'; quantity: string; delta: string; balanceBefore: string; balanceAfter: string; reason: string; userName: string | null }

export default function Movements() {
  const [sp] = useSearchParams();
  const [product, setProduct] = useState(sp.get('productId') ?? ''); const [type, setType] = useState(''); const [user, setUser] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const prods = useFetch<{ id: string; code: string; name: string }[]>('/est/products/options');
  const users = useFetch<{ id: string; name: string }[]>('/est/movements/users');
  const t = useList<Mv>('/est/movements', { sort: 'at', dir: 'desc', filters: { productId: product, type, userId: user, from, to } });
  const cols: Col<Mv>[] = [
    { key: 'at', label: 'Data e hora', sort: 'at', render: (r) => <div>{dmyTime(r.at)}<div className="text-xs text-muted-foreground">ref. {dmy(r.date)}</div></div> },
    { key: 'product', label: 'Produto', sort: 'product', render: (r) => <div><b>{r.product}</b><div className="font-mono text-xs text-muted-foreground">{r.code}</div></div> },
    { key: 'type', label: 'Tipo', sort: 'type', render: (r) => <Badge tone={r.type === 'entrada' ? 'success' : r.type === 'saida' ? 'danger' : 'info'}>{r.type === 'entrada' ? 'Entrada' : r.type === 'saida' ? 'Saída' : 'Ajuste'}</Badge> },
    { key: 'quantity', label: 'Quantidade', sort: 'quantity', className: 'text-right tabular-nums', render: (r) => <span className={Number(r.delta) < 0 ? 'text-danger' : 'text-success'}>{Number(r.delta) > 0 ? '+' : ''}{num(r.delta)}</span> },
    { key: 'before', label: 'Saldo anterior', className: 'text-right tabular-nums', render: (r) => num(r.balanceBefore) },
    { key: 'after', label: 'Saldo posterior', className: 'text-right tabular-nums', render: (r) => num(r.balanceAfter) },
    { key: 'reason', label: 'Motivo' }, { key: 'userName', label: 'Responsável', render: (r) => r.userName ?? '—' },
  ];
  return (
    <div>
      <PageHeader back="/estoque" title="Histórico de movimentações" subtitle="Entradas, saídas e ajustes — registros permanentes, mesmo de produtos inativados." />
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar produto ou motivo…" />
        <FilterSelect label="Produto" placeholder="Todos os produtos" value={product} onChange={setProduct} options={(prods.data ?? []).map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
        <FilterSelect label="Tipo" placeholder="Todos os tipos" value={type} onChange={setType} options={[{ value: 'entrada', label: 'Entradas' }, { value: 'saida', label: 'Saídas' }, { value: 'ajuste', label: 'Ajustes' }]} />
        <FilterSelect label="Usuário" placeholder="Todos os usuários" value={user} onChange={setUser} options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        <FilterDate label="De" value={from} onChange={setFrom} /><FilterDate label="Até" value={to} onChange={setTo} />
      </FilterBar>
      <DataTable<Mv> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list} empty={<Empty icon={ClipboardCheck} title="Nenhuma movimentação encontrada" hint="Registre uma entrada ou saída para vê-la aqui." />} />
    </div>
  );
}
