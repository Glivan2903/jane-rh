import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Plus } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, type Col, type Tone } from '../../components/ui';
import { FInput, FSelect, FTextarea } from '../../components/forms';
import { api } from '../../lib/api';
import { useAuth, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import { dmy, dmyTime, todayIso } from '../../lib/format';

interface Count { id: number; title: string; status: 'aberto' | 'finalizado' | 'cancelado'; notes: string | null; category: string | null; createdBy: string | null; createdAt: string; finalizedAt: string | null; items: number; counted: number }
export const COUNT_STATUS: Record<string, { tone: Tone; label: string }> = { aberto: { tone: 'info', label: 'Em contagem' }, finalizado: { tone: 'success', label: 'Finalizado' }, cancelado: { tone: 'neutral', label: 'Cancelado' } };

function NewCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const cats = useFetch<{ id: number; name: string }[]>('/est/categories', { active: 'true' });
  const f = useForm({ title: `Inventário ${dmy(todayIso())}`, categoryId: '', notes: '' });
  return (
    <Modal title="Novo inventário" size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="icf" className="btn-primary" disabled={f.busy}>Iniciar contagem</button></>}>
      <form id="icf" noValidate className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        let id = 0;
        const ok = await f.submit(async () => { id = (await api.post<{ id: number }>('/est/counts', { title: f.v.title, categoryId: f.v.categoryId || undefined, notes: f.v.notes })).id; }, () => ({ title: f.v.title.trim() ? undefined : 'Informe o nome da contagem' }));
        if (ok) { toast.success('Contagem iniciada.'); onCreated(id); }
      }}>
        <FInput f={f} name="title" label="Nome da contagem" required autoFocus />
        <FSelect f={f} name="categoryId" label="Categoria" placeholder="Todos os produtos ativos" options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} hint="Para contar só uma parte do estoque, escolha a categoria." />
        <FTextarea f={f} name="notes" label="Observações" rows={2} />
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">O sistema registra o saldo de cada item agora. O estoque só é ajustado quando você finalizar a contagem.</p>
      </form>
    </Modal>
  );
}

export default function Inventory() {
  const { can } = useAuth(); const nav = useNavigate();
  const q = useFetch<Count[]>('/est/counts');
  const [open, setOpen] = useState(false);
  const rows = q.data ?? [];
  const noop = { page: 1, pageSize: rows.length || 1, sort: '', dir: 'asc' as const, total: 0, setPage() {}, setPageSize() {}, toggleSort() {} };
  const add = can('est.adjust') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Novo inventário</button>;
  const cols: Col<Count>[] = [
    { key: 'title', label: 'Contagem', render: (r) => <div><span className="font-semibold">{r.title}</span><div className="text-xs text-muted-foreground">{r.category ?? 'Todos os produtos'}</div></div> },
    { key: 'progress', label: 'Progresso', render: (r) => (
      <div className="min-w-32"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${r.items ? Math.round((r.counted / r.items) * 100) : 0}%` }} /></div>
        <p className="mt-1 text-xs text-muted-foreground">{r.counted} de {r.items} contados</p></div>) },
    { key: 'createdAt', label: 'Aberto em', render: (r) => <div className="text-sm">{dmyTime(r.createdAt)}<div className="text-xs text-muted-foreground">{r.createdBy ?? ''}</div></div> },
    { key: 'status', label: 'Situação', render: (r) => <Badge tone={COUNT_STATUS[r.status].tone}>{COUNT_STATUS[r.status].label}</Badge> },
    { key: 'a', label: '', className: 'text-right', render: (r) => <Link to={`/estoque/inventario/${r.id}`} className="btn-outline btn-sm">{r.status === 'aberto' ? 'Continuar' : 'Ver'}</Link> },
  ];
  return (
    <div>
      <PageHeader title="Inventário" subtitle="Conte o estoque físico e ajuste as diferenças de uma só vez." actions={add} />
      <DataTable<Count> cols={cols} rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} list={noop} rowKey={(r) => r.id}
        empty={<Empty icon={ListChecks} title="Nenhum inventário ainda" hint="Inicie uma contagem para comparar o estoque físico com o do sistema." action={add} />} />
      {open && <NewCount onClose={() => setOpen(false)} onCreated={(id) => nav(`/estoque/inventario/${id}`)} />}
    </div>
  );
}
