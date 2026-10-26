import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/brand';
import { Field } from '../components/forms';
import { Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { errMsg, useAuth, useToast } from '../lib/app';

/** Destino do link enviado por e-mail: define a nova senha com o token de uso único. */
export default function ResetPassword() {
  const { me } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState(''); const [fields, setFields] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(''); setFields({});
    try {
      await api.post('/auth/reset-password', { token, ...f });
      toast.success('Senha redefinida. Entre com a nova senha.');
      nav('/login', { replace: true });
    } catch (x) {
      setErr(errMsg(x));
      if (x instanceof ApiError && x.fields) setFields(x.fields);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="card w-full max-w-md p-7 shadow-xl">
        <div className="mb-6"><Brand /></div>
        <h1 className="font-display text-2xl font-bold">Nova senha</h1>
        {!token ? (
          <>
            <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">Link inválido. Solicite uma nova redefinição.</p>
            <Link to="/esqueci-senha" className="btn-primary mt-6 w-full !py-2.5">Solicitar novo link</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Mínimo de 10 caracteres, com letras e números.</p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Field label="Nova senha" required error={fields.password}><input className="input" type="password" autoFocus autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
              <Field label="Confirmar nova senha" required error={fields.confirm}><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
              {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
              <button className="btn-primary w-full !py-2.5" disabled={busy || !f.password || !f.confirm}>{busy && <Spinner />}Redefinir senha</button>
            </form>
            {err.includes('expirado') && <p className="mt-4 text-center text-sm"><Link to="/esqueci-senha" className="text-primary hover:underline">Solicitar novo link</Link></p>}
          </>
        )}
      </div>
    </div>
  );
}
