import { useState } from 'react';
import { KeyRound, Pencil, Plus, UserCog } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, type Col } from '../../components/ui';
import { FCheck, FilterBar, FilterSelect, FInput, FSelect, SearchBox } from '../../components/forms';
import { api } from '../../lib/api';
import { useToast } from '../../lib/app';
import { useFetch, useForm, useList, usePersisted } from '../../lib/hooks';
import { dmy, dmyTime } from '../../lib/format';

interface U { id: string; name: string; email: string; username: string | null; roleId: number; role: string; active: boolean; createdAt: string; lastLoginAt: string | null }
interface Role { id: number; name: string }
const strong = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);

function UserForm({ row, roles, onClose, onSaved }: { row: U | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const f = useForm({ name: row?.name ?? '', email: row?.email ?? '', username: row?.username ?? '', roleId: String(row?.roleId ?? ''), password: '', active: row?.active ?? true });
  const toast = useToast();
  return (
    <Modal title={row ? 'Editar usuário' : 'Novo usuário'} size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="uf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="uf" noValidate className="grid gap-3 sm:grid-cols-2" autoComplete="off" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => (row ? api.put(`/config/users/${row.id}`, f.v) : api.post('/config/users', f.v)), () => ({
          ...(!f.v.name.trim() ? { name: 'Informe o nome' } : {}), ...(!/^\S+@\S+\.\S+$/.test(f.v.email) ? { email: 'E-mail inválido' } : {}),
          ...(row && !f.v.roleId ? { roleId: 'Selecione o perfil' } : {}), ...(!row && !strong(f.v.password) ? { password: 'Mínimo de 10 caracteres, com letras e números' } : {}),
        }));
        if (ok) { toast.success('Usuário salvo.'); onSaved(); }
      }}>
        <FInput f={f} name="name" label="Nome completo" required className="sm:col-span-2" autoFocus />
        <FInput f={f} name="email" label="E-mail de acesso" type="email" required />
        <FInput f={f} name="username" label="Nome de usuário" hint="Opcional. Letras, números, ponto, hífen." />
        <FSelect f={f} name="roleId" label="Perfil de acesso" required={!!row} placeholder={row ? 'Selecione…' : 'Sem permissões (definir depois)'} hint={row ? undefined : 'Opcional: o usuário entra sem permissões até você definir o perfil.'} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        {!row && <FInput f={f} name="password" label="Senha inicial" type="password" required autoComplete="new-password" hint="O usuário será obrigado a trocá-la no primeiro acesso." />}
        {row && <div className="flex items-end pb-2"><FCheck f={f} name="active" label="Usuário ativo" /></div>}
      </form>
    </Modal>
  );
}

function ResetModal({ u, onClose }: { u: U; onClose: () => void }) {
  const f = useForm({ password: '' }); const toast = useToast();
  return (
    <Modal title={`Redefinir senha — ${u.name}`} size="sm" onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="rf" className="btn-primary" disabled={f.busy}>Redefinir</button></>}>
      <form id="rf" onSubmit={async (e) => { e.preventDefault(); const ok = await f.submit(() => api.post(`/config/users/${u.id}/reset-password`, f.v), () => (strong(f.v.password) ? {} : { password: 'Mínimo de 10 caracteres, com letras e números' })); if (ok) { toast.success('Senha redefinida. As sessões do usuário foram encerradas.'); onClose(); } }}>
        <FInput f={f} name="password" label="Nova senha temporária" type="password" required autoComplete="new-password" hint="O usuário deverá trocá-la no próximo acesso." />
      </form>
    </Modal>
  );
}

export default function Users() {
  const roles = useFetch<Role[]>('/config/roles');
  const [role, setRole] = usePersisted('cfg.users.role', ''); const [active, setActive] = usePersisted('cfg.users.active', '');
  const [edit, setEdit] = useState<U | 'new' | null>(null); const [reset, setReset] = useState<U | null>(null);
  const t = useList<U>('/config/users', { sort: 'name', persistKey: 'cfg.users', filters: { roleId: role, active } });
  const cols: Col<U>[] = [
    { key: 'name', label: 'Nome', sort: 'name', render: (r) => <div><b>{r.name}</b><div className="text-xs text-muted-foreground">{r.email}{r.username ? ` · @${r.username}` : ''}</div></div> },
    { key: 'role', label: 'Perfil', sort: 'role', render: (r) => <Badge tone="info">{r.role}</Badge> },
    { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</Badge> },
    { key: 'created', label: 'Criado em', sort: 'created', render: (r) => dmy(r.createdAt) },
    { key: 'last', label: 'Último acesso', sort: 'last', render: (r) => (r.lastLoginAt ? dmyTime(r.lastLoginAt) : 'Nunca') },
    { key: 'a', label: 'Ações', render: (r) => (<div className="flex gap-1">
      <button className="btn-ghost btn-sm" aria-label={`Editar ${r.name}`} onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>
      <button className="btn-ghost btn-sm" title="Redefinir senha" aria-label={`Redefinir senha de ${r.name}`} onClick={() => setReset(r)}><KeyRound className="h-4 w-4" /></button></div>) },
  ];
  const add = <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Novo usuário</button>;
  return (
    <div>
      <PageHeader title="Usuários" subtitle="Quem acessa o sistema e com qual perfil." actions={add} />
      <FilterBar dirty={!!(t.q || role || active)} onClear={() => { t.setQ(''); setRole(''); setActive(''); }}>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar nome, e-mail ou usuário…" />
        <FilterSelect label="Perfil" placeholder="Todos os perfis" value={role} onChange={setRole} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
        <FilterSelect label="Status" placeholder="Ativos e inativos" value={active} onChange={setActive} options={[{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }]} />
      </FilterBar>
      <DataTable<U> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list} empty={<Empty icon={UserCog} title="Nenhum usuário encontrado" action={add} />} />
      {edit && <UserForm row={edit === 'new' ? null : edit} roles={roles.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); }} />}
      {reset && <ResetModal u={reset} onClose={() => setReset(null)} />}
    </div>
  );
}
