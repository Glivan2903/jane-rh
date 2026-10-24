import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Boxes, Bot, Check, Copy, Download, History, Loader2, MessageSquarePlus, Trash2, UserCog, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBox, Skeleton } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { PALETTE } from '../../components/charts';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';
import { brl, num } from '../../lib/format';

interface TableBlock { type: 'table'; title: string; columns: string[]; rows: string[][] }
interface ChartBlock { type: 'chart'; title: string; kind: 'bar' | 'line' | 'pie'; labels: string[]; series: { name: string; values: number[] }[]; money: boolean }
type Block = TableBlock | ChartBlock;
interface Msg { id?: number; role: 'user' | 'assistant'; content: string; blocks?: Block[] | null; error?: boolean }
interface Status {
  configured: boolean; model: string; access: { enabled: boolean; finance: boolean; stock: boolean; hr: boolean; salary: boolean; admin?: boolean }; tools: string[];
  limits: { messagesPerDay: number; tokensPerMonth: number }; usage: { messagesToday: number; tokensMonth: number };
}
interface Conv { id: string; title: string; updatedAt: string }

const TOOL_LABEL: Record<string, string> = {
  financeiro: 'Consultando o financeiro…', cadastros: 'Consultando cadastros…', estoque: 'Consultando o estoque…', pessoal: 'Consultando dados de pessoal…', exibir: 'Montando a visualização…',
};
const toolLabel = (n: string) => TOOL_LABEL[n.split('_')[0]] ?? 'Consultando…';

