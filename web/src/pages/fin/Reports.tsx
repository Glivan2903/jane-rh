import { ReportPage } from '../Report';
import { useFetch } from '../../lib/hooks';

export default function FinReports() {
  const cats = useFetch<{ id: number; name: string; type: string }[]>('/fin/categories');
  return <ReportPage cfg={{
    base: '/fin', title: 'Relatórios financeiros', exportPerm: 'fin.export',
    extra: [
      { key: 'categoryId', label: 'Categoria', options: (cats.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.type})` })) },
      { key: 'status', label: 'Situação', options: ['prevista', 'vencida', 'recebida', 'paga', 'cancelada'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
    ],
  }} />;
}
