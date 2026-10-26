import { useState } from 'react';
import { ArrowLeftRight, Landmark, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { Badge, DataTable, Empty, ErrorBox, Modal, PageHeader, Skeleton, StatCard, type Col } from '../../components/ui';
import { FCheck, FInput, FSelect } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm, useList } from '../../lib/hooks';
import { brl, dmy, todayIso } from '../../lib/format';

export interface Account {
  id: number; name: string; kind: string; bank: string | null; agency: string | null; accountNumber: string | null;
  initialBalance: string; isDefault: boolean; active: boolean; balance: string; txCount: number; pendingLines: number;
}
interface Transfer { id: number; fromAccount: string; toAccount: string; amount: string; date: string; description: string | null; createdBy: string | null }

export const KIND: Record<string, string> = { corrente: 'Conta corrente', poupanca: 'Poupança', caixa: 'Caixa', cartao: 'Cartão', outra: 'Outra' };
const KIND_OPTS = Object.entries(KIND).map(([value, label]) => ({ value, label }));

function AccountForm({ row, onClose, onSaved }: { row: Account | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({
    name: row?.name ?? '', kind: row?.kind ?? 'corrente', bank: row?.bank ?? '', agency: row?.agency ?? '', accountNumber: row?.accountNumber ?? '',
    initialBalance: row ? String(row.initialBalance) : '0', active: row?.active ?? true,
  });
  return (
    <Modal title={row ? 'Editar conta' : 'Nova conta'} size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="acf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="acf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f.v, initialBalance: Number(f.v.initialBalance || 0) };
        const ok = await f.submit(() => (row ? api.put(`/fin/accounts/${row.id}`, body) : api.post('/fin/accounts', body)),
          () => ({ name: f.v.name.trim() ? undefined : 'Informe o nome da conta', initialBalance: Number.isFinite(Number(f.v.initialBalance || 0)) ? undefined : 'Saldo inválido' }));
        if (ok) { toast.success('Conta salva.'); onSaved(); }
      }}>
        <FInput f={f} name="name" label="Nome da conta" required className="sm:col-span-2" autoFocus />
        <FSelect f={f} name="kind" label="Tipo" options={KIND_OPTS} placeholder="Tipo" />
        <FInput f={f} name="initialBalance" label="Saldo inicial (R$)" type="number" step="0.01" hint="Saldo antes dos lançamentos desta conta." />
        <FInput f={f} name="bank" label="Banco" />
        <FInput f={f} name="agency" label="Agência" />
        <FInput f={f} name="accountNumber" label="Número da conta" className="sm:col-span-2" />
        {row && !row.isDefault && <div className="sm:col-span-2"><FCheck f={f} name="active" label="Ativa" /></div>}
      </form>
    </Modal>
  );
}

function TransferForm({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const active = accounts.filter((a) => a.active);
  const f = useForm({ fromAccountId: '', toAccountId: '', amount: '', date: todayIso(), description: '' });
  const opts = active.map((a) => ({ value: a.id, label: `${a.name} (${brl(a.balance)})` }));
  return (
    <Modal title="Transferir entre contas" size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="trf" className="btn-primary" disabled={f.busy}>Transferir</button></>}>
      <form id="trf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => api.post('/fin/transfers', { ...f.v, amount: Number(f.v.amount) }), () => ({
          fromAccountId: f.v.fromAccountId ? undefined : 'Selecione a conta de origem',
          toAccountId: !f.v.toAccountId ? 'Selecione a conta de destino' : f.v.toAccountId === f.v.fromAccountId ? 'Escolha contas diferentes' : undefined,
          amount: Number(f.v.amount) > 0 ? undefined : 'Informe um valor maior que zero',
          date: f.v.date ? undefined : 'Informe a data',
        }));
        if (ok) { toast.success('Transferência registrada.'); onSaved(); }
      }}>
        <FSelect f={f} name="fromAccountId" label="Conta de origem" required options={opts} />
        <FSelect f={f} name="toAccountId" label="Conta de destino" required options={opts} />
        <FInput f={f} name="amount" label="Valor (R$)" type="number" step="0.01" min="0.01" required />
        <FInput f={f} name="date" label="Data" type="date" max={todayIso()} required />
        <FInput f={f} name="description" label="Descrição" className="sm:col-span-2" />
      </form>
    </Modal>
  );
}

