import { useRef, useState } from 'react';
import { Link2, Undo2, Upload, EyeOff, FilePlus2, FileSpreadsheet } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, Tabs, type Col } from '../../components/ui';
import { FInput, FSelect } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm, useList } from '../../lib/hooks';
import { brl, dmy } from '../../lib/format';
import type { Account } from './Accounts';

interface Suggestion { id: string; type: string; description: string; party: string | null; amount: string; dueDate: string; settledDate: string | null; storedStatus: string }
interface Line {
  id: number; fitid: string; postedDate: string; amount: string; memo: string | null; status: 'pendente' | 'conciliado' | 'ignorado';
  transactionId: string | null; transactionDescription: string | null; suggestions: Suggestion[];
}

function CreateModal({ line, onClose, onDone }: { line: Line; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const type = Number(line.amount) > 0 ? 'receita' : 'despesa';
  const cats = useFetch<{ id: number; name: string }[]>('/fin/categories', { type, active: 'true' });
  const f = useForm({ categoryId: '', description: line.memo ?? '' });
  return (
    <Modal title="Criar lançamento a partir do extrato" size="sm" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="rcf" className="btn-primary" disabled={f.busy}>Criar e conciliar</button></>}>
      <form id="rcf" className="space-y-3" noValidate onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => api.post(`/fin/statement/${line.id}/create`, f.v), () => ({ categoryId: f.v.categoryId ? undefined : 'Selecione a categoria' }));
        if (ok) { toast.success('Lançamento criado e conciliado.'); onDone(); }
      }}>
        <p className="rounded-lg bg-muted p-3 text-sm"><b>{line.memo ?? 'Linha do extrato'}</b><br />{dmy(line.postedDate)} · {type === 'receita' ? 'Entrada' : 'Saída'} de {brl(Math.abs(Number(line.amount)))}</p>
        <FSelect f={f} name="categoryId" label={`Categoria de ${type}`} required options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FInput f={f} name="description" label="Descrição" />
        <p className="text-xs text-muted-foreground">O lançamento já nasce {type === 'receita' ? 'recebido' : 'pago'} na data do extrato e nesta conta.</p>
      </form>
    </Modal>
  );
}

