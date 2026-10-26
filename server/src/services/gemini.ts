/*
 * Cliente mínimo da API Gemini (generateContent com streaming e chamada de ferramentas).
 * Os `parts` devolvidos pelo modelo (inclusive thoughtSignature) precisam voltar intactos na rodada seguinte.
 */
export interface GPart {
  text?: string; thought?: boolean; thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
export interface GContent { role: 'user' | 'model'; parts: GPart[] }
export interface FunctionDecl { name: string; description: string; parameters?: Record<string, unknown> }
export interface GenRequest { system: string; contents: GContent[]; tools?: FunctionDecl[]; signal?: AbortSignal }
export type GenEvent =
  | { type: 'text'; delta: string }
  | { type: 'end'; parts: GPart[]; usage: { in: number; out: number }; model: string };
export type GenImpl = (req: GenRequest) => AsyncIterable<GenEvent>;

export class GeminiError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;
/** Modelo principal e reservas, nesta ordem (variáveis: GEMINI_MODEL e GEMINI_FALLBACK_MODELS, separadas por vírgula). */
export const geminiModels = () => [
  process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  ...(process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-flash-lite-latest,gemini-3.5-flash').split(',').map((s) => s.trim()).filter(Boolean),
];

let override: GenImpl | null = null;
/** Somente testes: substitui a chamada real. */
export const setGeminiImpl = (fn: GenImpl | null) => { override = fn; };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * Disjuntor por modelo: um modelo sem cota (429), desativado (404) ou fora do ar (5xx) sai da fila por um tempo,
 * em vez de ser tentado, esperado e repetido a cada pergunta (cada tentativa inútil custa segundos ao usuário).
 */
const cooldown = new Map<string, number>();
export const resetGeminiCooldown = () => cooldown.clear();
const COOL_OUTAGE_MS = 20_000;       // 5xx, timeout ou queda de rede: tenta de novo em 20 s
const COOL_MAX_MS = 15 * 60_000;     // cota diária esgotada: revê a cada 15 min (o limite real pode voltar antes do aviso do Google)
function coolDownFor(status: number, body: string): number {
  if (status === 404) return 60 * 60_000;                                 // modelo descontinuado
  if (status === 429) {
    const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
    const perDay = /PerDay/i.test(body);
    return Math.min(COOL_MAX_MS, Math.max(5_000, delay ? Number(delay) * 1000 : perDay ? COOL_MAX_MS : 10_000));
  }
  return COOL_OUTAGE_MS;
}
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const available = (m: string) => (cooldown.get(m) ?? 0) <= Date.now();

async function openStream(model: string, body: string, signal?: AbortSignal): Promise<Response> {
  // Se o modelo não começar a responder em poucos segundos (sobrecarga), desiste e tenta o próximo; o fluxo todo tem um teto.
  const first = new AbortController();
  const timer = setTimeout(() => first.abort(), Number(process.env.GEMINI_FIRST_BYTE_MS ?? 10000));
  const signals = [first.signal, AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS ?? 60000)), ...(signal ? [signal] : [])];
  try {
    return await fetch(`${BASE}/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST', body, signal: AbortSignal.any(signals),
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
    });
  } finally { clearTimeout(timer); }                                 // cabeçalhos recebidos: o modelo começou a responder
}

async function* realGenerate(req: GenRequest): AsyncGenerator<GenEvent> {
  if (!geminiConfigured()) throw new GeminiError('Assistente não configurado (GEMINI_API_KEY ausente).', 503);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.contents,
    ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
    generationConfig: { temperature: 0.2 },
  });
  // Percorre os modelos disponíveis sem esperar entre eles; se todos falharem, uma segunda volta depois de uma pausa curta.
  let res: Response | null = null; let last = '';
  const chain = geminiModels(); const live = chain.filter(available);
  const order = live.length ? live : chain;                              // todos em pausa: tenta todos mesmo assim
  outer: for (let round = 0; round < 2; round++) {
    for (const model of order) {
      try {
        const r = await openStream(model, body, req.signal);
        if (r.ok) { res = r; (res as Response & { _model?: string })._model = model; cooldown.delete(model); break outer; }
        const txt = await r.text().catch(() => '');
        last = `${model}: ${r.status} ${txt.slice(0, 160)}`;
        if (r.status !== 404 && !RETRYABLE.has(r.status)) throw new GeminiError(`Erro do modelo (${r.status}).`, 502);   // erro de requisição: não adianta repetir
        cooldown.set(model, Date.now() + coolDownFor(r.status, txt));
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        if (req.signal?.aborted) throw e;
        last = `${model}: ${(e as Error).message}`;
        cooldown.set(model, Date.now() + COOL_OUTAGE_MS);
      }
    }
    if (round === 0) await sleep(700);
  }
  if (!res?.body) throw new GeminiError(`O modelo está indisponível no momento. Tente novamente em instantes. (${last.slice(0, 120)})`, 503);

  const model = (res as Response & { _model?: string })._model ?? '';
  const parts: GPart[] = []; let usage = { in: 0, out: 0 };
  const dec = new TextDecoder(); let buf = '';
  const handle = function* (data: string): Generator<GenEvent> {
    let j: { candidates?: { content?: { parts?: GPart[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    try { j = JSON.parse(data); } catch { return; }
    for (const p of j.candidates?.[0]?.content?.parts ?? []) {
      if (p.text === '' && !p.thoughtSignature && !p.functionCall) continue;     // partes vazias não voltam ao histórico
      parts.push(p);
      if (p.text && !p.thought) yield { type: 'text', delta: p.text };
    }
    if (j.usageMetadata) usage = { in: j.usageMetadata.promptTokenCount ?? 0, out: (j.usageMetadata.candidatesTokenCount ?? 0) + (j.usageMetadata.thoughtsTokenCount ?? 0) };
  };
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');      // a API pode separar eventos com \r\n\r\n
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of ev.split('\n')) if (line.startsWith('data:')) yield* handle(line.slice(5).trim());
    }
  }
  if (buf.trim().startsWith('data:')) yield* handle(buf.trim().slice(5).trim());
  yield { type: 'end', parts, usage, model };
}

export const generate: GenImpl = (req) => (override ?? realGenerate)(req);
