import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader } from '../../components/ui';
import { FCheck, FInput } from '../../components/forms';
import { api } from '../../lib/api';
import { useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import type { DocType } from './docs';

function TypeForm({ row, onClose, onSaved }: { row: DocType | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ name: row?.name ?? '', requiresExpiry: row?.requiresExpiry ?? true, alertDays: String(row?.alertDays ?? 30), active: row?.active ?? true });
  return (
    <Modal title={row ? 'Editar tipo de documento' : 'Novo tipo de documento'} size="sm" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="dtf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="dtf" noValidate className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { name: f.v.name, requiresExpiry: f.v.requiresExpiry, alertDays: Number(f.v.alertDays), active: f.v.active };
        const ok = await f.submit(() => (row ? api.put(`/rh/document-types/${row.id}`, body) : api.post('/rh/document-types', body)),
          () => ({ name: f.v.name.trim() ? undefined : 'Informe o nome', alertDays: Number(f.v.alertDays) >= 0 && Number(f.v.alertDays) <= 365 ? undefined : 'Use entre 0 e 365 dias' }));
        if (ok) { toast.success('Tipo salvo.'); onSaved(); }
      }}>
        <FInput f={f} name="name" label="Nome" required autoFocus />
        <FCheck f={f} name="requiresExpiry" label="Exige data de validade" />
        <FInput f={f} name="alertDays" label="Avisar com antecedência (dias)" type="number" min="0" max="365" hint={'Quantos dias antes de vencer o documento passa a aparecer como "a vencer".'} />
        {row && <FCheck f={f} name="active" label="Ativo" />}
      </form>
    </Modal>
  );
}

export function DocTypesPanel() {
  const q = useFetch<DocType[]>('/rh/document-types');
  const [edit, setEdit] = useState<DocType | 'new' | null>(null);
  const add = <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Novo tipo</button>;
  const rows = q.data ?? [];
  const noop = { page: 1, pageSize: rows.length || 1, sort: '', dir: 'asc' as const, total: 0, setPage() {}, setPageSize() {}, toggleSort() {} };
  return (
    <div>
      <PageHeader title="Tipos de documento" subtitle="Defina quais documentos os funcionários têm, se vencem e com quantos dias de antecedência avisar." actions={add} />
      <DataTable<DocType> loading={q.loading} error={q.error} onRetry={q.reload} rows={rows} list={noop} empty={<Empty title="Nenhum tipo cadastrado" action={add} />}
        cols={[
          { key: 'name', label: 'Tipo' },
          { key: 'requiresExpiry', label: 'Validade', render: (r) => (r.requiresExpiry ? 'Obrigatória' : 'Opcional') },
          { key: 'alertDays', label: 'Aviso', render: (r) => (r.requiresExpiry ? `${r.alertDays} dias antes` : '—') },
          { key: 'usageCount', label: 'Em uso' },
          { key: 'active', label: 'Situação', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</Badge> },
          { key: 'a', label: '', className: 'text-right', render: (r) => <button className="btn-ghost btn-sm" aria-label={`Editar ${r.name}`} onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button> },
        ]} />
      {edit && <TypeForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
    </div>
  );
}
