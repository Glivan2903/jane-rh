import { useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader } from '../../components/ui';
import { FCheck, FInput, FSelect, FTextarea } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';

interface Cat { id: number; name: string; type: 'receita' | 'despesa'; description: string | null; active: boolean; usageCount: number }

function CatForm({ row, onClose, onSaved }: { row: Cat | null; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ name: row?.name ?? '', type: row?.type ?? '', description: row?.description ?? '', active: row?.active ?? true });
  const toast = useToast(); const { can } = useAuth();
  return (
    <Modal title={row ? 'Editar categoria' : 'Nova categoria'} size="sm" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="cf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="cf" className="space-y-3" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => (row ? api.put(`/fin/categories/${row.id}`, f.v) : api.post('/fin/categories', f.v)),
          () => ({ ...(!f.v.name.trim() ? { name: 'Informe o nome' } : {}), ...(!f.v.type ? { type: 'Selecione o tipo' } : {}) }));
        if (ok) { toast.success('Categoria salva.'); onSaved(); }
      }}>
        <FInput f={f} name="name" label="Nome da categoria" required autoFocus />
        <FSelect f={f} name="type" label="Tipo" required disabled={!!row && row.usageCount > 0} options={[{ value: 'receita', label: 'Receita' }, { value: 'despesa', label: 'Despesa' }]} hint={row && row.usageCount > 0 ? 'Categoria já utilizada: o tipo não pode mudar.' : undefined} />
        <FTextarea f={f} name="description" label="Descrição" rows={2} />
        {row && can('fin.inactivate') && <FCheck f={f} name="active" label="Categoria ativa" />}
      </form>
    </Modal>
  );
}

export default function Categories() {
  const { data, loading, error, reload } = useFetch<Cat[]>('/fin/categories');
  const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const [edit, setEdit] = useState<Cat | 'new' | null>(null);
  const rows = data ?? [];
  const noop = { page: 1, pageSize: rows.length || 1, sort: '', dir: 'asc' as const, total: 0, setPage() {}, setPageSize() {}, toggleSort() {} };
  const remove = async (r: Cat) => {
    if (!(await confirm({ title: 'Excluir categoria?', message: `"${r.name}" nunca foi usada e será removida.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/fin/categories/${r.id}`); toast.success('Categoria excluída.'); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const add = can('fin.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Nova categoria</button>;
  return (
    <div>
      <PageHeader title="Categorias financeiras" subtitle="Categorias vinculadas a lançamentos só podem ser inativadas." actions={add} />
      <DataTable<Cat> rows={rows} loading={loading} error={error} onRetry={reload} list={noop} empty={<Empty icon={Tags} title="Nenhuma categoria" action={add} />}
        cols={[
          { key: 'name', label: 'Nome', render: (r) => <div><b>{r.name}</b>{r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}</div> },
          { key: 'type', label: 'Tipo', render: (r) => <Badge tone={r.type === 'receita' ? 'success' : 'accent'}>{r.type === 'receita' ? 'Receita' : 'Despesa'}</Badge> },
          { key: 'usageCount', label: 'Lançamentos' },
          { key: 'active', label: 'Situação', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativa' : 'Inativa'}</Badge> },
          { key: 'a', label: '', className: 'text-right', render: (r) => (
            <div className="flex justify-end gap-1">
              {can('fin.edit', 'fin.inactivate') && <button className="btn-ghost btn-sm" aria-label={`Editar ${r.name}`} onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>}
              {can('fin.inactivate') && r.usageCount === 0 && <button className="btn-ghost btn-sm text-danger" aria-label={`Excluir ${r.name}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
            </div>) },
        ]} />
      {edit && <CatForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