function TableView({ b }: { b: TableBlock }) {
  const csv = () => {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);   // evita injeção de fórmula
    const text = '﻿' + [b.columns, ...b.rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `${b.title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'tabela'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2"><span className="text-sm font-semibold">{b.title}</span>
        <button className="btn-ghost btn-sm" onClick={csv}><Download className="h-3.5 w-3.5" />CSV</button></div>
      <div className="max-h-80 overflow-auto"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/70 text-xs text-muted-foreground"><tr>{b.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{c}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="px-3 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}

function ChartView({ b }: { b: ChartBlock }) {
  const data = b.labels.map((l, i) => Object.fromEntries([['label', l], ...b.series.map((s) => [s.name, s.values[i] ?? 0])]));
  const fmt = (v: number) => (b.money ? brl(v) : num(v, 2));
  const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)} mil` : String(v));
  const axis = { fill: '#7a93a2', fontSize: 11 };
  return (
    <div className="mt-2 rounded-lg border bg-card p-3">
      <p className="mb-2 text-sm font-semibold">{b.title}</p>
      <div className="h-60"><ResponsiveContainer width="100%" height="100%">
        {b.kind === 'pie' ? (
          <PieChart><Pie data={b.labels.map((l, i) => ({ name: l, value: b.series[0]?.values[i] ?? 0 }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2}>
            {b.labels.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
        ) : b.kind === 'line' ? (
          <LineChart data={data} margin={{ left: -6, right: 10, top: 8 }}><CartesianGrid strokeDasharray="3 4" stroke="rgb(128 150 165 / .22)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={48} /><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            {b.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}</LineChart>
        ) : (
          <BarChart data={data} margin={{ left: -6, right: 10, top: 8 }}><CartesianGrid strokeDasharray="3 4" stroke="rgb(128 150 165 / .22)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={48} /><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            {b.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 2, 2]} maxBarSize={36} />)}</BarChart>
        )}
      </ResponsiveContainer></div>
    </div>
  );
}

const GROUPS = (a: Status['access']): { title: string; icon: LucideIcon; items: string[] }[] => [
  a.finance && { title: 'Financeiro', icon: Wallet, items: ['Qual o resultado financeiro deste mês?', 'Quais contas estão vencidas?', 'Meu saldo vai ficar negativo nos próximos 60 dias?'] },
  a.stock && { title: 'Estoque', icon: Boxes, items: ['Quais produtos estão com estoque baixo ou zerado?', 'Quanto vale o meu estoque?'] },
  a.hr && { title: 'Pessoal', icon: Users, items: ['Quantos funcionários ativos temos por departamento?', 'Qual o próximo aniversariante?'] },
  a.admin && { title: 'Sistema', icon: UserCog, items: ['Quantos usuários estão cadastrados e com qual perfil?'] },
].filter(Boolean) as { title: string; icon: LucideIcon; items: string[] }[];

const dayGroup = (iso: string) => {
  const d = new Date(iso); const now = new Date(); const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  return days <= 0 ? 'Hoje' : days === 1 ? 'Ontem' : days <= 7 ? 'Últimos 7 dias' : 'Anteriores';
};

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/msg:opacity-100"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sem permissão da área de transferência */ } }}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export default function Assistant() {
  const { me } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const status = useFetch<Status>('/ai/status');
  const convs = useFetch<Conv[]>('/ai/conversations');
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [stage, setStage] = useState('');
  const [loadingConv, setLoadingConv] = useState(false); const [showList, setShowList] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null); const bottom = useRef<HTMLDivElement>(null); const abort = useRef<AbortController | null>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, stage]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; } }, [text]);

  const open = useCallback(async (id: string | null) => {
    abort.current?.abort(); setBusy(false); setStage(''); setConvId(id); setShowList(false);
    if (!id) { setMsgs([]); return; }
    setLoadingConv(true);
    try { const c = await api.get<{ messages: Msg[] }>(`/ai/conversations/${id}`); setMsgs(c.messages); } catch (e) { toast.error(errMsg(e)); } finally { setLoadingConv(false); }
  }, [toast]);

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const message = (preset ?? text).trim();
    if (!message || busy) return;
    setText(''); setBusy(true); setStage('Pensando…');
    setMsgs((m) => [...m, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
    const ctl = new AbortController(); abort.current = ctl;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((arr) => arr.map((m, i) => (i === arr.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gentis' }, body: JSON.stringify({ message, conversationId: convId ?? undefined }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? 'Não foi possível enviar a pergunta.'); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let newId = convId;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === 'start') newId = ev.conversationId;
          else if (ev.type === 'tool') setStage(toolLabel(ev.name));
          else if (ev.type === 'text') { setStage(''); patch((m) => ({ ...m, content: m.content + ev.delta })); }
          else if (ev.type === 'done') patch((m) => ({ ...m, id: ev.messageId, content: ev.text, blocks: ev.blocks }));        // texto final já filtrado pelo servidor
          else if (ev.type === 'error') patch((m) => ({ ...m, content: ev.message, error: true }));
        }
      }
      if (newId && newId !== convId) setConvId(newId);
      convs.reload(); status.reload();
    } catch (x) {
      if ((x as Error).name !== 'AbortError') patch((m) => ({ ...m, content: errMsg(x), error: true }));
    } finally { setBusy(false); setStage(''); }
  };

  const remove = async (c: Conv) => {
    if (!(await confirm({ title: 'Excluir conversa?', message: `"${c.title}" será excluída do seu histórico.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/ai/conversations/${c.id}`); if (convId === c.id) { setConvId(null); setMsgs([]); } convs.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (status.error) return <ErrorBox message={status.error} onRetry={status.reload} />;
  const st = status.data;
  if (!st) return <Skeleton className="h-96 w-full" />;
  const usable = st.access.enabled && (st.access.finance || st.access.stock || st.access.hr) && st.configured;
  const left = st.limits.messagesPerDay - st.usage.messagesToday;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0"><h1 className="font-display text-xl font-bold leading-tight sm:text-2xl">Assistente de IA</h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">Pergunte em português sobre os dados liberados para você. O assistente só consulta; não altera nada.</p></div>
        <button className="btn-outline btn-sm lg:hidden" onClick={() => setShowList((v) => !v)} aria-expanded={showList}><History className="h-4 w-4" />Conversas</button>
      </div>
      {!st.access.enabled || !(st.access.finance || st.access.stock || st.access.hr) ? (
        <div role="status" className="card p-6 text-sm">O administrador ainda não liberou o Assistente de IA para o seu usuário. Peça acesso em <b>Configurações &gt; Assistente de IA</b>.</div>
      ) : !st.configured ? (
        <div role="alert" className="card border-warning/40 bg-warning/10 p-6 text-sm">O Assistente de IA ainda não foi configurado neste ambiente (chave do modelo ausente). Avise o administrador.</div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[250px_1fr]">
          <aside className={`card min-h-0 flex-col p-2 ${showList ? 'flex' : 'hidden'} max-lg:max-h-60 lg:flex`}>
            <button className="btn-primary mb-2 w-full" onClick={() => open(null)}><MessageSquarePlus className="h-4 w-4" />Nova conversa</button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {['Hoje', 'Ontem', 'Últimos 7 dias', 'Anteriores'].map((g) => {
                const list = (convs.data ?? []).filter((c) => dayGroup(c.updatedAt) === g);
                if (!list.length) return null;
                return (
                  <div key={g} className="mb-2">
                    <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{g}</p>
                    {list.map((c) => (
                      <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${convId === c.id ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'}`}>
                        <button className="min-w-0 flex-1 truncate text-left" onClick={() => open(c.id)} title={c.title}>{c.title}</button>
                        <button className="rounded p-1 text-muted-foreground opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100" aria-label={`Excluir ${c.title}`} onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>))}
                  </div>);
              })}
              {convs.data?.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Suas conversas aparecem aqui.</p>}
            </div>
          </aside>
          <section className="card flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" aria-live="polite"><div className="w-full space-y-5">
              {loadingConv ? <Skeleton className="h-32 w-full" /> : msgs.length === 0 ? (
                <div className="py-6 sm:py-10">
                  <div className="mb-1 flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="h-5 w-5" /></span>
                    <h2 className="font-display text-2xl font-bold">Olá, {me?.name.split(' ')[0]}</h2>
                  </div>
                  <p className="mb-6 text-muted-foreground">Pergunte do seu jeito. Eu consulto os dados do sistema que o administrador liberou para você.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {GROUPS(st.access).map((g) => (
                      <div key={g.title} className="rounded-xl border bg-background p-3">
                        <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><g.icon className="h-4 w-4 text-primary" />{g.title}</p>
                        <div className="space-y-1">
                          {g.items.map((q) => <button key={q} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground/80 hover:bg-primary/10 hover:text-primary" onClick={() => send(undefined, q)}>{q}</button>)}
                        </div>
                      </div>))}
                  </div>
                </div>
              ) : msgs.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-primary/20 bg-primary/10 px-3.5 py-2 text-sm [overflow-wrap:anywhere]">{m.content}</p>
                  </div>
                ) : (
                  <div key={i} className="group/msg flex gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      {m.error ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{m.content}</p>
                        : m.content ? <SafeText text={m.content} lead /> : <span className="inline-flex items-center gap-2 pt-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{stage || 'Pensando…'}</span>}
                      {m.content && busy && i === msgs.length - 1 && stage && <p className="mt-1 text-xs text-muted-foreground">{stage}</p>}
                      {m.blocks?.map((b, j) => (b.type === 'table' ? <TableView key={j} b={b} /> : <ChartView key={j} b={b} />))}
                      {m.content && !m.error && !(busy && i === msgs.length - 1) && <div className="mt-1 -ml-1.5"><CopyButton text={m.content} /></div>}
                    </div>
                  </div>)
              ))}
              <div ref={bottom} />
            </div></div>
            <form onSubmit={send} className="shrink-0 px-3 pb-3 pt-1 sm:px-4">
              <div className="w-full">
                <div className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
                  <textarea ref={box} aria-label="Pergunta" className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground" rows={1} maxLength={4000}
                    placeholder="Pergunte sobre financeiro, estoque ou pessoal…" value={text} disabled={busy || !usable}
                    onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  <button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40" disabled={busy || !text.trim() || !usable} aria-label="Enviar">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}</button>
                </div>
                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Respostas geradas por IA: confira valores importantes. CPF e documentos nunca são enviados ao modelo.{left <= 10 && ` Restam ${Math.max(left, 0)} pergunta(s) hoje.`}</p>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
