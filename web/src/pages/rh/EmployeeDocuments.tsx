import { useRef, useState } from 'react';
import { Download, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, ErrorBox, Modal, Skeleton } from '../../components/ui';
import { FInput, FSelect, FTextarea } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm } from '../../lib/hooks';
import { dmy } from '../../lib/format';
import { DocBadge, fileSize, type Doc, type DocType } from './docs';

function DocForm({ employeeId, row, onClose, onSaved }: { employeeId: string; row: Doc | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const types = useFetch<DocType[]>('/rh/document-types');
  const f = useForm({ typeId: row ? String(row.typeId) : '', title: row?.title ?? '', issueDate: row?.issueDate ?? '', expiresAt: row?.expiresAt ?? '', notes: row?.notes ?? '' });
  const file = useRef<HTMLInputElement>(null); const [removeFile, setRemoveFile] = useState(false);
  const list = (types.data ?? []).filter((t) => t.active || t.id === row?.typeId);
  const type = list.find((t) => String(t.id) === f.v.typeId);
  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.typeId) e.typeId = 'Selecione o tipo';
    if (type?.requiresExpiry && !f.v.expiresAt) e.expiresAt = 'Este tipo exige a data de validade';
    if (f.v.issueDate && f.v.expiresAt && f.v.expiresAt < f.v.issueDate) e.expiresAt = 'A validade não pode ser anterior à emissão';
    const fl = file.current?.files?.[0]; if (fl && fl.size > 5 * 1024 * 1024) e.file = 'Arquivo acima de 5 MB';
    return e;
  };
  return (
    <Modal title={row ? 'Editar documento' : 'Adicionar documento'} size="lg" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="docf" className="btn-primary" disabled={f.busy}>Salvar</button></>}>
      <form id="docf" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(async () => {
          const fd = new FormData();
          for (const [k, v] of Object.entries(f.v)) fd.append(k, v);
          const fl = file.current?.files?.[0]; if (fl) fd.append('file', fl); if (removeFile && !fl) fd.append('removeFile', 'true');
          if (row) await api.uploadPut(`/rh/documents/${row.id}`, fd); else await api.upload(`/rh/employees/${employeeId}/documents`, fd);
        }, validate);
        if (ok) { toast.success('Documento salvo.'); onSaved(); }
      }}>
        <FSelect f={f} name="typeId" label="Tipo de documento" required options={list.map((t) => ({ value: t.id, label: t.name }))} className="sm:col-span-2" />
        <FInput f={f} name="title" label="Descrição" hint="Opcional. Ex.: ASO periódico 2026." className="sm:col-span-2" />
        <FInput f={f} name="issueDate" label="Data de emissão" type="date" />
        <FInput f={f} name="expiresAt" label={type?.requiresExpiry ? 'Data de validade' : 'Data de validade (opcional)'} type="date" required={!!type?.requiresExpiry}
          hint={type ? (type.requiresExpiry ? `Avisamos ${type.alertDays} dias antes de vencer.` : undefined) : undefined} />
        <FTextarea f={f} name="notes" label="Observações" className="sm:col-span-2" rows={2} />
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold">Arquivo (PDF, PNG ou JPG, até 5 MB)</label>
          <input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="input mt-1" onChange={() => setRemoveFile(false)} />
          {f.err.file && <span role="alert" className="mt-1 block text-xs text-danger">{f.err.file}</span>}
          {row?.fileName && !removeFile && <p className="mt-1 text-xs text-muted-foreground">Arquivo atual: {row.fileName}. Envie outro para substituir ou <button type="button" className="text-danger underline" onClick={() => { setRemoveFile(true); if (file.current) file.current.value = ''; }}>remover o arquivo</button>.</p>}
          {removeFile && <p className="mt-1 text-xs text-warning">O arquivo atual será removido ao salvar.</p>}
        </div>
      </form>
    </Modal>
  );
}

/** Documentos do funcionário (ficha). Visível só para quem tem a permissão de documentos. */
export function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const docs = useFetch<Doc[]>(`/rh/employees/${employeeId}/documents`);
  const toast = useToast(); const confirm = useConfirm();
  const [edit, setEdit] = useState<Doc | 'new' | null>(null);

  const remove = async (d: Doc) => {
    if (!(await confirm({ title: 'Excluir documento?', message: `"${d.title || d.type}" e o arquivo anexado serão excluídos. A exclusão fica registrada na auditoria.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/rh/documents/${d.id}`); toast.success('Documento excluído.'); docs.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <section className="card p-5" aria-label="Documentos">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display font-bold">Documentos</h2>
        <button className="btn-outline btn-sm" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Adicionar</button>
      </div>
      {docs.error ? <ErrorBox message={docs.error} onRetry={docs.reload} /> : docs.loading && !docs.data ? <Skeleton className="h-20" /> : (docs.data ?? []).length === 0 ? (
        <Empty icon={FileText} title="Nenhum documento cadastrado" hint="Adicione ASO, contratos e outros documentos para acompanhar os vencimentos." action={<button className="btn-primary" onClick={() => setEdit('new')}>Adicionar documento</button>} />
      ) : (
        <ul className="divide-y">
          {docs.data!.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-semibold">{d.title || d.type}</p>
                <p className="truncate text-xs text-muted-foreground">{d.title ? `${d.type} · ` : ''}{d.expiresAt ? `validade ${dmy(d.expiresAt)}` : 'sem validade'}{d.fileName ? ` · ${d.fileName} (${fileSize(d.fileSize)})` : ' · sem arquivo'}</p>
              </div>
              <DocBadge d={d} />
              <div className="flex gap-1">
                {d.fileName && <button className="btn-ghost btn-sm" title="Baixar" aria-label={`Baixar ${d.fileName}`} onClick={() => api.download(`/rh/documents/${d.id}/file`, {}, d.fileName!).catch((e) => toast.error(errMsg(e)))}><Download className="h-4 w-4" /></button>}
                <button className="btn-ghost btn-sm" title="Editar" aria-label="Editar documento" onClick={() => setEdit(d)}><Pencil className="h-4 w-4" /></button>
                <button className="btn-ghost btn-sm text-danger" title="Excluir" aria-label="Excluir documento" onClick={() => remove(d)}><Trash2 className="h-4 w-4" /></button>
              </div>
            </li>))}
        </ul>)}
      {edit && <DocForm employeeId={employeeId} row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); docs.reload(); }} />}
    </section>
  );
}
