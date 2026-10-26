import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Brand } from '../components/brand';
import { Field } from '../components/forms';
import { Spinner } from '../components/ui';
import { api } from '../lib/api';
import { errMsg, useAuth } from '../lib/app';

/** Pede o link de redefinição de senha por e-mail. A resposta é a mesma exista ou não o e-mail. */
export default function ForgotPassword() {
  const { me } = useAuth();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setDone(r.message);
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="card w-full max-w-md p-7 shadow-xl">
        <div className="mb-6"><Brand /></div>
        <h1 className="font-display text-2xl font-bold">Esqueci minha senha</h1>
        {done ? (
          <>
            <p role="status" className="mt-4 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">{done}</p>
            <Link to="/login" className="btn-primary mt-6 w-full !py-2.5">Voltar ao login</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha.</p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
              <Field label="E-mail" required><input className="input" type="email" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
              <button className="btn-primary w-full !py-2.5" disabled={busy || !email}>{busy && <Spinner />}Enviar link</button>
            </form>
            <p className="mt-5 text-center text-sm"><Link to="/login" className="text-primary hover:underline">Voltar ao login</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
