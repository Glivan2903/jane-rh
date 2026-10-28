import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, CheckCheck, Paperclip, Pencil, Plus, Trash2, Undo2, Wallet } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, type Col, type Tone } from '../../components/ui';
import { FCheck, FilterBar, FilterDate, FilterSelect, FInput, FSelect, FTextarea, SearchBox, SubmitButton } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm, useList, usePersisted } from '../../lib/hooks';
import { brl, dmy, newKey, todayIso } from '../../lib/format';

export interface Tx {
  id: string; type: 'receita' | 'despesa'; description: string; categoryId: number; category: string; party: string | null; partyId: number | null; accountId: number | null; account: string | null; costCenterId: number | null; costCenter: string | null; amount: string; interestRate?: string; competenceDate: string;
  dueDate: string; settledDate: string | null; method: string | null; status: string; notes: string | null; attachmentName: string | null; storedStatus: string;
}
export const METHODS = ['Dinheiro', 'PIX', 'Transferência', 'Boleto', 'Cartão de crédito', 'Cartão de débito', 'Cheque', 'Outro'];
const TONE: Record<string, Tone> = { prevista: 'info', vencida: 'danger', recebida: 'success', paga: 'success', cancelada: 'neutral' };
const LABEL: Record<string, string> = { prevista: 'Prevista', vencida: 'Vencida', recebida: 'Recebida', paga: 'Paga', cancelada: 'Cancelada' };

