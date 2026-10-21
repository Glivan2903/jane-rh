import type { ReactNode } from 'react';
import type { FormApi } from '../lib/hooks';
import { Spinner } from './ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type F = FormApi<any>;

export function Field({ label, required, error, hint, children, className = '' }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold">{label}{required && <span className="ml-0.5 text-danger" aria-hidden> *</span>}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

interface InputProps { f: F; name: string; label: string; required?: boolean; type?: string; mask?: (v: string) => string; hint?: string; placeholder?: string; className?: string; min?: string | number; max?: string | number; step?: string | number; disabled?: boolean; autoFocus?: boolean; autoComplete?: string }
export function FInput({ f, name, label, required, type = 'text', mask, hint, className, ...rest }: InputProps) {
  const err = f.err[name];
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <input {...rest} type={type} className={`input ${err ? 'input-error' : ''}`} aria-invalid={!!err} value={(f.v[name] as string | number | undefined) ?? ''}
        onChange={(e) => f.set(name, mask ? mask(e.target.value) : e.target.value)} />
    </Field>
  );
}

export interface Opt { value: string | number; label: string }
export function FSelect({ f, name, label, options, required, placeholder = 'Selecione…', hint, className, disabled }: { f: F; name: string; label: string; options: Opt[]; required?: boolean; placeholder?: string; hint?: string; className?: string; disabled?: boolean }) {
  const err = f.err[name];
  return (
    <Field label={label} required={required} error={err} hint={hint} className={className}>
      <select className={`input ${err ? 'input-error' : ''}`} disabled={disabled} aria-invalid={!!err} value={(f.v[name] as string | number | undefined) ?? ''} onChange={(e) => f.set(name, e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function FTextarea({ f, name, label, required, rows = 3, className }: { f: F; name: string; label: string; required?: boolean; rows?: number; className?: string }) {
  const err = f.err[name];
  return (
    <Field label={label} required={required} error={err} className={className}>
      <textarea rows={rows} className={`input ${err ? 'input-error' : ''}`} value={(f.v[name] as string | undefined) ?? ''} onChange={(e) => f.set(name, e.target.value)} />
    </Field>
  );
}

/** Sim / Não (campos booleanos como "optante por vale-transporte"). Sem <label> para não contaminar o nome acessível dos botões. */
export function FYesNo({ f, name, label, className = '' }: { f: F; name: string; label: string; className?: string }) {
  const val = !!f.v[name];
  const id = `yn-${name}`;
  return (
    <div className={className}>
      <span id={id} className="mb-1 block text-xs font-semibold">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex rounded-lg border bg-card p-0.5">
        {[{ v: true, l: 'Sim' }, { v: false, l: 'Não' }].map((o) => (
          <button key={o.l} type="button" role="radio" aria-checked={val === o.v} onClick={() => f.set(name, o.v)}
            className={`min-w-16 rounded-md px-4 py-1.5 text-sm font-semibold transition ${val === o.v ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}

export function FCheck({ f, name, label }: { f: F; name: string; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={!!f.v[name]} onChange={(e) => f.set(name, e.target.checked)} />{label}
    </label>
  );
}

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="mb-5"><legend className="mb-3 w-full border-b pb-1.5 font-display text-sm font-bold text-primary">{title}</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div></fieldset>
);

export const SubmitButton = ({ busy, children, className = 'btn-primary' }: { busy: boolean; children: ReactNode; className?: string }) => (
  <button type="submit" className={className} disabled={busy}>{busy && <Spinner />}{children}</button>
);

/** Barra de filtros de listagens. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="no-print mb-4 grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
export const SearchBox = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
  <input type="search" aria-label={placeholder} className="input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
);
export const FilterSelect = ({ value, onChange, options, placeholder, label }: { value: string; onChange: (v: string) => void; options: Opt[]; placeholder: string; label: string }) => (
  <select aria-label={label} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);
export const FilterDate = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="whitespace-nowrap">{label}</span><input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} /></label>
);
