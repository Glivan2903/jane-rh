import { AlertTriangle, ArrowLeftRight, Award, BarChart3, Bell, Boxes, Bot, Cake, CalendarDays, CalendarClock, CheckCheck, Compass, FileBarChart, FileText, Filter, FilePlus2, Fingerprint, GitMerge, History, Hourglass,
  Landmark, Layers, LineChart, Link2, ListChecks, MessageSquare, PartyPopper, Scale, ShieldCheck, Tags, Undo2, Upload, Users, Wallet, UserCog, type LucideIcon } from 'lucide-react';
import { ErrorBox } from '../components/ui';
import { SOON, type SoonIcon } from '../lib/soon';

const ICONS: Record<SoonIcon, LucideIcon> = {
  bot: Bot, message: MessageSquare, chart: BarChart3, wallet: Wallet, boxes: Boxes, users: Users, history: History, shield: ShieldCheck, cake: Cake, award: Award, calendar: CalendarDays, party: PartyPopper,
  compass: Compass, file: FileText, list: ListChecks, bell: Bell, upload: Upload, alert: AlertTriangle, line: LineChart, clock: CalendarClock, landmark: Landmark, scale: Scale, transfer: ArrowLeftRight,
  tag: Tags, link: Link2, check: CheckCheck, plus: FilePlus2, undo: Undo2, layers: Layers, filter: Filter, report: FileBarChart, id: Fingerprint, merge: GitMerge,
};

/** Tela de funcionalidade ainda não liberada neste ambiente. Ocupa a área toda e não consulta nada no servidor. */
export default function ComingSoon({ slug }: { slug: string }) {
  const f = SOON[slug];
  if (!f) return <ErrorBox message="Página não encontrada." />;
  const Hero = ICONS[f.icon];
  return (
    <div className="flex min-h-[calc(100dvh-7.5rem)] flex-col gap-4 lg:gap-5">
      <section className="relative shrink-0 overflow-hidden rounded-2xl bg-[#0b1f2e] p-6 text-white sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(20,184,166,.32),transparent_55%),radial-gradient(ellipse_at_95%_100%,rgba(255,122,89,.22),transparent_50%)]" />
        <Hero aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-56 w-56 text-white/[0.06] sm:h-72 sm:w-72 lg:-right-2 lg:h-80 lg:w-80" strokeWidth={1.2} />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-bold text-white"><Hourglass className="h-3.5 w-3.5" />Em breve</span>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{f.label}</h1>
          <p className="mt-2 text-lg font-medium text-[#5eead4] sm:text-xl">{f.headline}</p>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/75">{f.description}</p>
        </div>
      </section>

      <section aria-label="O que será possível fazer" className="flex flex-1 flex-col">
        <h2 className="mb-3 font-display text-lg font-bold">O que será possível fazer</h2>
        <div className="grid flex-1 auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:gap-4">
          {f.items.map((it, i) => {
            const Icon = ICONS[it.icon];
            const n = f.items.length; const rest = n % 3;
            // a última linha se distribui pela largura toda (sem cartão órfão)
            const lg = rest === 1 && i === n - 1 ? 'lg:col-span-6' : rest === 2 && i >= n - 2 ? 'lg:col-span-3' : 'lg:col-span-2';
            const sm = n % 2 === 1 && i === n - 1 ? 'sm:col-span-2' : '';
            return (
              <div key={it.title} className={`card flex flex-col gap-3 p-5 ${sm} ${lg}`}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                <div><h3 className="font-display text-base font-bold">{it.title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{it.text}</p></div>
              </div>);
          })}
        </div>
      </section>

      <div role="note" className="flex shrink-0 items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm sm:items-center">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"><UserCog className="h-5 w-5" /></span>
        <p><b>Este módulo está em desenvolvimento.</b> Para saber quando estará disponível, entre em contato com o administrador do sistema.</p>
      </div>
    </div>
  );
}
