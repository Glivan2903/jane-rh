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
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function openStream(model: string, body: string, signal?: AbortSignal): Promise<Response> {
  // Se o modelo não começar a responder em poucos segundos (sobrecarga), desiste e tenta o próximo; o fluxo todo tem um teto.
  const first = new AbortController();
  const timer = setTimeout(() => first.abort(), Number(process.env.GEMINI_FIRST_BYTE_MS ?? 15000));
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
  // Tenta cada modelo (com uma repetição) enquanto a falha for de capacidade/indisponibilidade; erros de requisição não repetem.
  let res: Response | null = null; let last = '';
  outer: for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await openStream(model, body, req.signal);
        if (r.ok) { res = r; (res as Response & { _model?: string })._model = model; break outer; }
        const txt = await r.text().catch(() => '');
        last = `${r.status} ${txt.slice(0, 200)}`;
        if (r.status === 404) break;                         // modelo desativado: vai para o próximo
        if (!RETRYABLE.has(r.status)) throw new GeminiError(`Erro do modelo (${r.status}).`, r.status === 400 ? 502 : 502);
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        if (req.signal?.aborted) throw e;
        last = (e as Error).message;
      }
      await sleep(800 * (attempt + 1));
    }
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