export default function Accounts() {
  const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const acc = useFetch<{ accounts: Account[]; total: number }>('/fin/accounts');
  const tr = useList<Transfer>('/fin/transfers', { sort: 'date', dir: 'desc', pageSize: 10 });
  const [edit, setEdit] = useState<Account | 'new' | null>(null); const [xfer, setXfer] = useState(false);
  const manage = can('fin.accounts');
  const accounts = acc.data?.accounts ?? [];

  const removeTransfer = async (t: Transfer) => {
    if (!(await confirm({ title: 'Excluir transferência?', message: `${brl(t.amount)} de ${t.fromAccount} para ${t.toAccount} deixará de contar nos saldos. A exclusão fica na auditoria.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/fin/transfers/${t.id}`); toast.success('Transferência excluída.'); acc.reload(); tr.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  const cols: Col<Transfer>[] = [
    { key: 'date', label: 'Data', sort: 'date', render: (r) => dmy(r.date) },
    { key: 'route', label: 'Origem → destino', render: (r) => <div><span className="font-semibold">{r.fromAccount}</span> → <span className="font-semibold">{r.toAccount}</span>{r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}</div> },
    { key: 'amount', label: 'Valor', sort: 'amount', className: 'text-right tabular-nums', render: (r) => brl(r.amount) },
    { key: 'createdBy', label: 'Registrada por', render: (r) => r.createdBy ?? '—' },
    { key: 'a', label: '', className: 'text-right', render: (r) => manage && <button className="btn-ghost btn-sm text-danger" aria-label="Excluir transferência" onClick={() => removeTransfer(r)}><Trash2 className="h-4 w-4" /></button> },
  ];

  return (
    <div>
      <PageHeader title="Contas e transferências" subtitle="Saldo por conta: saldo inicial + recebimentos − pagamentos ± transferências. Lançamentos sem conta contam na conta padrão."
        actions={manage && <div className="flex gap-2"><button className="btn-outline" onClick={() => setXfer(true)} disabled={accounts.filter((a) => a.active).length < 2}><ArrowLeftRight className="h-4 w-4" />Transferir</button><button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Nova conta</button></div>} />
      {acc.error ? <ErrorBox message={acc.error} onRetry={acc.reload} /> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Saldo total (contas ativas)" value={Number(acc.data?.total ?? 0)} format={brl} icon={Wallet} tone={(acc.data?.total ?? 0) < 0 ? 'danger' : 'primary'} />
            <StatCard label="Contas ativas" value={accounts.filter((a) => a.active).length} format={(n) => String(n)} icon={Landmark} tone="info" />
          </div>
          {acc.loading && !acc.data ? <Skeleton className="h-40 w-full" /> : (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <div key={a.id} className={`card p-4 ${a.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display font-bold">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{KIND[a.kind] ?? a.kind}{a.bank ? ` · ${a.bank}` : ''}{a.agency ? ` · ag. ${a.agency}` : ''}{a.accountNumber ? ` · c/c ${a.accountNumber}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {a.isDefault && <Badge tone="info">Padrão</Badge>}{!a.active && <Badge>Inativa</Badge>}
                      {manage && <button className="btn-ghost btn-sm" aria-label={`Editar ${a.name}`} onClick={() => setEdit(a)}><Pencil className="h-4 w-4" /></button>}
                    </div>
                  </div>
                  <p className={`mt-3 font-display text-2xl font-bold tabular-nums ${Number(a.balance) < 0 ? 'text-danger' : ''}`}>{brl(a.balance)}</p>
                  <p className="text-xs text-muted-foreground">{a.txCount} lançamento(s){a.pendingLines > 0 && <> · <span className="font-semibold text-warning">{a.pendingLines} linha(s) a conciliar</span></>}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <h2 className="mb-2 font-display text-lg font-bold">Transferências</h2>
      <DataTable<Transfer> cols={cols} rows={tr.rows} loading={tr.loading} error={tr.error} onRetry={tr.reload} list={tr.list}
        empty={<Empty icon={ArrowLeftRight} title="Nenhuma transferência registrada" hint="Use Transferir para mover dinheiro entre contas." />} />
      {edit && <AccountForm row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); acc.reload(); }} />}
      {xfer && <TransferForm accounts={accounts} onClose={() => setXfer(false)} onSaved={() => { setXfer(false); acc.reload(); tr.reload(); }} />}
    </div>
  );
}
