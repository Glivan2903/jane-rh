import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Eye, Package, Pencil, Plus, Scale } from 'lucide-react';
import { MovementModal, type Kind, type ProdRef } from './MovementModal';
import { Link } from 'react-router-dom';
import { Badge, DataTable, Empty, Modal, PageHeader, type Col, type Tone } from '../../components/ui';
import { FCheck, FilterBar, FilterSelect, FInput, FSelect, FTextarea, SearchBox, SubmitButton } from '../../components/forms';
import { api } from '../../lib/api';
import { useAuth, useToast } from '../../lib/app';
import { useFetch, useForm, useList } from '../../lib/hooks';
import { brl, num } from '../../lib/format';

export interface Product {
  id: string; code: string; name: string; description: string | null; categoryId: number | null; category: string | null; unitId: number; unit: string; barcode: string | null;
  cost: string; salePrice: string | null; quantity: string; minStock: string; totalValue: string; location: string | null; supplierId: number | null; supplier: string | null; active: boolean; stockStatus: string;
}
const ST: Record<string, { tone: Tone; label: string }> = { normal: { tone: 'success', label: 'Normal' }, baixo: { tone: 'warning', label: 'Estoque baixo' }, sem_estoque: { tone: 'danger', label: 'Sem estoque' }, inativo: { tone: 'neutral', label: 'Inativo' } };
export const StockBadge = ({ s }: { s: string }) => <Badge tone={ST[s].tone}>{ST[s].label}</Badge>;

function ProductForm({ row, onClose, onSaved }: { row: Product | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const cats = useFetch<{ id: number; name: string }[]>('/est/categories', { active: 'true' });
  const units = useFetch<{ id: number; code: string; name: string }[]>('/est/units', { active: 'true' });
  const sups = useFetch<{ id: number; name: string }[]>('/est/suppliers', { active: 'true' });
  const f = useForm({
    name: row?.name ?? '', description: row?.description ?? '', categoryId: String(row?.categoryId ?? ''), unitId: String(row?.unitId ?? ''), barcode: row?.barcode ?? '',
    cost: row ? String(Number(row.cost)) : '', salePrice: row?.salePrice ?? '', initialQuantity: '', minStock: row ? String(Number(row.minStock)) : '0',
    location: row?.location ?? '', supplierId: String(row?.supplierId ?? ''), active: row?.active ?? true,
  });
  return (
    <Modal title={row ? `Editar produto ${row.code}` : 'Novo produto'} size="lg" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="pf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="pf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => {
          const body = { ...f.v, cost: f.v.cost === '' ? 0 : Number(f.v.cost), salePrice: f.v.salePrice === '' ? null : Number(f.v.salePrice), initialQuantity: f.v.initialQuantity === '' ? 0 : Number(f.v.initialQuantity), minStock: Number(f.v.minStock || 0) };
          return row ? api.put(`/est/products/${row.id}`, body) : api.post('/est/products', body);
        }, () => ({ ...(!f.v.name.trim() ? { name: 'Informe o nome' } : {}), ...(!f.v.unitId ? { unitId: 'Selecione a unidade' } : {}), ...(Number(f.v.cost) < 0 ? { cost: 'Custo não pode ser negativo' } : {}), ...(Number(f.v.minStock) < 0 ? { minStock: 'Não pode ser negativo' } : {}), ...(Number(f.v.initialQuantity) < 0 ? { initialQuantity: 'Não pode ser negativa' } : {}) }));
        if (ok) { toast.success('Produto salvo.'); onSaved(); }
      }}>
        {row && <p className="rounded-lg bg-muted px-3 py-2 text-xs sm:col-span-2">Código interno: <b>{row.code}</b> · Saldo e custo médio só mudam por movimentações de estoque (saldo atual: <b>{num(row.quantity)} {row.unit}</b>).</p>}
        <FInput f={f} name="name" label="Nome do produto" required className="sm:col-span-2" autoFocus />
        <FTextarea f={f} name="description" label="Descrição" rows={2} className="sm:col-span-2" />
        <FSelect f={f} name="categoryId" label="Categoria" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FSelect f={f} name="unitId" label="Unidade de medida" required options={(units.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))} />
        <FInput f={f} name="barcode" label="Código de barras" />
        <FSelect f={f} name="supplierId" label="Fornecedor principal" options={(sups.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        {!row && <FInput f={f} name="cost" label="Custo unitário de aquisição (R$)" type="number" step="0.0001" min="0" />}
        <FInput f={f} name="salePrice" label="Preço de venda (R$)" type="number" step="0.01" min="0" />
        {!row && can('est.move') && <FInput f={f} name="initialQuantity" label="Quantidade inicial" type="number" step="0.001" min="0" hint="Gera uma movimentação de saldo inicial." />}
        <FInput f={f} name="minStock" label="Estoque mínimo" type="number" step="0.001" min="0" />
        <FInput f={f} name="location" label="Localização física" />
        {row && can('est.inactivate') && <div className="flex items-end pb-2"><FCheck f={f} name="active" label="Produto ativo" /></div>}
        <SubmitButton busy={f.busy} className="hidden">Salvar</SubmitButton>
      </form>
    </Modal>
  );
}

