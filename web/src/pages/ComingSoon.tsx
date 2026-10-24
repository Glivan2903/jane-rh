import { Check, Hourglass } from 'lucide-react';
import { Badge, ErrorBox } from '../components/ui';
import { SOON } from '../lib/soon';

/** Tela de funcionalidade ainda não liberada neste ambiente. Não consulta nada no servidor. */
export default function ComingSoon({ slug }: { slug: string }) {
  const f = SOON[slug];
  if (!f) return <ErrorBox message="Página não encontrada." />;
  return (
    <div className="mx-auto max-w-2xl pt-2 sm:pt-8">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 border-b bg-primary/5 p-5 sm:p-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground"><Hourglass className="h-6 w-6" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-xl font-bold sm:text-2xl">{f.label}</h1><Badge tone="warning">Em breve</Badge></div>
            <p className="mt-0.5 text-sm text-muted-foreground">{f.headline}</p>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-[15px] leading-relaxed">{f.description}</p>
          <div>
            <h2 className="mb-2 text-sm font-semibold">O que você vai poder fazer</h2>
            <ul className="space-y-2">
              {f.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/15 text-success"><Check className="h-3 w-3" /></span><span>{b}</span></li>))}
            </ul>
          </div>
          <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">Esta funcionalidade está sendo validada antes de ser liberada. Quando estiver disponível, ela aparece aqui, neste mesmo lugar do menu.</p>
        </div>
      </div>
    </div>
  );
}
