import { useState } from 'react';
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
      {tab === 'sup' && <LookupPanel cfg={{ title: 'Fornecedores', url: '/est/suppliers', label: 'Fornecedor', ...base }} />}
    </div>
  );
}

export function EstReports() {
  const cats = useFetch<{ id: number; name: string }[]>('/est/categories');
  return <ReportPage cfg={{ base: '/est', title: 'Relatórios de estoque', exportPerm: 'est.export', extra: [{ key: 'categoryId', label: 'Categoria', options: (cats.data ?? []).map((c) => ({ value: c.id, label: c.name })) }] }} />;
}
