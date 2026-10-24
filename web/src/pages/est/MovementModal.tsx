import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Scale } from 'lucide-react';
import { Modal, useDebounced } from '../../components/ui';
import { FInput, FSelect, FTextarea } from '../../components/forms';
import { api } from '../../lib/api';
import { useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import { dmy, newKey, num, todayIso } from '../../lib/format';

export type Kind = 'entrada' | 'saida' | 'ajuste';
export interface ProdRef { id: string; code: string; name: string }
interface Opt { id: string; code: string; name: string; quantity: string; unit: string; cost: string; tracksBatches?: boolean }
interface Batch { id: number; code: string; expiresAt: string | null; quantity: string; status: string }
const ENTRY = ['Compra', 'Saldo inicial', 'Devolução', 'Ajuste autorizado'];
const EXIT = ['Consumo interno', 'Venda', 'Perda ou avaria', 'Devolução ao fornecedor', 'Ajuste autorizado', 'Outros'];
const META = {
  entrada: { title: 'Entrada de estoque', url: '/est/entries', icon: ArrowDownToLine, done: 'Entrada registrada.', btn: 'Confirmar entrada' },
  saida: { title: 'Saída de estoque', url: '/est/exits', icon: ArrowUpFromLine, done: 'Saída registrada.', btn: 'Confirmar saída' },
  ajuste: { title: 'Ajuste de inventário', url: '/est/adjustments', icon: Scale, done: 'Ajuste registrado.', btn: 'Confirmar ajuste' },
};

/** Entrada, saída ou ajuste direto da lista de produtos. Com `product` o item já vem escolhido. */
export function MovementModal({ kind, product, onClose, onDone }: { kind: Kind; product?: ProdRef; onClose: () => void; onDone: () => void }) {
  const m = META[kind]; const toast = useToast();
  const [search, setSearch] = useState(''); const dq = useDebounced(search);
  const opts = useFetch<Opt[]>('/est/products/options', product ? { q: product.code } : { q: dq });
  const sups = useFetch<{ id: number; name: string }[]>('/est/suppliers', { active: 'true' });
  const init = () => ({ productId: product?.id ?? '', quantity: '', newQuantity: '', unitCost: '', date: todayIso(), reason: kind === 'ajuste' ? '' : kind === 'entrada' ? 'Compra' : '', docNumber: '', supplierId: '', destination: '', notes: '', batchCode: '', expiresAt: '', batchId: '' });
  const f = useForm(init());
  const [key, setKey] = useState(newKey());
  const [found, setFound] = useState<Opt | null>(null); const [scan, setScan] = useState(''); const [scanErr, setScanErr] = useState('');
  const sel = opts.data?.find((o) => o.id === f.v.productId) ?? (found && found.id === f.v.productId ? found : undefined);
  const tracked = !!sel?.tracksBatches;
  const batches = useFetch<Batch[]>(tracked ? `/est/products/${sel!.id}/batches` : null);
  const batch = (batches.data ?? []).find((b) => String(b.id) === f.v.batchId);
  // leitor de código de barras (teclado): Enter localiza o produto pelo código de barras ou código interno
  const lookup = async () => {
    const code = scan.trim(); if (!code) return;
    try { const p = await api.get<Opt>('/est/products/lookup', { code }); setFound({ ...p, cost: '0' }); f.set('productId', p.id); f.set('batchId', ''); setScanErr(''); setScan(''); }
    catch (e) { setScanErr(e instanceof Error ? e.message : 'Produto não encontrado.'); }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.productId) e.productId = 'Selecione o produto';
    if (kind !== 'ajuste' && !(Number(f.v.quantity) > 0)) e.quantity = 'Informe uma quantidade maior que zero';
    if (kind === 'ajuste' && (f.v.newQuantity === '' || Number(f.v.newQuantity) < 0)) e.newQuantity = 'Informe a quantidade contada (≥ 0)';
    if (tracked && kind === 'entrada' && !f.v.batchCode.trim()) e.batchCode = 'Informe o lote';
    if (tracked && kind === 'ajuste' && !f.v.batchId) e.batchId = 'Selecione o lote a ajustar';
    if (!f.v.reason.trim()) e.reason = kind === 'ajuste' ? 'Informe o motivo do ajuste' : 'Selecione o motivo';
    if (!f.v.date) e.date = 'Informe a data';
    if (kind === 'saida' && sel && !tracked && Number(f.v.quantity) > Number(sel.quantity)) e.quantity = `Saldo disponível: ${num(sel.quantity)} ${sel.unit}`;
    if (kind === 'saida' && tracked && f.v.batchId && batch && Number(f.v.quantity) > Number(batch.quantity)) e.quantity = `Saldo do lote: ${num(batch.quantity)} ${sel?.unit ?? ''}`;
    return e;
  };

  return (
    <Modal title={product ? `${m.title} — ${product.name}` : m.title} size="md" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="mvf" className="btn-primary" disabled={f.busy}><m.icon className="h-4 w-4" />{m.btn}</button></>}>
      <form id="mvf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const body = kind === 'ajuste'
          ? { productId: f.v.productId, newQuantity: Number(f.v.newQuantity), date: f.v.date, reason: f.v.reason, notes: f.v.notes, idempotencyKey: key, ...(tracked ? { batchId: Number(f.v.batchId) } : {}) }
          : { productId: f.v.productId, quantity: Number(f.v.quantity), date: f.v.date, reason: f.v.reason, notes: f.v.notes, idempotencyKey: key,
              ...(kind === 'entrada' ? { unitCost: f.v.unitCost === '' ? null : Number(f.v.unitCost), docNumber: f.v.docNumber, supplierId: f.v.supplierId, ...(tracked ? { batchCode: f.v.batchCode, expiresAt: f.v.expiresAt } : {}) } : { destination: f.v.destination, ...(tracked && f.v.batchId ? { batchId: Number(f.v.batchId) } : {}) }) };
        let dup = false;
        const ok = await f.submit(async () => { const r = await api.post<{ duplicate?: boolean }>(m.url, body); dup = !!r.duplicate; }, validate);
        if (ok) { toast.success(dup ? 'Esta operação já havia sido registrada (envio repetido ignorado).' : m.done); onDone(); }
      }}>
        {product ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2">
            <span className="font-mono text-xs">{product.code}</span> · <b>{product.name}</b>
            {sel && <> — saldo atual <b>{num(sel.quantity)} {sel.unit}</b> · custo médio R$ {Number(sel.cost).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</>}
          </p>
        ) : (
          <div className="sm:col-span-2">
            <div className="mb-2"><input className="input" aria-label="Ler código de barras" placeholder="Ler código de barras (ou digitar o código) e pressionar Enter" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } }} autoFocus />
              {scanErr && <p role="alert" className="mt-1 text-xs text-danger">{scanErr}</p>}</div>
            <input className="input mb-2" type="search" placeholder="Pesquisar produto por código, nome ou código de barras…" aria-label="Pesquisar produto" value={search} onChange={(e) => setSearch(e.target.value)} />
            <FSelect f={f} name="productId" label="Produto" required placeholder={opts.loading ? 'Carregando…' : opts.data?.length ? 'Selecione…' : 'Nenhum produto ativo encontrado'}
              options={(opts.data ?? []).map((o) => ({ value: o.id, label: `${o.code} — ${o.name} (saldo ${num(o.quantity)} ${o.unit})` }))} />
            {sel && <p className="mt-1 text-xs text-muted-foreground">Saldo atual: <b>{num(sel.quantity)} {sel.unit}</b></p>}
          </div>
        )}
        {tracked && kind === 'entrada' && <>
          <div><FInput f={f} name="batchCode" label="Lote" required list="lotes-existentes" hint="Use o mesmo lote para somar a um lote existente." />
            <datalist id="lotes-existentes">{(batches.data ?? []).map((b) => <option key={b.id} value={b.code} />)}</datalist></div>
          <FInput f={f} name="expiresAt" label="Validade do lote" type="date" hint="Opcional. Com validade, o sistema avisa antes de vencer." />
        </>}
        {tracked && kind !== 'entrada' && (
          <FSelect f={f} name="batchId" label={kind === 'ajuste' ? 'Lote a ajustar' : 'Lote'} required={kind === 'ajuste'} className="sm:col-span-2" placeholder={kind === 'ajuste' ? 'Selecione o lote…' : 'Automático: sai primeiro o que vence antes'}
            options={(batches.data ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.expiresAt ? `validade ${dmy(b.expiresAt)}` : 'sem validade'} · saldo ${num(b.quantity)}${b.status === 'vencido' ? ' · VENCIDO' : ''}` }))} />)}
        {kind === 'ajuste'
          ? <FInput f={f} name="newQuantity" label={tracked ? 'Quantidade contada do lote' : 'Quantidade contada (nova)'} type="number" step="0.001" min="0" required autoFocus={!!product} hint={sel && f.v.newQuantity !== '' ? `Diferença: ${num(Number(f.v.newQuantity) - Number(tracked ? (batch?.quantity ?? 0) : sel.quantity))}` : undefined} />
          : <FInput f={f} name="quantity" label={kind === 'entrada' ? 'Quantidade recebida' : 'Quantidade retirada'} type="number" step="0.001" min="0.001" required autoFocus={!!product} />}
        <FInput f={f} name="date" label="Data da movimentação" type="date" required max={todayIso()} />
        {kind === 'ajuste'
          ? <FInput f={f} name="reason" label="Motivo do ajuste" required className="sm:col-span-2" placeholder="Ex.: contagem de inventário, avaria identificada…" />
          : <FSelect f={f} name="reason" label="Motivo" required options={(kind === 'entrada' ? ENTRY : EXIT).map((r) => ({ value: r, label: r }))} />}
        {kind === 'entrada' && <>
          <FInput f={f} name="unitCost" label="Custo unitário (R$)" type="number" step="0.0001" min="0" hint="Atualiza o custo médio ponderado." />
          <FSelect f={f} name="supplierId" label="Fornecedor" options={(sups.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <FInput f={f} name="docNumber" label="Nº da nota fiscal" />
        </>}
        {kind === 'saida' && <FInput f={f} name="destination" label="Destino / responsável" />}
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" rows={2} />
      </form>
    </Modal>
  );
}