function TxForm({ type, row, onClose, onSaved }: { type: 'receita' | 'despesa'; row: Tx | null; onClose: () => void; onSaved: () => void }) {
  const isR = type === 'receita'; const { can } = useAuth(); const toast = useToast();
  const cats = useFetch<{ id: number; name: string }[]>('/fin/categories', { type, active: 'true' });
  const accounts = useFetch<{ accounts: { id: number; name: string; isDefault: boolean }[] }>('/fin/accounts', { active: 'true' });
  const centers = useFetch<{ id: number; name: string }[]>('/fin/cost-centers', { active: 'true' });
  const parties = useFetch<{ id: number; name: string }[]>('/cad/parties/options', { kind: isR ? 'customer' : 'supplier' });
  const f = useForm({
    description: row?.description ?? '', categoryId: String(row?.categoryId ?? ''), party: row?.party ?? '', partyId: row?.partyId ? String(row.partyId) : '', accountId: row?.accountId ? String(row.accountId) : '', costCenterId: row?.costCenterId ? String(row.costCenterId) : '', amount: row ? String(row.amount) : '', interestRate: row && Number(row.interestRate) > 0 ? String(Number(row.interestRate)) : '', competenceDate: row?.competenceDate ?? todayIso(),
    dueDate: row?.dueDate ?? todayIso(), method: row?.method ?? '', notes: row?.notes ?? '', repeatMonths: '', settleNow: false, settledDate: todayIso(),
  });
  const file = useRef<HTMLInputElement>(null);
  const locked = row?.storedStatus === 'realizada';
  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.description.trim()) e.description = 'Informe a descrição';
    if (!f.v.categoryId) e.categoryId = 'Selecione a categoria';
    if (!(Number(f.v.amount) > 0)) e.amount = 'Informe um valor maior que zero';
    if (!isR && f.v.interestRate !== '' && !(Number(f.v.interestRate) >= 0 && Number(f.v.interestRate) <= 100)) e.interestRate = 'Informe um percentual entre 0 e 100';
    if (!f.v.dueDate) e.dueDate = 'Informe o vencimento'; if (!f.v.competenceDate) e.competenceDate = 'Informe a competência';
    if (f.v.repeatMonths && (Number(f.v.repeatMonths) < 2 || Number(f.v.repeatMonths) > 60)) e.repeatMonths = 'Entre 2 e 60 parcelas';
    const fl = file.current?.files?.[0]; if (fl && fl.size > 5 * 1024 * 1024) e.file = 'Arquivo acima de 5 MB';
    return e;
  };
  return (
    <Modal title={`${row ? 'Editar' : 'Nova'} ${isR ? 'receita' : 'despesa'}`} size="lg" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="txf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="txf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(async () => {
          const body = { type, description: f.v.description, categoryId: f.v.categoryId, party: f.v.partyId ? undefined : f.v.party, partyId: f.v.partyId || undefined, accountId: f.v.accountId || undefined, costCenterId: f.v.costCenterId || undefined, amount: Number(f.v.amount), interestRate: isR ? 0 : Number(f.v.interestRate || 0), competenceDate: f.v.competenceDate, dueDate: f.v.dueDate, method: f.v.method, notes: f.v.notes };
          const r = row ? await api.put<{ ok: true }>(`/fin/transactions/${row.id}`, body)
            : await api.post<{ id: string }>('/fin/transactions', { ...body, repeatMonths: f.v.repeatMonths ? Number(f.v.repeatMonths) : undefined, settledDate: f.v.settleNow ? f.v.settledDate : undefined });
          const fl = file.current?.files?.[0];
          const id = row?.id ?? (r as { id: string }).id;
          if (fl) { const fd = new FormData(); fd.append('file', fl); await api.upload(`/fin/transactions/${id}/attachment`, fd); }
        }, validate);
        if (ok) { toast.success('Lançamento salvo.'); onSaved(); }
      }}>
        {locked && <p className="rounded-lg bg-muted px-3 py-2 text-xs sm:col-span-2">Lançamento {isR ? 'recebido' : 'pago'}: valor e datas ficam travados. Para alterá-los, use <b>Estornar baixa</b> na lista.</p>}
        <FInput f={f} name="description" label="Descrição" required className="sm:col-span-2" autoFocus />
        <FSelect f={f} name="categoryId" label="Categoria financeira" required options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FSelect f={f} name="partyId" label={isR ? 'Cliente cadastrado' : 'Fornecedor cadastrado'} placeholder="Nenhum (digitar abaixo)" options={(parties.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        {!f.v.partyId && <FInput f={f} name="party" label={isR ? 'Cliente / origem (texto livre)' : 'Fornecedor / beneficiário (texto livre)'} />}
        <FSelect f={f} name="accountId" label="Conta" placeholder="Conta padrão" disabled={locked} options={(accounts.data?.accounts ?? []).filter((a) => !a.isDefault).map((a) => ({ value: a.id, label: a.name }))} />
        <FSelect f={f} name="costCenterId" label="Centro de custo" placeholder="Nenhum" options={(centers.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FInput f={f} name="amount" label="Valor (R$)" type="number" step="0.01" min="0.01" required disabled={locked} />
        {!isR && <FInput f={f} name="interestRate" label="Juros após o vencimento (%)" type="number" step="0.01" min="0" max="100" disabled={locked}
          hint={Number(f.v.interestRate) > 0 && Number(f.v.amount) > 0 ? `Só vale se pagar após o vencimento: + ${brl(Number(f.v.amount) * Number(f.v.interestRate) / 100)} (total ${brl(Number(f.v.amount) * (1 + Number(f.v.interestRate) / 100))}).` : 'Opcional: percentual cobrado somente se pagar depois do vencimento.'} />}
        <FSelect f={f} name="method" label={isR ? 'Forma de recebimento' : 'Forma de pagamento'} options={METHODS.map((m) => ({ value: m, label: m }))} />
        <FInput f={f} name="competenceDate" label="Data de competência" type="date" required disabled={locked} />
        <FInput f={f} name="dueDate" label="Data de vencimento" type="date" required disabled={locked} />
        {!row && (
          <>
            <FInput f={f} name="repeatMonths" label="Repetir mensalmente (nº de parcelas)" type="number" min="2" max="60" hint="Opcional: cria várias parcelas, uma por mês." disabled={f.v.settleNow} />
            {can('fin.settle') && (
              <div className="rounded-lg border p-3">
                <FCheck f={f} name="settleNow" label={isR ? 'Já foi recebida' : 'Já foi paga'} />
                {f.v.settleNow && <div className="mt-2"><FInput f={f} name="settledDate" label={isR ? 'Data de recebimento' : 'Data de pagamento'} type="date" max={todayIso()} /></div>}
              </div>)}
          </>
        )}
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" />
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold">Anexo ({isR ? 'comprovante' : 'nota fiscal / comprovante'}) — PDF, PNG ou JPG até 5 MB</label>
          <input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg" className="input mt-1" />
          {f.err.file && <span className="mt-1 block text-xs text-danger">{f.err.file}</span>}
          {row?.attachmentName && <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => api.download(`/fin/transactions/${row.id}/attachment`, {}, row.attachmentName!)}>Anexo atual: {row.attachmentName}</button>}
        </div>
        <SubmitButton busy={f.busy} className="hidden">Salvar</SubmitButton>
      </form>
    </Modal>
  );
}

function SettleModal({ tx, onClose, onDone }: { tx: Tx; onClose: () => void; onDone: () => void }) {
  const isR = tx.type === 'receita'; const toast = useToast();
  const accounts = useFetch<{ accounts: { id: number; name: string; isDefault: boolean }[] }>('/fin/accounts', { active: 'true' });
  const f = useForm({ effectiveDate: todayIso(), method: tx.method ?? '', accountId: tx.accountId ? String(tx.accountId) : '' });
  return (
    <Modal title={isR ? 'Registrar recebimento' : 'Registrar pagamento'} size="sm" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="stf" className="btn-primary" disabled={f.busy}>Confirmar {isR ? 'recebimento' : 'pagamento'}</button></>}>
      <form id="stf" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => api.post(`/fin/transactions/${tx.id}/settle`, f.v), () => (f.v.effectiveDate ? {} : { effectiveDate: 'Informe a data' }));
        if (ok) { toast.success(isR ? 'Recebimento registrado.' : 'Pagamento registrado.'); onDone(); }
      }}>
        <p className="rounded-lg bg-muted p-3 text-sm"><b>{tx.description}</b><br />{brl(tx.amount)} · vence em {dmy(tx.dueDate)}</p>
        <FInput f={f} name="effectiveDate" label={isR ? 'Data do recebimento' : 'Data do pagamento'} type="date" required max={todayIso()} />
        <FSelect f={f} name="method" label="Forma" options={METHODS.map((m) => ({ value: m, label: m }))} />
        <FSelect f={f} name="accountId" label={isR ? 'Conta que recebeu' : 'Conta que pagou'} placeholder="Conta padrão" options={(accounts.data?.accounts ?? []).filter((a) => !a.isDefault).map((a) => ({ value: a.id, label: a.name }))} />
        <p className="text-xs text-muted-foreground">A baixa fica registrada com seu usuário e a data da operação. Se marcar por engano, use <b>Estornar baixa</b> na lista.</p>
      </form>
    </Modal>
  );
}