export default function Reconcile() {
  const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const accs = useFetch<{ accounts: Account[] }>('/fin/accounts', { active: 'true' });
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState<'pendente' | 'conciliado' | 'ignorado'>('pendente');
  const [create, setCreate] = useState<Line | null>(null); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const manage = can('fin.accounts');
  const st = useList<Line>(`/fin/accounts/${accountId}/statement`, { sort: 'date', dir: 'desc', pageSize: 20, filters: { status }, enabled: !!accountId });
  const counts = (st.extra as unknown as { counts?: Record<string, number> } | null)?.counts ?? {};

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); st.reload(); accs.reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const onFile = async (fl: File | undefined) => {
    if (!fl || !accountId) return;
    const fd = new FormData(); fd.append('file', fl);
    setBusy(true);
    try {
      const r = await api.upload<{ imported: number; duplicates: number; total: number }>(`/fin/accounts/${accountId}/ofx`, fd);
      toast.success(`${r.imported} linha(s) importada(s)${r.duplicates ? `, ${r.duplicates} já existiam` : ''}.`);
      setStatus('pendente'); st.reload(); accs.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };

  const match = (l: Line, s: Suggestion) => act(() => api.post(`/fin/statement/${l.id}/match`, { transactionId: s.id, settle: true }),
    s.storedStatus === 'pendente' ? 'Conciliado e baixa registrada.' : 'Conciliado.');
  const ignore = async (l: Line) => {
    if (!(await confirm({ title: 'Ignorar esta linha?', message: `"${l.memo ?? 'Linha do extrato'}" deixa de aparecer como pendente. Dá para desfazer depois.`, confirmLabel: 'Ignorar' }))) return;
    act(() => api.post(`/fin/statement/${l.id}/ignore`, {}), 'Linha ignorada.');
  };

  const cols: Col<Line>[] = [
    { key: 'date', label: 'Data', sort: 'date', render: (r) => dmy(r.postedDate) },
    { key: 'memo', label: 'Descrição no extrato', render: (r) => <span className="font-medium">{r.memo ?? '—'}</span> },
    { key: 'amount', label: 'Valor', sort: 'amount', className: 'text-right tabular-nums', render: (r) => <span className={Number(r.amount) < 0 ? 'text-danger' : 'text-success'}>{brl(r.amount)}</span> },
    { key: 'match', label: status === 'pendente' ? 'Sugestões' : 'Situação', render: (r) => r.status === 'pendente' ? (
      <div className="space-y-1">
        {r.suggestions.length === 0 && <span className="text-xs text-muted-foreground">Nenhum lançamento com o mesmo valor e data próxima.</span>}
        {r.suggestions.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 basis-40"><b>{s.description}</b>{s.party && ` · ${s.party}`} · venc. {dmy(s.dueDate)} {s.storedStatus === 'pendente' ? <Badge tone="info">Pendente</Badge> : <Badge tone="success">Baixado</Badge>}</span>
            {manage && <button className="btn-outline btn-sm" disabled={busy} onClick={() => match(r, s)}><Link2 className="h-3.5 w-3.5" />Conciliar</button>}
          </div>))}
      </div>) : r.status === 'conciliado' ? <span className="text-xs">Conciliado com <b>{r.transactionDescription}</b></span> : <Badge>Ignorada</Badge> },
    { key: 'a', label: '', className: 'text-right', render: (r) => manage && (
      <div className="flex justify-end gap-1">
        {r.status === 'pendente' && can('fin.create') && can('fin.settle') && <button className="btn-ghost btn-sm" title="Criar lançamento" aria-label="Criar lançamento" disabled={busy} onClick={() => setCreate(r)}><FilePlus2 className="h-4 w-4" /></button>}
        {r.status === 'pendente' && <button className="btn-ghost btn-sm" title="Ignorar" aria-label="Ignorar linha" disabled={busy} onClick={() => ignore(r)}><EyeOff className="h-4 w-4" /></button>}
        {r.status !== 'pendente' && <button className="btn-ghost btn-sm" title="Desfazer" aria-label="Desfazer" disabled={busy} onClick={() => act(() => api.post(`/fin/statement/${r.id}/undo`, {}), 'Tratamento desfeito.')}><Undo2 className="h-4 w-4" /></button>}
      </div>) },
  ];

  return (
    <div>
      <PageHeader title="Conciliação bancária" subtitle="Importe o extrato (OFX) e confira cada linha com os lançamentos do sistema."
        actions={manage && accountId && <><input ref={file} type="file" accept=".ofx,.OFX,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn-primary" disabled={busy} onClick={() => file.current?.click()}><Upload className="h-4 w-4" />Importar extrato OFX</button></>} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <select aria-label="Conta" className="input max-w-72" value={accountId} onChange={(e) => { setAccountId(e.target.value); setStatus('pendente'); }}>
          <option value="">Selecione a conta…</option>
          {(accs.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.pendingLines ? ` (${a.pendingLines} pendente(s))` : ''}</option>)}
        </select>
        {accountId && <Tabs value={status} onChange={setStatus} tabs={[
          { id: 'pendente', label: `Pendentes${counts.pendente != null ? ` (${counts.pendente})` : ''}` },
          { id: 'conciliado', label: `Conciliadas${counts.conciliado != null ? ` (${counts.conciliado})` : ''}` },
          { id: 'ignorado', label: `Ignoradas${counts.ignorado != null ? ` (${counts.ignorado})` : ''}` }]} />}
      </div>
      {!accountId ? <Empty icon={FileSpreadsheet} title="Escolha uma conta" hint="Baixe o extrato em OFX no internet banking e importe aqui. Reimportar o mesmo arquivo não duplica linhas." /> : (
        <DataTable<Line> cols={cols} rows={st.rows} loading={st.loading} error={st.error} onRetry={st.reload} list={st.list}
          empty={<Empty icon={FileSpreadsheet} title={status === 'pendente' ? 'Nada pendente de conciliação' : 'Nenhuma linha nesta situação'} hint="Importe um extrato OFX para começar." />} />
      )}
      {create && <CreateModal line={create} onClose={() => setCreate(null)} onDone={() => { setCreate(null); st.reload(); accs.reload(); }} />}
    </div>
  );
}
