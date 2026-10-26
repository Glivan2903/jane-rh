import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tabs } from '../../components/ui';
import { LookupPanel } from '../Lookup';
import { ReportPage } from '../Report';
import { useFetch } from '../../lib/hooks';

const base = { create: 'est.create', edit: 'est.edit', inactivate: 'est.inactivate' };

export function EstCatalogs() {
  const [tab, setTab] = useState<'cat' | 'un' | 'sup'>('cat');
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'cat', label: 'Categorias de produto' }, { id: 'un', label: 'Unidades de medida' }, { id: 'sup', label: 'Fornecedores' }]} />
      {tab === 'cat' && <LookupPanel cfg={{ title: 'Categorias de produto', url: '/est/categories', label: 'Categoria', ...base }} />}
      {tab === 'un' && <LookupPanel cfg={{ title: 'Unidades de medida', subtitle: 'Ex.: unidade, caixa, pacote, litro, quilo e metro.', url: '/est/units', label: 'Unidade', hasCode: true, ...base }} />}
      {tab === 'sup' && (
        <div className="card p-6 text-sm">
          <p className="font-display text-lg font-bold">Fornecedores</p>
          <p className="mt-1 text-muted-foreground">Clientes e fornecedores agora têm um cadastro único, usado no estoque e no financeiro. Os fornecedores que já existiam foram mantidos.</p>
          <Link to="/cadastros/parceiros" className="btn-primary mt-4 inline-flex">Abrir clientes e fornecedores</Link>
        </div>
      )}
    </div>
  );
}

export function EstReports() {
  const cats = useFetch<{ id: number; name: string }[]>('/est/categories');
  return <ReportPage cfg={{ base: '/est', title: 'Relatórios de estoque', exportPerm: 'est.export', extra: [{ key: 'categoryId', label: 'Categoria', options: (cats.data ?? []).map((c) => ({ value: c.id, label: c.name })) }] }} />;
}