export default function Transactions({ type }: { type: 'receita' | 'despesa' }) {
  const isR = type === 'receita'; const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const [sp] = useSearchParams();
  const pk = `fin.${type}`;
  const [from, setFrom] = usePersisted(`${pk}.from`, ''); const [to, setTo] = usePersisted(`${pk}.to`, ''); const [cat, setCat] = usePersisted(`${pk}.cat`, ''); const [status, setStatus] = usePersisted(`${pk}.status`, '', sp.get('status'));
  const [method, setMethod] = usePersisted(`${pk}.method`, ''); const [party, setParty] = usePersisted(`${pk}.party`, ''); const [accountId, setAccountId] = usePersisted(`${pk}.acc`, ''); const [costCenterId, setCostCenterId] = usePersisted(`${pk}.cc`, '');
  const [edit, setEdit] = useState<Tx | 'new' | null>(null); const [settle, setSettle] = useState<Tx | null>(null);
  useEffect(() => { const s = sp.get('status'); if (s !== null) setStatus(s); }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useFetch<{ id: number; name: string }[]>('/fin/categories', { type });
  const accs = useFetch<{ accounts: { id: number; name: string }[] }>('/fin/accounts');
  const ccs = useFetch<{ id: number; name: string }[]>('/fin/cost-centers');
  const t = useList<Tx>('/fin/transactions', { sort: 'dueDate', dir: 'desc', persistKey: pk, filters: { type, from, to, categoryId: cat, status, method, party, accountId, costCenterId } });

  const cancel = async (r: Tx) => {
    if (!(await confirm({ title: 'Cancelar lançamento?', message: `"${r.description}" deixará de entrar nos totais. Não é possível reativá-lo.`, confirmLabel: 'Cancelar lançamento', danger: true }))) return;
    try { await api.post(`/fin/transactions/${r.id}/cancel`, {}); toast.success('Lançamento cancelado.'); t.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const unsettle = async (r: Tx) => {
    if (!(await confirm({ title: 'Estornar baixa?', message: `"${r.description}" voltará a ficar pendente (${isR ? 'a receber' : 'a pagar'}) e poderá ser editado, cancelado ou excluído. O estorno fica registrado na auditoria.`, confirmLabel: 'Estornar baixa', danger: true }))) return;
    try { await api.post(`/fin/transactions/${r.id}/unsettle`, {}); toast.success(isR ? 'Recebimento estornado.' : 'Pagamento estornado.'); t.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const remove = async (r: Tx) => {
    if (!(await confirm({ title: 'Excluir lançamento?', message: `"${r.description}" será excluído definitivamente. A exclusão fica registrada nos logs de auditoria.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/fin/transactions/${r.id}`); toast.success('Lançamento excluído.'); t.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const cols: Col<Tx>[] = [
    { key: 'description', label: 'Descrição', sort: 'description', render: (r) => <div><span className="font-semibold">{r.description}</span>{r.party && <div className="text-xs text-muted-foreground">{r.party}</div>}</div> },
    { key: 'category', label: 'Categoria', sort: 'category', render: (r) => <div>{r.category}{r.costCenter && <div className="text-xs text-muted-foreground">{r.costCenter}</div>}</div> },
    { key: 'account', label: 'Conta', render: (r) => r.account ?? '—' },
    { key: 'amount', label: 'Valor', sort: 'amount', className: 'text-right tabular-nums', render: (r) => <div><span className={r.status === 'cancelada' ? 'line-through opacity-60' : ''}>{brl(r.amount)}</span>{Number(r.interestRate) > 0 && <div className="text-xs text-muted-foreground">+ {Number(r.interestRate).toLocaleString('pt-BR')}% de juros após o vencimento</div>}</div> },
    { key: 'dueDate', label: 'Vencimento', sort: 'dueDate', render: (r) => dmy(r.dueDate) },
    { key: 'settledDate', label: isR ? 'Recebimento' : 'Pagamento', sort: 'settledDate', render: (r) => dmy(r.settledDate) },
    { key: 'status', label: 'Situação', sort: 'status', render: (r) => <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge> },
    { key: 'a', label: 'Ações', render: (r) => (
      <div className="flex gap-1">
        {r.storedStatus === 'pendente' && can('fin.settle') && <button className="btn-ghost btn-sm text-success" title={isR ? 'Registrar recebimento' : 'Registrar pagamento'} aria-label={`Baixar ${r.description}`} onClick={() => setSettle(r)}><CheckCheck className="h-4 w-4" /></button>}
        {r.storedStatus === 'realizada' && can('fin.settle') && <button className="btn-ghost btn-sm text-warning" title="Estornar baixa (desfazer pagamento/recebimento)" aria-label={`Estornar ${r.description}`} onClick={() => unsettle(r)}><Undo2 className="h-4 w-4" /></button>}
        {r.storedStatus !== 'cancelada' && can('fin.edit') && <button className="btn-ghost btn-sm" title="Editar" aria-label={`Editar ${r.description}`} onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /></button>}
        {r.storedStatus === 'pendente' && can('fin.cancel') && <button className="btn-ghost btn-sm text-danger" title="Cancelar" aria-label={`Cancelar ${r.description}`} onClick={() => cancel(r)}><Ban className="h-4 w-4" /></button>}
        {r.storedStatus !== 'realizada' && can('fin.cancel') && <button className="btn-ghost btn-sm text-danger" title="Excluir" aria-label={`Excluir ${r.description}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></button>}
        {r.attachmentName && <button className="btn-ghost btn-sm" title={`Anexo: ${r.attachmentName}`} aria-label="Baixar anexo" onClick={() => api.download(`/fin/transactions/${r.id}/attachment`, {}, r.attachmentName!).catch((e) => toast.error(errMsg(e)))}><Paperclip className="h-4 w-4" /></button>}
      </div>) },
  ];
  const add = can('fin.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Nova {isR ? 'receita' : 'despesa'}</button>;

  return (
    <div>
      <PageHeader title={isR ? 'Receitas' : 'Despesas'} subtitle={isR ? 'Contas a receber e receitas recebidas.' : 'Contas a pagar e despesas pagas.'} actions={add} />
      <FilterBar dirty={!!(t.q || from || to || cat || status || method || party || accountId || costCenterId)} onClear={() => { t.setQ(''); setFrom(''); setTo(''); setCat(''); setStatus(''); setMethod(''); setParty(''); setAccountId(''); setCostCenterId(''); }}>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar descrição ou origem…" />
        <FilterSelect label="Categoria" placeholder="Todas as categorias" value={cat} onChange={setCat} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Situação" placeholder="Todas as situações" value={status} onChange={setStatus} options={[{ value: 'prevista', label: 'Prevista' }, { value: 'vencida', label: 'Vencida' }, { value: isR ? 'recebida' : 'paga', label: isR ? 'Recebida' : 'Paga' }, { value: 'cancelada', label: 'Cancelada' }]} />
        <FilterSelect label="Conta" placeholder="Todas as contas" value={accountId} onChange={setAccountId} options={(accs.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        <FilterSelect label="Centro de custo" placeholder="Todos os centros" value={costCenterId} onChange={setCostCenterId} options={[{ value: 'none', label: 'Sem centro de custo' }, ...(ccs.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Forma" placeholder="Todas as formas" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: m }))} />
        <FilterDate label="Venc. de" value={from} onChange={setFrom} /><FilterDate label="até" value={to} onChange={setTo} />
        <input aria-label={isR ? 'Cliente/origem' : 'Fornecedor'} className="input" placeholder={isR ? 'Cliente / origem' : 'Fornecedor / beneficiário'} value={party} onChange={(e) => setParty(e.target.value)} />
      </FilterBar>
      {t.extra?.sum !== undefined && t.list.total > 0 && <p className="mb-2 text-sm text-muted-foreground">Total dos filtros (exceto cancelados): <b className="text-foreground">{brl(t.extra.sum)}</b></p>}
      <DataTable<Tx> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={Wallet} title={`Nenhuma ${isR ? 'receita' : 'despesa'} encontrada`} hint="Registre o primeiro lançamento ou ajuste os filtros." action={add} />} />
      {edit && <TxForm type={type} row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); }} />}
      {settle && <SettleModal tx={settle} onClose={() => setSettle(null)} onDone={() => { setSettle(null); t.reload(); }} />}
    </div>
  );
}
