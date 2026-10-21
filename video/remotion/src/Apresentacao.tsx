import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadJakarta } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadSora } from '@remotion/google-fonts/Sora';
import narracao from '../public/narracao.json';
import tela from '../public/cenas.json';

const { fontFamily: jakarta } = loadJakarta('normal', { weights: ['400', '500', '600', '700'] });
const { fontFamily: sora } = loadSora('normal', { weights: ['600', '700'] });

export const FPS = 30;
const C = { navy: '#0b1f2e', navy2: '#0f2a3d', teal: '#14b8a6', tealLight: '#5eead4', coral: '#ff7a59' };

interface Frase { inicio: number; fim: number; texto: string }
interface Narr { id: string; secao: string; texto: string; duracao: number; frases: Frase[] }
const N = Object.fromEntries((narracao as Narr[]).map((n) => [n.id, n]));
const cenas = (tela as { duracao: number; cenas: { id: string; inicio: number }[] });

const f = (s: number) => Math.round(s * FPS);
const INTRO = f(N.abertura.duracao + 1.6);
const PRINCIPAL = f(cenas.duracao);
const OUTRO = f(N.encerramento.duracao + 2.2);
const FADE = 18;
export const duracaoTotal = INTRO + PRINCIPAL + OUTRO - FADE * 2;

// ---------- elementos de marca ----------
function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14b8a6" /><stop offset="1" stopColor="#0f5e66" /></linearGradient></defs>
      <rect width="48" height="48" rx="14" fill="url(#g)" />
      <path d="M34.5 17.5A13 13 0 1 0 36.5 26H25" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="21.5" r="3.6" fill="#ff7a59" />
    </svg>
  );
}

