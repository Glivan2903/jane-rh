import { ReportPage } from '../Report';
import { useFetch } from '../../lib/hooks';

const TX = ['receitas', 'despesas', 'a-pagar', 'a-receber', 'vencidas'];
const WITH_ACCOUNT = [...TX, 'fluxo-caixa', 'despesas-categoria', 'receitas-categoria', 'centros-custo', 'historico', 'por-cadastro', 'resultado'];

export default function FinReports() {
  const cats = useFetch<{ id: number; name: string; type: string }[]>('/fin/categories');
  const accs = useFetch<{ accounts: { id: number; name: string }[] }>('/fin/accounts');
  const ccs = useFetch<{ id: number; name: string }[]>('/fin/cost-centers');
  const parties = useFetch<{ id: number; name: string }[]>('/cad/parties/options');
  return <ReportPage cfg={{
    base: '/fin', title: 'Relatórios financeiros', exportPerm: 'fin.export',
    extra: [
      { key: 'categoryId', label: 'Categoria', only: [...TX, 'despesas-categoria', 'receitas-categoria', 'historico'], options: (cats.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.type})` })) },
      { key: 'status', label: 'Situação', only: TX, options: ['prevista', 'vencida', 'recebida', 'paga', 'cancelada'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
      { key: 'accountId', label: 'Conta', only: [...WITH_ACCOUNT, 'saldo-contas', 'extrato-conta', 'transferencias', 'conciliacao', 'fluxo-projetado'], options: (accs.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name })) },
      { key: 'costCenterId', label: 'Centro de custo', only: WITH_ACCOUNT, options: [{ value: 'none', label: 'Sem centro de custo' }, ...(ccs.data ?? []).map((c) => ({ value: c.id, label: c.name }))] },
      { key: 'partyId', label: 'Cliente / fornecedor', only: WITH_ACCOUNT, options: (parties.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'days', label: 'Horizonte', only: ['fluxo-projetado'], options: [{ value: 30, label: '30 dias' }, { value: 60, label: '60 dias' }, { value: 90, label: '90 dias' }] },
      { key: 'lineStatus', label: 'Situação da linha', only: ['conciliacao'], options: [{ value: 'pendente', label: 'Pendentes' }, { value: 'conciliado', label: 'Conciliadas' }, { value: 'ignorado', label: 'Ignoradas' }] },
    ],
  }} />;
}
