import { useState } from 'react';
import { Pencil, Plus, Users } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, type Col } from '../../components/ui';
import { FCheck, FilterBar, FilterSelect, FInput, FTextarea, SearchBox } from '../../components/forms';
import { api } from '../../lib/api';
import { useAuth, useToast } from '../../lib/app';
import { useForm, useList } from '../../lib/hooks';

interface Party {
  id: number; name: string; isCustomer: boolean; isSupplier: boolean; document: string | null; email: string | null; phone: string | null;
  notes: string | null; active: boolean; usageCount: number;
}

const fmtDoc = (d: string | null) => !d ? '' : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d;

function PartyForm({ row, onClose, onSaved }: { row: Party | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const f = useForm({
    name: row?.name ?? '', isCustomer: row?.isCustomer ?? true, isSupplier: row?.isSupplier ?? false, document: fmtDoc(row?.document ?? null),
    email: row?.email ?? '', phone: row?.phone ?? '', notes: row?.notes ?? '', active: row?.active ?? true,
  });
  const validate = () => ({
    name: f.v.name.trim() ? undefined : 'Informe o nome',
    isCustomer: f.v.isCustomer || f.v.isSupplier ? undefined : 'Marque cliente, fornecedor ou ambos',
  });
  return (
    <Modal title={row ? 'Editar cadastro' : 'Novo cadastro'} size="lg" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="pty" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="pty" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => (row ? api.put(`/cad/parties/${row.id}`, f.v) : api.post('/cad/parties', f.v)), validate);
        if (ok) { toast.success('Cadastro salvo.'); onSaved(); }
      }}>
        <FInput f={f} name="name" label="Nome / razão social" required className="sm:col-span-2" autoFocus />
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold">Tipo<span className="ml-0.5 text-danger" aria-hidden> *</span></span>
          <div className="flex gap-6"><FCheck f={f} name="isCustomer" label="Cliente" /><FCheck f={f} name="isSupplier" label="Fornecedor" /></div>
          {f.err.isCustomer && <span role="alert" className="mt-1 block text-xs text-danger">{f.err.isCustomer}</span>}
        </div>
        <FInput f={f} name="document" label="CPF ou CNPJ" hint="Opcional. Validado e sem duplicidade." />
        <FInput f={f} name="email" label="E-mail" type="email" />
        <FInput f={f} name="phone" label="Telefone" />
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" />
        {row && can('cad.inactivate') && <div className="sm:col-span-2"><FCheck f={f} name="active" label="Ativo" /></div>}
      </form>
    </Modal>
  );
}

export default function Parties() {
  const { can } = useAuth();
  const [kind, setKind] = useState(''); const [active, setActive] = useState('');
  const [edit, setEdit] = useState<Party | 'new' | null>(null);
  const t = useList<Party>('/cad/parties', { sort: 'name', filters: { kind, active } });
  const cols: Col<Party>[] = [
    { key: 'name', label: 'Nome', sort: 'name', render: (r) => <div><span className="font-semibold">{r.name}</span>{r.email && <div className="text-xs text-muted-foreground">{r.email}</div>}</div> },
    { key: 'kind', label: 'Tipo', render: (r) => <div className="flex gap-1">{r.isCustomer && <Badge tone="info">Cliente</Badge>}{r.isSupplier && <Badge tone="warning">Fornecedor</Badge>}</div> },
    { key: 'document', label: 'CPF / CNPJ', render: (r) => fmtDoc(r.document) || '—' },
    { key: 'phone', label: 'Telefone', render: (r) => r.phone || '—' },
    { key: 'active', label: 'Situação', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</Badge> },
    { key: 'a', label: '', className: 'text-right', render: (r) => can('cad.edit', 'cad.inactivate') && (
      <button className="btn-ghost btn-sm" onClick={() => setEdit(r)} aria-label={`Editar ${r.name}`}><Pencil className="h-4 w-4" /></button>) },
  ];
  const add = can('cad.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Novo cadastro</button>;
  return (
    <div>
      <PageHeader title="Clientes e fornecedores" subtitle="Cadastro único usado no financeiro e no estoque. Para parar de usar um cadastro, inative-o." actions={add} />
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar nome, CPF/CNPJ ou e-mail…" />
        <FilterSelect label="Tipo" placeholder="Clientes e fornecedores" value={kind} onChange={setKind} options={[{ value: 'customer', label: 'Somente clientes' }, { value: 'supplier', label: 'Somente fornecedores' }]} />
        <FilterSelect label="Situação" placeholder="Todas as situações" value={active} onChange={setActive} options={[{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }]} />
      </FilterBar>
      <DataTable<Party> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={Users} title="Nenhum cadastro encontrado" hint="Cadastre o primeiro cliente ou fornecedor, ou ajuste os filtros." action={add} />} />
      {edit && <PartyForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); }} />}
    </div>
  );
}