/** Fundo navy com rede de pontos em movimento (mesmo conceito da tela de login). */
function Fundo() {
  const frame = useCurrentFrame();
  const pts = Array.from({ length: 46 }, (_, i) => {
    const a = (i * 137.5) % 360, r = 0.15 + ((i * 53) % 100) / 120;
    const x = 960 + Math.cos((a * Math.PI) / 180 + frame / (260 + i * 3)) * 980 * r;
    const y = 540 + Math.sin((a * Math.PI) / 180 + frame / (300 + i * 2)) * 560 * r;
    return { x, y, warm: i % 9 === 0 };
  });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 18% 12%, rgba(20,184,166,.30), transparent 55%), radial-gradient(ellipse at 88% 92%, rgba(255,122,89,.20), transparent 50%), ${C.navy}` }}>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, opacity: 0.55 }}>
        {pts.map((a, i) => pts.slice(i + 1).map((b, j) => {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          return d < 230 ? <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5eead4" strokeOpacity={0.35 * (1 - d / 230)} strokeWidth={1.2} /> : null;
        }))}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.warm ? 4 : 2.6} fill={p.warm ? C.coral : '#99f6e4'} />)}
      </svg>
    </AbsoluteFill>
  );
}

function Legenda({ narr, t }: { narr: Narr; t: number }) {
  const atual = narr.frases.find((fr) => t >= fr.inicio - 0.05 && t <= fr.fim + 0.25);
  if (!atual) return null;
  return (
    <div style={{ maxWidth: 1500, padding: '12px 26px', borderRadius: 16, background: 'rgba(6,17,26,.82)', color: '#fff', fontFamily: jakarta, fontSize: 30, fontWeight: 500, lineHeight: 1.3, textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
      {atual.texto}
    </div>
  );
}

// ---------- abertura e encerramento ----------
function Cartao({ narr, titulo, subtitulo, chamada }: { narr: Narr; titulo: string; subtitulo: string; chamada: string }) {
  const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  const s2 = spring({ frame: frame - 12, fps, config: { damping: 18 } });
  const s3 = spring({ frame: frame - 24, fps, config: { damping: 18 } });
  const fade = interpolate(frame, [0, FADE, durationInFrames - FADE, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const t = (frame - f(0.6)) / fps;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Fundo />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 26 }}>
        <div style={{ transform: `scale(${s}) rotate(${(1 - s) * -25}deg)` }}><Logo size={170} /></div>
        <div style={{ opacity: s2, transform: `translateY(${(1 - s2) * 30}px)`, fontFamily: sora, fontWeight: 700, fontSize: 120, color: '#fff', letterSpacing: -2 }}>{titulo}</div>
        <div style={{ opacity: s3, transform: `translateY(${(1 - s3) * 20}px)`, fontFamily: jakarta, fontSize: 30, letterSpacing: 8, textTransform: 'uppercase', color: 'rgba(255,255,255,.65)' }}>{subtitulo}</div>
        <div style={{ opacity: s3, marginTop: 18, padding: '10px 26px', borderRadius: 999, background: 'rgba(20,184,166,.18)', border: '1px solid rgba(94,234,212,.45)', color: C.tealLight, fontFamily: jakarta, fontWeight: 600, fontSize: 28 }}>{chamada}</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 60 }}><Legenda narr={narr} t={t} /></AbsoluteFill>
      <Sequence from={f(0.6)}><Audio src={staticFile(`audio/${narr.id}.mp3`)} /></Sequence>
    </AbsoluteFill>
  );
}

// ---------- parte principal: gravação de tela emoldurada ----------
const BOX = { w: 1600, h: 900, x: 160, y: 72 };

function Principal() {
  const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const idx = Math.max(0, cenas.cenas.findIndex((c, i) => t >= c.inicio && (i === cenas.cenas.length - 1 || t < cenas.cenas[i + 1].inicio)));
  const cena = cenas.cenas[idx];
  const narr = N[cena.id];
  const entrou = spring({ frame: frame - f(cena.inicio), fps, config: { damping: 16 } });
  const fade = interpolate(frame, [0, FADE, durationInFrames - FADE, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const zoom = interpolate(frame, [0, FADE * 2], [0.96, 1], { extrapolateRight: 'clamp' });
  const progresso = frame / durationInFrames;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Fundo />
      {/* barra superior: marca + seção atual */}
      <div style={{ position: 'absolute', left: BOX.x, right: 1920 - BOX.x - BOX.w, top: 14, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: sora, fontWeight: 700, fontSize: 24, color: '#fff' }}><Logo size={34} />Gentis <span style={{ fontFamily: jakarta, fontWeight: 500, fontSize: 18, color: 'rgba(255,255,255,.55)' }}>Apresentação e usabilidade</span></div>
        <div style={{ transform: `translateX(${(1 - entrou) * 40}px)`, opacity: entrou, padding: '7px 18px', borderRadius: 999, background: C.teal, color: '#062a2a', fontFamily: jakarta, fontWeight: 700, fontSize: 20 }}>{narr?.secao}</div>
      </div>
      {/* janela do navegador */}
      <div style={{ position: 'absolute', left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h, borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)', transform: `scale(${zoom})` }}>
        <OffthreadVideo src={staticFile('tela.mp4')} muted style={{ width: '100%', height: '100%' }} />
      </div>
      {/* legenda + progresso */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 22, display: 'flex', justifyContent: 'center' }}>{narr && <Legenda narr={narr} t={t - cena.inicio - 0.3} />}</div>
      <div style={{ position: 'absolute', left: BOX.x, width: BOX.w, top: BOX.y + BOX.h + 12, height: 4, borderRadius: 4, background: 'rgba(255,255,255,.12)' }}>
        <div style={{ width: `${progresso * 100}%`, height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${C.teal}, ${C.coral})` }} />
      </div>
      {cenas.cenas.map((c) => N[c.id] && (
        <Sequence key={c.id} from={f(c.inicio + 0.3)} durationInFrames={f(N[c.id].duracao + 0.5)}><Audio src={staticFile(`audio/${c.id}.mp3`)} /></Sequence>
      ))}
    </AbsoluteFill>
  );
}

export function Apresentacao() {
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <Sequence durationInFrames={INTRO}>
        <Cartao narr={N.abertura} titulo="Gentis" subtitulo="Pessoas & Negócios" chamada="Apresentação e usabilidade do sistema" />
      </Sequence>
      <Sequence from={INTRO - FADE} durationInFrames={PRINCIPAL}><Principal /></Sequence>
      <Sequence from={INTRO + PRINCIPAL - FADE * 2} durationInFrames={OUTRO}>
        <Cartao narr={N.encerramento} titulo="Gentis" subtitulo="Pessoas & Negócios" chamada="Simples · Seguro · Completo" />
      </Sequence>
    </AbsoluteFill>
  );
}

