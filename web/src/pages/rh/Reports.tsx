import { ReportPage } from '../Report';
import { useFetch } from '../../lib/hooks';

export default function RhReports() {
  const deps = useFetch<{ id: number; name: string }[]>('/rh/departments');
  const poss = useFetch<{ id: number; name: string }[]>('/rh/positions');
  return <ReportPage cfg={{
    base: '/rh', title: 'Relatórios de RH', exportPerm: 'rh.export',
    extra: [
      { key: 'departmentId', label: 'Departamento', options: (deps.data ?? []).map((d) => ({ value: d.id, label: d.name })) },
      { key: 'positionId', label: 'Cargo', options: (poss.data ?? []).map((d) => ({ value: d.id, label: d.name })) },
      { key: 'status', label: 'Situação', options: [{ value: 'ativo', label: 'Ativos' }, { value: 'desligado', label: 'Desligados' }, { value: 'pre_cadastro', label: 'Aguardando admissão' }] },
    ],
  }} />;
}
