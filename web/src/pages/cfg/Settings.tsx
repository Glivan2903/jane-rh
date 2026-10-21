import { useEffect, useState } from 'react';
import { PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';

export default function Settings() {
  const { data, loading, reload } = useFetch<{ allow_negative_stock: boolean }>('/config/settings');
  const [neg, setNeg] = useState(false); const [busy, setBusy] = useState(false); const toast = useToast();
  useEffect(() => { if (data) setNeg(!!data.allow_negative_stock); }, [data]);
  const save = async () => { setBusy(true); try { await api.put('/config/settings', { allow_negative_stock: neg }); toast.success('Parâmetros salvos.'); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Parâmetros do sistema" />
      <div className="card space-y-4 p-5">
        {loading ? <Spinner /> : (
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--primary))]" checked={neg} onChange={(e) => setNeg(e.target.checked)} />
            <span><b className="text-sm">Permitir saldo de estoque negativo</b><span className="block text-sm text-muted-foreground">Por padrão, saídas e ajustes maiores que o saldo disponível são bloqueados (no servidor e no banco). Ative somente se necessário.</span></span>
          </label>)}
        <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy || loading}>{busy && <Spinner />}Salvar</button></div>
      </div>
    </div>
  );
}
