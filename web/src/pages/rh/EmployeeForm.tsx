import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { FInput, FSelect, FTextarea, FYesNo, Section, SubmitButton } from '../../components/forms';
import { api } from '../../lib/api';
import { useAuth, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import { maskCep, maskCpf, maskPhone, onlyDigits, validCpf } from '../../lib/format';

const CONTRACTS = ['CLT', 'PJ', 'Estágio', 'Temporário', 'Aprendiz', 'Autônomo', 'Outro'];
const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const str = (v: unknown) => (v == null ? '' : String(v));

const blank = {
  fullName: '', cpf: '', pisPasep: '', payrollNumber: '', identifierNumber: '', transportVoucher: false, registration: '', birthDate: '', gender: '', maritalStatus: '',
  phone: '', phoneAlt: '', email: '', zip: '', street: '', number: '', complement: '', district: '', city: '', state: '', notes: '',
  positionId: '', departmentId: '', contractType: '', admissionDate: '', salary: '', workload: '', managerId: '', corporateEmail: '', corporatePhone: '', professionalNotes: '',
};

export default function EmployeeForm() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast(); const { can } = useAuth();
  const editing = !!id;
  const f = useForm({ ...blank });
  const cur = useFetch<Record<string, unknown>>(id ? `/rh/employees/${id}` : null);
  const deps = useFetch<{ id: number; name: string }[]>('/rh/departments', { active: 'true' });
  const poss = useFetch<{ id: number; name: string }[]>('/rh/positions', { active: 'true' });

  useEffect(() => {
    if (!cur.data) return;
    const d = cur.data;
    f.setV(Object.fromEntries(Object.keys(blank).map((k) => [k, k === 'transportVoucher' ? !!d[k] : k === 'cpf' ? maskCpf(str(d[k])) : str(d[k])])) as typeof blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.data]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (f.v.fullName.trim().split(/\s+/).filter(Boolean).length < 2) e.fullName = 'Informe nome e sobrenome';
    if (!validCpf(f.v.cpf)) e.cpf = 'CPF inválido';
    if (onlyDigits(f.v.phone).length < 10) e.phone = 'Informe o telefone com DDD';
    if (f.v.email && !/^\S+@\S+\.\S+$/.test(f.v.email)) e.email = 'E-mail inválido';
    if (f.v.corporateEmail && !/^\S+@\S+\.\S+$/.test(f.v.corporateEmail)) e.corporateEmail = 'E-mail inválido';
    if (f.v.zip && onlyDigits(f.v.zip).length !== 8) e.zip = 'CEP deve ter 8 dígitos';
    if (f.v.pisPasep && (onlyDigits(f.v.pisPasep).length < 10 || onlyDigits(f.v.pisPasep).length > 12)) e.pisPasep = 'PIS/PASEP deve ter de 10 a 12 dígitos';
    if (f.v.salary && Number(f.v.salary) < 0) e.salary = 'Valor inválido';
    return e;
  };

  const lookupCep = async () => {
    const z = onlyDigits(f.v.zip);
    if (z.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${z}/json/`); const d = await r.json();
      if (!d.erro) f.setV((s) => ({ ...s, street: s.street || d.logradouro || '', district: s.district || d.bairro || '', city: s.city || d.localidade || '', state: s.state || d.uf || '' }));
    } catch { /* preenchimento manual */ }
  };

  if (editing && cur.loading) return <div className="p-10 text-center"><Spinner className="mx-auto h-6 w-6" /></div>;
  if (cur.error) return <ErrorBox message={cur.error} onRetry={cur.reload} />;

  const opts = (l: { id: number; name: string }[] | null) => (l ?? []).map((x) => ({ value: x.id, label: x.name }));
  const showSalary = can('rh.salary');

  return (
    <div>
      <PageHeader back={editing ? `/rh/funcionarios/${id}` : '/rh/funcionarios'} title={editing ? 'Editar funcionário' : 'Novo funcionário'} subtitle={editing ? 'Alterações relevantes são registradas no histórico.' : 'Preencha ao menos nome, CPF e telefone. A data de admissão é opcional: sem ela, o cadastro fica aguardando admissão.'} />
      <form className="card p-5" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(async () => {
          const body = { ...f.v, cpf: onlyDigits(f.v.cpf), salary: f.v.salary === '' ? null : Number(f.v.salary), ...(editing ? { admissionDate: undefined } : {}) };
          const r = editing ? await api.put<{ ok: true }>(`/rh/employees/${id}`, body) : await api.post<{ id: string }>('/rh/employees', body);
          toast.success(editing ? 'Funcionário atualizado.' : 'Funcionário cadastrado.');
          nav(editing ? `/rh/funcionarios/${id}` : `/rh/funcionarios/${(r as { id: string }).id}`);
        }, validate);
        void ok;
      }}>
        <Section title="Dados pessoais">
          <FInput f={f} name="fullName" label="Nome completo" required className="lg:col-span-2" autoFocus />
          <FInput f={f} name="cpf" label="CPF" required mask={maskCpf} placeholder="000.000.000-00" />
          <FInput f={f} name="birthDate" label="Data de nascimento" type="date" />
          <FSelect f={f} name="gender" label="Sexo" options={['Masculino', 'Feminino', 'Outro', 'Não informado'].map((x) => ({ value: x, label: x }))} />
          <FSelect f={f} name="maritalStatus" label="Estado civil" options={['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'].map((x) => ({ value: x, label: x }))} />
          <FInput f={f} name="pisPasep" label="Nº PIS/PASEP" mask={onlyDigits} hint="Somente números." />
          <FInput f={f} name="phone" label="Telefone principal" required mask={maskPhone} placeholder="(00) 00000-0000" />
          <FInput f={f} name="phoneAlt" label="Telefone alternativo" mask={maskPhone} />
          <FInput f={f} name="email" label="E-mail pessoal" type="email" />
        </Section>
        <Section title="Endereço">
          <div onBlur={lookupCep}><FInput f={f} name="zip" label="CEP" mask={maskCep} placeholder="00000-000" hint="Preenche o endereço automaticamente (ViaCEP)." /></div>
          <FInput f={f} name="street" label="Endereço" className="lg:col-span-2" />
          <FInput f={f} name="number" label="Número" /><FInput f={f} name="complement" label="Complemento" /><FInput f={f} name="district" label="Bairro" />
          <FInput f={f} name="city" label="Cidade" />
          <FSelect f={f} name="state" label="Estado" options={UFS.map((u) => ({ value: u, label: u }))} placeholder="UF" />
          <FTextarea f={f} name="notes" label="Observações gerais" className="sm:col-span-2 lg:col-span-3" />
        </Section>
        <Section title="Dados profissionais">
          <FInput f={f} name="registration" label="Matrícula interna" hint={editing ? undefined : 'Deixe em branco para gerar automaticamente.'} disabled={editing} />
          <FInput f={f} name="payrollNumber" label="Nº Folha" />
          <FInput f={f} name="identifierNumber" label="Nº Identificador" />
          <FSelect f={f} name="positionId" label="Cargo" options={opts(poss.data)} />
          <FSelect f={f} name="departmentId" label="Departamento / setor" options={opts(deps.data)} />
          <FSelect f={f} name="contractType" label="Tipo de vínculo" options={CONTRACTS.map((x) => ({ value: x, label: x }))} />
          {!editing && <FInput f={f} name="admissionDate" label="Data de admissão" type="date" hint="Preencha para já registrar a admissão." />}
          {showSalary && <FInput f={f} name="salary" label="Salário contratual (R$)" type="number" step="0.01" min="0" hint="Acesso restrito." />}
          <FInput f={f} name="workload" label="Jornada de trabalho" placeholder="Ex.: 44h semanais" />
          <FInput f={f} name="corporateEmail" label="E-mail corporativo" type="email" />
          <FInput f={f} name="corporatePhone" label="Telefone corporativo" mask={maskPhone} />
          <FYesNo f={f} name="transportVoucher" label="Optante por vale-transporte?" />
          <FTextarea f={f} name="professionalNotes" label="Observações profissionais" className="sm:col-span-2 lg:col-span-3" />
        </Section>
        <div className="flex justify-end gap-2 border-t pt-4">
          <button type="button" className="btn-outline" onClick={() => nav(-1)}>Cancelar</button>
          <SubmitButton busy={f.busy}>{editing ? 'Salvar alterações' : 'Cadastrar funcionário'}</SubmitButton>
        </div>
      </form>
    </div>
  );
}
