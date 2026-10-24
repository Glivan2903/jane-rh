import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Eye, Pencil, Plus, Trash2, UserCheck, UserMinus, UserPlus } from 'lucide-react';
import { AdmissionModal, TerminationModal, type EmpRef } from './Processes';
import { Badge, DataTable, Empty, PageHeader, type Col } from '../../components/ui';
import { FilterBar, FilterDate, FilterSelect, SearchBox } from '../../components/forms';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { api } from '../../lib/api';
import { useFetch, useList } from '../../lib/hooks';
import { dmy, fmtCpf } from '../../lib/format';

export interface Employee {
  id: string; registration: string; fullName: string; cpf: string; position: string | null; department: string | null; admissionDate: string | null;
  terminationDate: string | null; phone: string | null; email: string | null; status: 'ativo' | 'desligado' | 'pre_cadastro'; payrollNumber: string | null; transportVoucher: boolean;
}
export const statusBadge = (s: Employee['status']) => s === 'ativo' ? <Badge tone="success">Ativo</Badge> : s === 'desligado' ? <Badge tone="danger">Desligado</Badge> : <Badge tone="warning">Aguardando admissão</Badge>;

export default function Employees() {
  const { can } = useAuth(); const nav = useNavigate(); const toast = useToast(); const confirm = useConfirm();
  const [status, setStatus] = useState('todos'); const [dep, setDep] = useState(''); const [pos, setPos] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const deps = useFetch<{ id: number; name: string }[]>('/rh/departments', { active: 'true' });
  const poss = useFetch<{ id: number; name: string }[]>('/rh/positions', { active: 'true' });
  const [act, setAct] = useState<{ kind: 'adm' | 'term'; emp: EmpRef } | null>(null);
  const t = useList<Employee>('/rh/employees', { sort: 'name', filters: { status, departmentId: dep, positionId: pos, admissionFrom: from, admissionTo: to } });

  const remove = async (r: Employee) => {
    if (!(await confirm({ title: 'Excluir funcionário?', message: `${r.fullName} (mat. ${r.registration}) e todo o histórico profissional serão excluídos definitivamente. Uma cópia dos dados fica registrada nos logs de auditoria.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/rh/employees/${r.id}`); toast.success('Funcionário excluído.'); t.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const cols: Col<Employee>[] = [
    { key: 'name', label: 'Nome', sort: 'name', render: (r) => <div><Link to={`/rh/funcionarios/${r.id}`} className="font-semibold hover:text-primary">{r.fullName}</Link><div className="text-xs text-muted-foreground">Mat. {r.registration}{r.payrollNumber ? ` · Folha ${r.payrollNumber}` : ''}</div></div> },
    { key: 'cpf', label: 'CPF', render: (r) => <span className="whitespace-nowrap tabular-nums">{fmtCpf(r.cpf)}</span> },
    { key: 'position', label: 'Cargo', sort: 'position', render: (r) => r.position ?? '—' },
    { key: 'department', label: 'Departamento', sort: 'department', render: (r) => r.department ?? '—' },
    { key: 'admission', label: 'Admissão', sort: 'admission', render: (r) => dmy(r.admissionDate) },
    { key: 'termination', label: 'Desligamento', render: (r) => (r.terminationDate ? <span className="text-danger">{dmy(r.terminationDate)}</span> : '—') },
    { key: 'phone', label: 'Telefone', render: (r) => r.phone ?? '—' },
    { key: 'status', label: 'Situação', sort: 'status', render: (r) => statusBadge(r.status) },
    { key: 'a', label: 'Ações', render: (r) => (
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" onClick={() => nav(`/rh/funcionarios/${r.id}`)} aria-label={`Ver ${r.fullName}`} title="Ver detalhes e histórico"><Eye className="h-4 w-4" /></button>
        {can('rh.edit') && <button className="btn-ghost btn-sm" onClick={() => nav(`/rh/funcionarios/${r.id}/editar`)} aria-label={`Editar ${r.fullName}`}><Pencil className="h-4 w-4" /></button>}
        {can('rh.admit') && r.status !== 'ativo' && <button className="btn-ghost btn-sm text-success" title={r.status === 'desligado' ? 'Readmitir' : 'Admitir'} aria-label={`${r.status === 'desligado' ? 'Readmitir' : 'Admitir'} ${r.fullName}`} onClick={() => setAct({ kind: 'adm', emp: { id: r.id, fullName: r.fullName, status: r.status } })}><UserCheck className="h-4 w-4" /></button>}
        {can('rh.terminate') && r.status === 'ativo' && <button className="btn-ghost btn-sm text-danger" title="Desligar" aria-label={`Desligar ${r.fullName}`} onClick={() => setAct({ kind: 'term', emp: { id: r.id, fullName: r.fullName, status: r.status } })}><UserMinus className="h-4 w-4" /></button>}
        {can('rh.terminate') && r.status !== 'ativo' && <button className="btn-ghost btn-sm text-danger" title="Excluir" aria-label={`Excluir ${r.fullName}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
      </div>) },
  ];
  const addBtn = can('rh.create') && <Link to="/rh/funcionarios/novo" className="btn-primary"><Plus className="h-4 w-4" />Novo funcionário</Link>;

  return (
    <div>
      <PageHeader title="Funcionários" subtitle="Cadastro e controle administrativo de pessoal." actions={addBtn} />
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar nome, CPF, cargo, departamento…" />
        <FilterSelect label="Situação" placeholder="Situação" value={status} onChange={setStatus} options={[{ value: 'ativo', label: 'Ativos' }, { value: 'desligado', label: 'Desligados' }, { value: 'pre_cadastro', label: 'Aguardando admissão' }, { value: 'todos', label: 'Todos' }]} />
        <FilterSelect label="Departamento" placeholder="Todos os departamentos" value={dep} onChange={setDep} options={(deps.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <FilterSelect label="Cargo" placeholder="Todos os cargos" value={pos} onChange={setPos} options={(poss.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <FilterDate label="Admissão de" value={from} onChange={setFrom} /><FilterDate label="até" value={to} onChange={setTo} />
      </FilterBar>
      <DataTable<Employee> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={UserPlus} title={t.q || dep || pos || from || to || status !== 'todos' ? 'Nenhum funcionário encontrado' : 'Nenhum funcionário cadastrado'}
          hint={t.q ? 'Revise a busca ou os filtros.' : 'Comece cadastrando o primeiro funcionário.'} action={addBtn} />} />
      {act?.kind === 'adm' && <AdmissionModal emp={act.emp} onClose={() => setAct(null)} onDone={() => { setAct(null); t.reload(); }} />}
      {act?.kind === 'term' && <TerminationModal emp={act.emp} onClose={() => setAct(null)} onDone={() => { setAct(null); t.reload(); }} />}
    </div>
  );
}
