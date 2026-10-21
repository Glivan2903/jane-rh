import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader } from '../components/ui';
import { FCheck, FInput, SubmitButton } from '../components/forms';
import { api } from '../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../lib/app';
import { useFetch, useForm } from '../lib/hooks';

interface Row { id: number; name: string; code?: string; active: boolean; usageCount: number }
interface Cfg { title: string; subtitle?: string; url: string; label: string; hasCode?: boolean; create: string; edit: string; inactivate: string }

function LookupForm({ cfg, row, onClose, onSaved }: { cfg: Cfg; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ code: row?.code ?? '', name: row?.name ?? '', active: row?.active ?? true });
  const toast = useToast(); const { can } = useAuth();
  return (
    <Modal title={`${row ? 'Editar' : 'Novo(a)'} ${cfg.label.toLowerCase()}`} size="sm" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="lk" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="lk" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => (row ? api.put(`${cfg.url}/${row.id}`, f.v) : api.post(cfg.url, f.v)),
          () => ({ ...(cfg.hasCode && !f.v.code.trim() ? { code: 'Informe a sigla' } : {}), ...(!f.v.name.trim() ? { name: 'Informe o nome' } : {}) }));
        if (ok) { toast.success('Cadastro salvo.'); onSaved(); }
      }}>
        {cfg.hasCode && <FInput f={f} name="code" label="Sigla" required />}
        <FInput f={f} name="name" label="Nome" required autoFocus />
        {row && can(cfg.inactivate) && <FCheck f={f} name="active" label="Ativo" />}
        <SubmitButton busy={f.busy} className="hidden">Salvar</SubmitButton>
      </form>
    </Modal>
  );
}

/** Tela genérica de cadastros auxiliares (cargos, departamentos, categorias, unidades, fornecedores). */
export function LookupPanel({ cfg }: { cfg: Cfg }) {
  const { data, loading, error, reload } = useFetch<Row[]>(cfg.url);
  const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const [edit, setEdit] = useState<Row | 'new' | null>(null);
  const rows = data ?? [];
  const noop = { page: 1, pageSize: rows.length || 1, sort: '', dir: 'asc' as const, total: 0, setPage() {}, setPageSize() {}, toggleSort() {} };

  const remove = async (r: Row) => {
    if (!(await confirm({ title: `Excluir ${cfg.label.toLowerCase()}?`, message: `"${r.name}" será removido permanentemente.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`${cfg.url}/${r.id}`); toast.success('Excluído.'); reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} actions={can(cfg.create) && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Novo(a) {cfg.label.toLowerCase()}</button>} />
      <DataTable<Row> loading={loading} error={error} onRetry={reload} rows={rows} list={noop}
        empty={<Empty title={`Nenhum(a) ${cfg.label.toLowerCase()} cadastrado(a)`} hint="Cadastre o primeiro para usá-lo nos formulários." action={can(cfg.create) && <button className="btn-primary" onClick={() => setEdit('new')}>Cadastrar</button>} />}
        cols={[
          ...(cfg.hasCode ? [{ key: 'code', label: 'Sigla' }] : []),
          { key: 'name', label: 'Nome' },
          { key: 'usageCount', label: 'Em uso' },
          { key: 'active', label: 'Situação', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</Badge> },
          { key: 'a', label: '', className: 'text-right', render: (r) => (
            <div className="flex justify-end gap-1">
              {can(cfg.edit, cfg.inactivate) && <button className="btn-ghost btn-sm" onClick={() => setEdit(r)} aria-label={`Editar ${r.name}`}><Pencil className="h-4 w-4" /></button>}
              {can(cfg.inactivate) && r.usageCount === 0 && <button className="btn-ghost btn-sm text-danger" onClick={() => remove(r)} aria-label={`Excluir ${r.name}`}><Trash2 className="h-4 w-4" /></button>}
            </div>) },
        ]} />
      {edit && <LookupForm cfg={cfg} row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}
