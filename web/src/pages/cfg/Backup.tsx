import { useState } from 'react';
import { DatabaseBackup, Download, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge, DataTable, Empty, Modal, PageHeader, Spinner, type Col } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, useConfirm, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';
import { dmyTime } from '../../lib/format';

interface B { id: number; filename: string; kind: string; status: string; sizeBytes: string | null; error: string | null; userName: string | null; createdAt: string; restoredAt: string | null }
const size = (n: string | null) => (n == null ? '—' : Number(n) > 1048576 ? `${(Number(n) / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(Number(n) / 1024))} KB`);

export default function Backup() {
  const { data, loading, error, reload } = useFetch<{ rows: B[]; info: { dir: string | null; autoHours: number } }>('/config/backups');
  const toast = useToast(); const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null); const [restore, setRestore] = useState<B | null>(null); const [word, setWord] = useState('');
  const rows = data?.rows ?? [];
  const noop = { page: 1, pageSize: rows.length || 1, sort: '', dir: 'asc' as const, total: 0, setPage() {}, setPageSize() {}, toggleSort() {} };

  const run = async () => {
    if (busy) return; setBusy('run');
    try { await api.post('/config/backups'); toast.success('Backup concluído.'); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); reload(); }
  };
  const verify = async (b: B) => {
    setBusy('v' + b.id);
    try { const r = await api.post<{ ok: boolean }>(`/config/backups/${b.id}/verify`); r.ok ? toast.success('Arquivo íntegro (SHA-256 confere).') : toast.error('ARQUIVO CORROMPIDO: o hash não confere.'); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  const doRestore = async () => {
    if (!restore) return; setBusy('r');
    try {
      const r = await api.post<{ adicionados: number; identicos: number; mantidos: number }>(`/config/backups/${restore.id}/restore`, { confirm: word });
      toast.success(`Backup restaurado: ${r.adicionados} registro(s) adicionado(s), ${r.identicos} já existia(m) idêntico(s), ${r.mantidos} mantido(s) como estava(m).`);
      setRestore(null); reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };

  const cols: Col<B>[] = [
    { key: 'createdAt', label: 'Data e hora', render: (r) => dmyTime(r.createdAt) },
    { key: 'kind', label: 'Tipo', render: (r) => r.kind }, { key: 'filename', label: 'Arquivo', render: (r) => <span className="font-mono text-xs">{r.filename}</span> },
    { key: 'size', label: 'Tamanho', render: (r) => size(r.sizeBytes) },
    { key: 'status', label: 'Status', render: (r) => <div><Badge tone={r.status === 'concluido' ? 'success' : r.status === 'falha' ? 'danger' : 'neutral'}>{r.status}</Badge>{r.error && <div className="mt-1 max-w-xs text-xs text-danger">{r.error}</div>}{r.restoredAt && <div className="mt-1 text-xs text-muted-foreground">restaurado em {dmyTime(r.restoredAt)}</div>}</div> },
    { key: 'user', label: 'Responsável', render: (r) => r.userName ?? '—' },
    { key: 'a', label: 'Ações', render: (r) => r.status !== 'concluido' ? null : (
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" title="Baixar" aria-label="Baixar backup" onClick={() => api.download(`/config/backups/${r.id}/download`, {}, r.filename).catch((e) => toast.error(errMsg(e)))}><Download className="h-4 w-4" /></button>
        <button className="btn-ghost btn-sm" title="Verificar integridade" aria-label="Verificar integridade" onClick={() => verify(r)} disabled={busy === 'v' + r.id}>{busy === 'v' + r.id ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}</button>
        <button className="btn-ghost btn-sm text-danger" title="Restaurar" aria-label="Restaurar backup" onClick={() => { setWord(''); setRestore(r); }}><RotateCcw className="h-4 w-4" /></button>
      </div>) },
  ];
  return (
    <div>
      <PageHeader title="Backup e restauração" subtitle="Backups reais do banco de dados e dos anexos (arquivo .tar.gz com SHA-256)."
        actions={<button className="btn-primary" onClick={run} disabled={!!busy}>{busy === 'run' ? <Spinner /> : <DatabaseBackup className="h-4 w-4" />}Executar backup agora</button>} />
      <div className="mb-4 flex gap-3 rounded-xl border border-info/30 bg-info/10 p-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div>{data && !data.info.dir ? <>Os arquivos ficam guardados no próprio banco de dados (o servidor não tem disco permanente). <b>Baixe-os periodicamente e guarde em um local separado</b>.</>
          : <>Os arquivos ficam em <code className="rounded bg-muted px-1">{data?.info.dir ?? '…'}</code> no servidor. <b>Copie-os periodicamente para um local separado</b> (outro servidor ou armazenamento externo).</>} Backup automático: {data?.info.autoHours ? `a cada ${data.info.autoHours} h` : 'desativado (defina BACKUP_AUTO_HOURS no servidor)'}.
          A restauração só acrescenta o que falta (não apaga nem altera dados atuais) e antes dela um backup de segurança é criado automaticamente.</div></div>
      <DataTable<B> cols={cols} rows={rows} loading={loading} error={error} onRetry={reload} list={noop} empty={<Empty icon={DatabaseBackup} title="Nenhum backup ainda" hint="Execute o primeiro backup manual." />} />
      {restore && (
        <Modal title="Restaurar backup" size="sm" onClose={() => busy !== 'r' && setRestore(null)}
          footer={<><button className="btn-outline" onClick={() => setRestore(null)} disabled={busy === 'r'}>Cancelar</button><button className="btn-danger" disabled={word !== 'RESTAURAR' || busy === 'r'} onClick={doRestore}>{busy === 'r' && <Spinner />}Restaurar</button></>}>
          <div className="space-y-3 text-sm">
            <p className="rounded-lg border border-info/30 bg-info/10 p-3">Os registros de <span className="font-mono">{restore.filename}</span> ({dmyTime(restore.createdAt)}) que não existem hoje serão <b>adicionados</b>. <b>Nada do que está no sistema agora é apagado ou alterado</b>: registros iguais são ignorados e, quando houver uma versão diferente do mesmo registro, a atual é mantida.</p>
            <label className="block text-xs font-semibold">Digite RESTAURAR para confirmar<input className="input mt-1" value={word} onChange={(e) => setWord(e.target.value)} autoFocus /></label>
          </div>
        </Modal>)}
    </div>
  );
}
