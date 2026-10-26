import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AdmissionModal, TerminationModal } from './Processes';
import { Briefcase, FilePlus2, Pencil, Repeat, UserCheck, UserMinus, UserPlus, Wrench } from 'lucide-react';
import { Badge, ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { useAuth } from '../../lib/app';
import { useFetch } from '../../lib/hooks';
import { brl, dmy, dmyTime, fmtCpf } from '../../lib/format';
import { statusBadge, type Employee } from './Employees';
import { EmployeeDocuments } from './EmployeeDocuments';

type Full = Employee & Record<string, string | boolean | null>;
interface Ev { id: number; at: string; eventType: string; description: string; userName: string | null }

const EV: Record<string, { icon: typeof Pencil; label: string; tone: string }> = {
  cadastro: { icon: FilePlus2, label: 'Cadastro', tone: 'bg-info/15 text-info' },
  admissao: { icon: UserPlus, label: 'Admissão', tone: 'bg-success/15 text-success' },
  alteracao: { icon: Pencil, label: 'Alteração cadastral', tone: 'bg-muted text-muted-foreground' },
  mudanca_cargo: { icon: Briefcase, label: 'Mudança de cargo', tone: 'bg-accent/20 text-accent' },
  mudanca_departamento: { icon: Repeat, label: 'Mudança de departamento', tone: 'bg-accent/20 text-accent' },
  contratual: { icon: Wrench, label: 'Alteração contratual', tone: 'bg-warning/15 text-warning' },
  desligamento: { icon: UserMinus, label: 'Desligamento', tone: 'bg-danger/15 text-danger' },
};

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (<div><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-sm font-medium">{v || '—'}</dd></div>);

export default function EmployeeDetail() {
  const { id } = useParams(); const { can } = useAuth();
  const e = useFetch<Full>(`/rh/employees/${id}`);
  const h = useFetch<Ev[]>(`/rh/employees/${id}/history`);
  const [modal, setModal] = useState<'adm' | 'term' | null>(null);
  const done = () => { setModal(null); e.reload(); h.reload(); };
  if (e.error) return <ErrorBox message={e.error} onRetry={e.reload} />;
  const d = e.data;
  if (!d) return <div className="space-y-3"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-64" /></div>;
  const addr = [d.street, d.number, d.complement, d.district, [d.city, d.state].filter(Boolean).join('/'), d.zip].filter(Boolean).join(', ');

  return (
    <div>
      <PageHeader back="/rh/funcionarios" title={d.fullName as string} subtitle={`Matrícula ${d.registration}`}
        actions={<>
          {statusBadge(d.status)}
          {can('rh.edit') && <Link to={`/rh/funcionarios/${id}/editar`} className="btn-outline"><Pencil className="h-4 w-4" />Editar</Link>}
          {can('rh.admit') && d.status !== 'ativo' && <button className="btn-primary" onClick={() => setModal('adm')}><UserCheck className="h-4 w-4" />{d.status === 'desligado' ? 'Readmitir' : 'Admitir'}</button>}
          {can('rh.terminate') && d.status === 'ativo' && <button className="btn-danger" onClick={() => setModal('term')}><UserMinus className="h-4 w-4" />Desligar</button>}
        </>} />
      <section aria-label="Situação do vínculo" className={`card mb-4 grid gap-4 border-l-4 p-4 sm:grid-cols-2 lg:grid-cols-4 ${d.status === 'ativo' ? 'border-l-success' : d.status === 'desligado' ? 'border-l-danger' : 'border-l-warning'}`}>
        <div><p className="text-xs text-muted-foreground">Situação</p><div className="mt-1">{statusBadge(d.status)}</div></div>
        <div><p className="text-xs text-muted-foreground">Data de admissão</p><p className="mt-1 text-sm font-semibold">{d.admissionDate ? dmy(d.admissionDate as string) : 'Aguardando admissão'}</p></div>
        <div><p className="text-xs text-muted-foreground">Data de desligamento</p><p className="mt-1 text-sm font-semibold">{d.terminationDate ? dmy(d.terminationDate as string) : '—'}</p></div>
        <div><p className="text-xs text-muted-foreground">Motivo do desligamento</p><p className="mt-1 text-sm font-semibold">{(d.terminationReason as string) || '—'}</p></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-5"><h2 className="mb-3 font-display font-bold">Dados pessoais</h2>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Row k="CPF" v={fmtCpf(d.cpf)} /><Row k="PIS/PASEP" v={d.pisPasep} /><Row k="Nascimento" v={d.birthDate ? dmy(d.birthDate as string) : ''} />
              <Row k="Sexo" v={d.gender} /><Row k="Estado civil" v={d.maritalStatus} /><Row k="Telefone" v={d.phone} />
              <Row k="Telefone alternativo" v={d.phoneAlt} /><Row k="E-mail" v={d.email} /><div className="sm:col-span-3"><Row k="Endereço" v={addr} /></div>
              <div className="sm:col-span-3"><Row k="Observações" v={d.notes} /></div>
            </dl></section>
          <section className="card p-5"><h2 className="mb-3 font-display font-bold">Dados profissionais</h2>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Row k="Cargo" v={d.position} /><Row k="Departamento" v={d.department} /><Row k="Vínculo" v={d.contractType} />
              <Row k="Admissão" v={dmy(d.admissionDate as string)} /><Row k="Nº Folha" v={d.payrollNumber} /><Row k="Nº Identificador" v={d.identifierNumber} /><Row k="CBO" v={d.cbo} /><Row k="eSocial" v={d.esocial} /><Row k="Carteira de trabalho" v={d.ctps} />
              <Row k="Vale-transporte" v={<Badge tone={d.transportVoucher ? 'success' : 'neutral'}>{d.transportVoucher ? 'Optante' : 'Não optante'}</Badge>} />
              {d.salary !== undefined && <Row k="Salário" v={d.salary != null ? brl(d.salary) : ''} />}
              <Row k="Jornada" v={d.workload} /><Row k="E-mail corporativo" v={d.corporateEmail} />
              <Row k="Telefone corporativo" v={d.corporatePhone} />
              {d.status === 'desligado' && <><Row k="Desligamento" v={dmy(d.terminationDate as string)} /><div className="sm:col-span-2"><Row k="Motivo" v={d.terminationReason} /></div></>}
              <div className="sm:col-span-3"><Row k="Observações profissionais" v={d.professionalNotes} /></div>
            </dl></section>
          {can('rh.documents') && <EmployeeDocuments employeeId={id!} />}
        </div>
        <section className="card p-5"><h2 className="mb-4 font-display font-bold">Histórico</h2>
          {h.loading ? <Skeleton className="h-40" /> : h.error ? <ErrorBox message={h.error} onRetry={h.reload} /> : (
            <ol className="relative space-y-5 border-l pl-6">
              {(h.data ?? []).map((ev) => { const m = EV[ev.eventType] ?? EV.alteracao; const Icon = m.icon; return (
                <li key={ev.id} className="relative">
                  <span className={`absolute -left-[37px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-card ${m.tone}`}><Icon className="h-3.5 w-3.5" /></span>
                  <p className="text-sm font-semibold">{m.label}</p><p className="text-sm text-muted-foreground">{ev.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{dmyTime(ev.at)} · {ev.userName ?? 'sistema'}</p>
                </li>); })}
            </ol>)}
        </section>
      </div>
      {modal === 'adm' && <AdmissionModal emp={{ id: id!, fullName: d.fullName as string, status: d.status }} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'term' && <TerminationModal emp={{ id: id!, fullName: d.fullName as string, status: d.status }} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
