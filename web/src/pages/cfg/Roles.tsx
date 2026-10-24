import { useEffect, useState } from 'react';
import { Lock, Plus, Save, Trash2 } from 'lucide-react';
import { ErrorBox, Modal, PageHeader, Spinner } from '../../components/ui';
import { FInput } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';

interface Role { id: number; name: string; description: string | null; isSystem: boolean; permissions: string[]; userCount: number }
interface Perm { code: string; module: string; description: string }
const MOD: Record<string, string> = { dash: 'Dashboard', rh: 'RH / Pessoal', fin: 'Financeiro', est: 'Estoque', cad: 'Clientes e fornecedores', cfg: 'Configurações' };

function NewRole({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const f = useForm({ name: '', description: '' }); const toast = useToast();
  return (
    <Modal title="Novo perfil" size="sm" onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="nr" className="btn-primary" disabled={f.busy}>Criar</button></>}>
      <form id="nr" className="space-y-3" onSubmit={async (e) => { e.preventDefault(); let id = 0; const ok = await f.submit(async () => { id = (await api.post<{ id: number }>('/config/roles', { ...f.v, permissions: ['dash.view'] })).id; }, () => (f.v.name.trim() ? {} : { name: 'Informe o nome' })); if (ok) { toast.success('Perfil criado. Defina as permissões.'); onSaved(id); } }}>
        <FInput f={f} name="name" label="Nome do perfil" required autoFocus /><FInput f={f} name="description" label="Descrição" />
      </form>
    </Modal>
  );
}

export default function Roles() {
  const roles = useFetch<Role[]>('/config/roles'); const perms = useFetch<Perm[]>('/config/permissions');
  const [sel, setSel] = useState<number | null>(null); const [codes, setCodes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [newOpen, setNewOpen] = useState(false);
  const toast = useToast(); const confirm = useConfirm();
  const role = roles.data?.find((r) => r.id === sel) ?? null;
  useEffect(() => { if (!sel && roles.data?.length) setSel(roles.data[0].id); }, [roles.data, sel]);
  useEffect(() => { if (role) setCodes(new Set(role.permissions)); }, [role?.id, roles.data]);
  const locked = role?.name === 'Administrador';

  const groups = (perms.data ?? []).reduce<Record<string, Perm[]>>((a, p) => { (a[p.module] ??= []).push(p); return a; }, {});
  const toggle = (c: string) => setCodes((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  const save = async () => {
    if (!role) return; setBusy(true);
    try { await api.put(`/config/roles/${role.id}`, { name: role.name, description: role.description, permissions: [...codes] }); toast.success('Permissões salvas. Valem a partir da próxima operação dos usuários.'); roles.reload(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!role || !(await confirm({ title: 'Excluir perfil?', message: `O perfil "${role.name}" será removido.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/config/roles/${role.id}`); toast.success('Perfil excluído.'); setSel(null); roles.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (roles.error) return <ErrorBox message={roles.error} onRetry={roles.reload} />;
  return (
    <div>
      <PageHeader title="Perfis e permissões" subtitle="Controle por módulo e por operação — validado também no servidor." actions={<button className="btn-primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />Novo perfil</button>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="card h-fit p-2">{(roles.data ?? []).map((r) => (
          <button key={r.id} onClick={() => setSel(r.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${sel === r.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <span className="font-semibold">{r.name}</span><span className="text-xs opacity-75">{r.userCount} usuário(s)</span></button>))}</div>
        <div className="card p-5">
          {!role ? <Spinner /> : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg font-bold">{role.name}</h2><p className="text-sm text-muted-foreground">{role.description}</p></div>
                <div className="flex gap-2">{!role.isSystem && <button className="btn-outline text-danger" onClick={remove}><Trash2 className="h-4 w-4" />Excluir</button>}
                  {!locked && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save className="h-4 w-4" />}Salvar permissões</button>}</div></div>
              {locked && <p className="mb-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm"><Lock className="h-4 w-4" />O perfil Administrador possui acesso completo e não pode ser alterado.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(groups).map(([m, list]) => (
                  <fieldset key={m} className="rounded-xl border p-3"><legend className="px-1 font-display text-sm font-bold text-primary">{MOD[m] ?? m}</legend>
                    {list.map((p) => (<label key={p.code} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" disabled={locked} checked={codes.has(p.code)} onChange={() => toggle(p.code)} />{p.description}</label>))}
                  </fieldset>))}
              </div>
            </>)}
        </div>
      </div>
      {newOpen && <NewRole onClose={() => setNewOpen(false)} onSaved={(id) => { setNewOpen(false); roles.reload(); setSel(id); }} />}
    </div>
  );
}
