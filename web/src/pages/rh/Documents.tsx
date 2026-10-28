import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, FileClock } from 'lucide-react';
import { DataTable, Empty, PageHeader, StatCard, type Col } from '../../components/ui';
import { FilterBar, FilterSelect, SearchBox } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useToast } from '../../lib/app';
import { useFetch, useList, usePersisted } from '../../lib/hooks';
import { dmy } from '../../lib/format';
import { DocBadge, type Doc, type DocType } from './docs';

const STATUS = [{ value: 'atencao', label: 'Vencidos e a vencer' }, { value: 'vencido', label: 'Vencidos' }, { value: 'a_vencer', label: 'A vencer' }, { value: 'valido', label: 'Válidos' }, { value: 'sem_validade', label: 'Sem validade' }, { value: 'todos', label: 'Todos' }];

/** Documentos de todos os funcionários: por padrão mostra o que exige atenção. */
export default function Documents() {
  const [sp] = useSearchParams(); const toast = useToast();
  const [status, setStatus] = usePersisted('rh.docs.status', 'atencao', sp.get('status')); const [typeId, setTypeId] = usePersisted('rh.docs.type', ''); const [es, setEs] = usePersisted('rh.docs.es', 'ativos');
  const types = useFetch<DocType[]>('/rh/document-types');
  const sum = useFetch<{ vencidos: number; aVencer: number; total: number }>('/rh/documents/summary');
  const t = useList<Doc>('/rh/documents', { sort: 'expiresAt', persistKey: 'rh.docs', filters: { status, typeId, employeeStatus: es } });
  const cols: Col<Doc>[] = [
    { key: 'employee', label: 'Funcionário', sort: 'employee', render: (r) => <Link to={`/rh/funcionarios/${r.employeeId}`} className="font-semibold text-primary hover:underline">{r.employeeName}</Link> },
    { key: 'type', label: 'Documento', sort: 'type', render: (r) => <div>{r.title || r.type}{r.title && <div className="text-xs text-muted-foreground">{r.type}</div>}</div> },
    { key: 'expiresAt', label: 'Validade', sort: 'expiresAt', render: (r) => (r.expiresAt ? dmy(r.expiresAt) : '—') },
    { key: 'status', label: 'Situação', render: (r) => <DocBadge d={r} /> },
    { key: 'a', label: '', className: 'text-right', render: (r) => r.fileName && <button className="btn-ghost btn-sm" aria-label={`Baixar ${r.fileName}`} title="Baixar" onClick={() => api.download(`/rh/documents/${r.id}/file`, {}, r.fileName!).catch((e) => toast.error(errMsg(e)))}><Download className="h-4 w-4" /></button> },
  ];
  return (
    <div>
      <PageHeader title="Documentos dos funcionários" subtitle="Acompanhe vencimentos de ASO, contratos e certificados. Para adicionar um documento, abra a ficha do funcionário." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vencidos" value={sum.data?.vencidos ?? 0} format={(n) => String(n)} icon={AlertTriangle} tone={sum.data?.vencidos ? 'danger' : 'success'} />
        <StatCard label="A vencer" value={sum.data?.aVencer ?? 0} format={(n) => String(n)} icon={FileClock} tone={sum.data?.aVencer ? 'warning' : 'success'} hint="dentro do prazo de aviso do tipo" />
      </div>
      <FilterBar dirty={!!(t.q || status !== 'atencao' || typeId || es !== 'ativos')} onClear={() => { t.setQ(''); setStatus('atencao'); setTypeId(''); setEs('ativos'); }}>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar funcionário ou documento…" />
        <FilterSelect label="Situação" placeholder="Situação" value={status} onChange={setStatus} options={STATUS} />
        <FilterSelect label="Tipo" placeholder="Todos os tipos" value={typeId} onChange={setTypeId} options={(types.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <FilterSelect label="Funcionários" placeholder="Funcionários" value={es} onChange={setEs} options={[{ value: 'ativos', label: 'Não desligados' }, { value: 'desligado', label: 'Desligados' }, { value: 'todos', label: 'Todos' }]} />
      </FilterBar>
      <DataTable<Doc> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={FileClock} title={status === 'atencao' ? 'Nenhum documento vencido ou a vencer' : 'Nenhum documento encontrado'} hint="Tudo em dia. Ajuste os filtros para ver os demais documentos." />} />
    </div>
  );
}
