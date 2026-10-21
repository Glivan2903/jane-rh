import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Badge, DataTable, Empty, PageHeader, type Col } from '../../components/ui';
import { FilterBar, FilterDate, FilterSelect, SearchBox } from '../../components/forms';
import { useList } from '../../lib/hooks';
import { dmyTime } from '../../lib/format';

interface A { id: number; at: string; userName: string | null; action: string; module: string; entity: string | null; entityId: string | null; result: string; summary: string }

export default function Audit() {
  const [module, setModule] = useState(''); const [result, setResult] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const t = useList<A>('/config/audit', { sort: 'at', dir: 'desc', pageSize: 50, filters: { module, result, from, to } });
  const cols: Col<A>[] = [
    { key: 'at', label: 'Data e hora', sort: 'at', render: (r) => dmyTime(r.at) },
    { key: 'user', label: 'Usuário', sort: 'user', render: (r) => r.userName ?? 'sistema' },
    { key: 'module', label: 'Módulo', sort: 'module', render: (r) => <Badge tone="info">{r.module}</Badge> },
    { key: 'action', label: 'Operação', sort: 'action' },
    { key: 'summary', label: 'Descrição', render: (r) => <span className="text-sm">{r.summary}</span> },
    { key: 'entity', label: 'Registro', render: (r) => (r.entity ? `${r.entity}${r.entityId ? ` #${r.entityId.slice(0, 8)}` : ''}` : '—') },
    { key: 'result', label: 'Resultado', render: (r) => <Badge tone={r.result === 'sucesso' ? 'success' : 'danger'}>{r.result}</Badge> },
  ];
  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Registros imutáveis das operações do sistema. Senhas e segredos nunca são gravados." />
      <FilterBar>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar descrição ou usuário…" />
        <FilterSelect label="Módulo" placeholder="Todos os módulos" value={module} onChange={setModule} options={['auth', 'rh', 'financeiro', 'estoque', 'config'].map((m) => ({ value: m, label: m }))} />
        <FilterSelect label="Resultado" placeholder="Qualquer resultado" value={result} onChange={setResult} options={[{ value: 'sucesso', label: 'Sucesso' }, { value: 'falha', label: 'Falha' }]} />
        <div className="grid grid-cols-2 gap-2"><FilterDate label="De" value={from} onChange={setFrom} /><FilterDate label="Até" value={to} onChange={setTo} /></div>
      </FilterBar>
      <DataTable<A> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list} empty={<Empty icon={ScrollText} title="Nenhum registro de auditoria" />} />
    </div>
  );
}