export default function Products() {
  const { can } = useAuth(); const [sp] = useSearchParams();
  const [cat, setCat] = useState(''); const [st, setSt] = useState(sp.get('stockStatus') ?? ''); const [active, setActive] = useState('');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [mv, setMv] = useState<{ kind: Kind; product?: ProdRef } | null>(null);
  const cats = useFetch<{ id: number; name: string }[]>('/est/categories');
  const alerts = useFetch<{ id: string; code: string; name: string; quantity: string; minStock: string; unit: string; status: string }[]>('/est/alerts');
  const t = useList<Product>('/est/products', { sort: 'name', filters: { categoryId: cat, stockStatus: st, active } });

  const cols: Col<Product>[] = [
    { key: 'code', label: 'Código', sort: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'Nome', sort: 'name', render: (r) => <div><Link to={`/estoque/movimentacoes?productId=${r.id}`} className="font-semibold hover:text-primary">{r.name}</Link>{r.barcode && <div className="text-xs text-muted-foreground">{r.barcode}</div>}</div> },
    { key: 'category', label: 'Categoria', sort: 'category', render: (r) => r.category ?? '—' },
    { key: 'quantity', label: 'Disponível', sort: 'quantity', className: 'text-right tabular-nums', render: (r) => `${num(r.quantity)} ${r.unit}` },
    { key: 'min', label: 'Mínimo', className: 'text-right tabular-nums', render: (r) => num(r.minStock) },
    { key: 'cost', label: 'Custo unit.', sort: 'cost', className: 'text-right tabular-nums', render: (r) => brl(r.cost) },
    { key: 'total', label: 'Valor em estoque', sort: 'total', className: 'text-right tabular-nums', render: (r) => brl(Number(r.quantity) > 0 ? r.totalValue : 0) },
    { key: 'status', label: 'Situação', sort: 'status', render: (r) => <StockBadge s={r.stockStatus} /> },
    { key: 'a', label: 'Ações', render: (r) => (
      <div className="flex gap-1">
        <Link className="btn-ghost btn-sm" to={`/estoque/movimentacoes?productId=${r.id}`} title="Ver movimentações" aria-label={`Movimentações de ${r.name}`}><Eye className="h-4 w-4" /></Link>
        {r.active && can('est.move') && <button className="btn-ghost btn-sm text-success" title="Registrar entrada" aria-label={`Entrada de ${r.name}`} onClick={() => setMv({ kind: 'entrada', product: r })}><ArrowDownToLine className="h-4 w-4" /></button>}
        {r.active && can('est.move') && <button className="btn-ghost btn-sm text-danger" title="Registrar saída" aria-label={`Saída de ${r.name}`} onClick={() => setMv({ kind: 'saida', product: r })}><ArrowUpFromLine className="h-4 w-4" /></button>}
        {r.active && can('est.adjust') && <button className="btn-ghost btn-sm" title="Ajustar inventário" aria-label={`Ajuste de ${r.name}`} onClick={() => setMv({ kind: 'ajuste', product: r })}><Scale className="h-4 w-4" /></button>}
        {can('est.edit', 'est.inactivate') && <button className="btn-ghost btn-sm" title="Editar" aria-label={`Editar ${r.name}`} onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>}
      </div>) },
  ];
  const add = can('est.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Novo produto</button>;
  const topActions = <>
    {can('est.move') && <button className="btn-outline" onClick={() => setMv({ kind: 'entrada' })}><ArrowDownToLine className="h-4 w-4 text-success" />Entrada</button>}
    {can('est.move') && <button className="btn-outline" onClick={() => setMv({ kind: 'saida' })}><ArrowUpFromLine className="h-4 w-4 text-danger" />Saída</button>}
    {add}
  </>;
  const al = alerts.data ?? [];

  return (
    <div>
      <PageHeader title="Produtos" subtitle="Saldo valorizado pelo custo médio ponderado de aquisição." actions={topActions} />
      {al.length > 0 && (
        <div role="status" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-warning"><AlertTriangle className="h-4 w-4" />{al.length} alerta(s) de estoque</p>
          <div className="flex flex-wrap gap-2">{al.slice(0, 8).map((a) => <button key={a.id} className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted" onClick={() => t.setQ(a.code)}>{a.name}: <b className={a.status === 'sem_estoque' ? 'text-danger' : 'text-warning'}>{num(a.quantity)} {a.unit}</b> (mín. {num(a.minStock)})</button>)}{al.length > 8 && <span className="px-2 py-1 text-xs text-muted-foreground">+{al.length - 8}</span>}</div>
        </div>
      )}
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar código, nome ou código de barras…" />
        <FilterSelect label="Categoria" placeholder="Todas as categorias" value={cat} onChange={setCat} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Situação do estoque" placeholder="Todas as situações" value={st} onChange={setSt} options={Object.entries(ST).map(([v, o]) => ({ value: v, label: o.label }))} />
        <FilterSelect label="Status" placeholder="Ativos e inativos" value={active} onChange={setActive} options={[{ value: 'true', label: 'Somente ativos' }, { value: 'false', label: 'Somente inativos' }]} />
      </FilterBar>
      <DataTable<Product> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={Package} title={t.q || cat || st || active ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado'} hint="Cadastre o primeiro produto para começar a controlar o estoque." action={add} />} />
      {edit && <ProductForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); alerts.reload(); }} />}
      {mv && <MovementModal kind={mv.kind} product={mv.product} onClose={() => setMv(null)} onDone={() => { setMv(null); t.reload(); alerts.reload(); }} />}
    </div>
  );
}
