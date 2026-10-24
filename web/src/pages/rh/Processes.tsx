import { useEffect, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { Modal, Tabs } from '../../components/ui';
import { FInput, FSelect, FTextarea } from '../../components/forms';
import { api } from '../../lib/api';
import { useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import { dmy, todayIso } from '../../lib/format';
import { LookupPanel } from '../Lookup';
import { DocTypesPanel } from './DocTypes';

export interface EmpRef { id: string; fullName: string; status: 'ativo' | 'desligado' | 'pre_cadastro' }
const CONTRACTS = ['CLT', 'PJ', 'Estágio', 'Temporário', 'Aprendiz', 'Autônomo', 'Outro'];
const REASONS = ['Pedido de demissão', 'Dispensa sem justa causa', 'Dispensa por justa causa', 'Término de contrato', 'Acordo entre as partes', 'Aposentadoria', 'Falecimento', 'Outro'];

/** Admissão / readmissão feita no próprio cadastro do profissional. */
export function AdmissionModal({ emp, onClose, onDone }: { emp: EmpRef; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const confirm = useConfirm(); const { can } = useAuth();
  const re = emp.status === 'desligado';
  const deps = useFetch<{ id: number; name: string }[]>('/rh/departments', { active: 'true' });
  const poss = useFetch<{ id: number; name: string }[]>('/rh/positions', { active: 'true' });
  const cur = useFetch<Record<string, string | number | null>>(`/rh/employees/${emp.id}`);
  const f = useForm({ employeeId: emp.id, admissionDate: todayIso(), positionId: '', departmentId: '', contractType: 'CLT', salary: '', notes: '' });
  useEffect(() => {
    const d = cur.data; if (!d) return;
    f.setV((s) => ({ ...s, positionId: String(d.positionId ?? ''), departmentId: String(d.departmentId ?? ''), contractType: String(d.contractType ?? 'CLT'), salary: d.salary != null ? String(d.salary) : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.data]);
  return (
    <Modal title={`${re ? 'Readmitir' : 'Admitir'} — ${emp.fullName}`} size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="adm" className="btn-primary" disabled={f.busy}><UserPlus className="h-4 w-4" />Confirmar {re ? 'readmissão' : 'admissão'}</button></>}>
      <form id="adm" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!f.v.admissionDate || !f.v.positionId || !f.v.departmentId) { f.setErr({ ...(!f.v.admissionDate ? { admissionDate: 'Informe a data' } : {}), ...(!f.v.positionId ? { positionId: 'Selecione o cargo' } : {}), ...(!f.v.departmentId ? { departmentId: 'Selecione o departamento' } : {}) }); return; }
        if (!(await confirm({ title: `Confirmar ${re ? 'readmissão' : 'admissão'}?`, message: `${emp.fullName} ficará ativo a partir de ${dmy(f.v.admissionDate)}. A operação é registrada no histórico.`, confirmLabel: 'Confirmar' }))) return;
        const ok = await f.submit(() => api.post('/rh/admissions', { ...f.v, salary: f.v.salary === '' ? null : Number(f.v.salary) }));
        if (ok) { toast.success(re ? 'Readmissão registrada.' : 'Admissão registrada.'); onDone(); }
      }}>
        <FInput f={f} name="admissionDate" label="Data de admissão" type="date" required max={todayIso()} autoFocus />
        <FSelect f={f} name="contractType" label="Tipo de vínculo" required options={CONTRACTS.map((c) => ({ value: c, label: c }))} />
        <FSelect f={f} name="positionId" label="Cargo" required options={(poss.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <FSelect f={f} name="departmentId" label="Departamento" required options={(deps.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        {can('rh.salary') && <FInput f={f} name="salary" label="Salário (R$)" type="number" step="0.01" min="0" />}
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

/** Desligamento feito no próprio cadastro do profissional. */
export function TerminationModal({ emp, onClose, onDone }: { emp: EmpRef; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const confirm = useConfirm();
  const f = useForm({ employeeId: emp.id, terminationDate: todayIso(), reason: '', notes: '' });
  return (
    <Modal title={`Desligar — ${emp.fullName}`} size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="trm" className="btn-danger" disabled={f.busy}><UserMinus className="h-4 w-4" />Registrar desligamento</button></>}>
      <form id="trm" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!f.v.terminationDate || !f.v.reason) { f.setErr({ ...(!f.v.terminationDate ? { terminationDate: 'Informe a data' } : {}), ...(!f.v.reason ? { reason: 'Informe o motivo' } : {}) }); return; }
        if (!(await confirm({ title: 'Confirmar desligamento?', message: `${emp.fullName} será marcado como desligado em ${dmy(f.v.terminationDate)}. Os dados são preservados e a operação fica no histórico.`, confirmLabel: 'Confirmar desligamento', danger: true }))) return;
        const ok = await f.submit(() => api.post('/rh/terminations', f.v));
        if (ok) { toast.success('Desligamento registrado.'); onDone(); }
      }}>
        <FInput f={f} name="terminationDate" label="Data de desligamento" type="date" required max={todayIso()} autoFocus />
        <FSelect f={f} name="reason" label="Motivo" required options={REASONS.map((r) => ({ value: r, label: r }))} />
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

export function RhCatalogs() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'dep' | 'pos' | 'doc'>('dep');
  const base = { create: 'rh.create', edit: 'rh.edit', inactivate: 'rh.inactivate' };
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'dep', label: 'Departamentos' }, { id: 'pos', label: 'Cargos' }, ...(can('rh.documents') ? [{ id: 'doc' as const, label: 'Tipos de documento' }] : [])]} />
      {tab === 'doc' ? <DocTypesPanel /> : tab === 'dep'
        ? <LookupPanel cfg={{ title: 'Departamentos', subtitle: 'Setores usados nos cadastros de funcionários.', url: '/rh/departments', label: 'Departamento', ...base }} />
        : <LookupPanel cfg={{ title: 'Cargos', subtitle: 'Cargos usados nos cadastros de funcionários.', url: '/rh/positions', label: 'Cargo', ...base }} />}
    </div>
  );
}
