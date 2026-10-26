import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { audit } from '../audit.js';
import { requireAuth } from '../auth.js';
import { HttpError, h, parse } from '../util.js';
import { accessFor, looksLikeInjection, redactCpf, runChat, toolNamesFor } from '../services/ai.js';
import { GeminiError, geminiConfigured, geminiModels } from '../services/gemini.js';

export const aiRouter = Router();

const dailyLimit = () => Number(process.env.AI_DAILY_MESSAGES ?? 40);            // perguntas por usuário por dia
const monthlyTokenLimit = () => Number(process.env.AI_MONTHLY_TOKENS ?? 3_000_000); // tokens (entrada + saída) de todos os usuários por mês
const SP = `(now() AT TIME ZONE 'America/Sao_Paulo')`;

async function usage(userId?: string) {
  const day = (await pool.query(
    `SELECT count(*)::int n FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE m.role = 'user' AND ($1::uuid IS NULL OR c.user_id = $1) AND (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${SP}::date`, [userId ?? null])).rows[0].n as number;
  const month = (await pool.query(
    `SELECT COALESCE(sum(tokens_in + tokens_out),0)::bigint n FROM ai_messages WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', ${SP})`)).rows[0].n;
  return { messagesToday: day, tokensMonth: Number(month) };
}

aiRouter.get('/status', requireAuth(), h(async (req, res) => {
  const access = await accessFor(req.user!);
  const u = await usage(req.user!.id);
  res.json({ configured: geminiConfigured(), model: geminiModels()[0], access, tools: toolNamesFor(access),
    limits: { messagesPerDay: dailyLimit(), tokensPerMonth: monthlyTokenLimit() }, usage: u });
}));

aiRouter.get('/conversations', requireAuth(), h(async (req, res) => {
  res.json((await pool.query(
    `SELECT id, title, updated_at AS "updatedAt" FROM ai_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [req.user!.id])).rows);
}));

aiRouter.get('/conversations/:id', requireAuth(), h(async (req, res) => {
  const c = (await pool.query('SELECT id, title FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id])).rows[0];
  if (!c) throw new HttpError(404, 'Conversa não encontrada');
  const messages = (await pool.query(`SELECT id, role, content, blocks, created_at AS "createdAt" FROM ai_messages WHERE conversation_id = $1 ORDER BY id`, [c.id])).rows;
  res.json({ ...c, messages });
}));

aiRouter.delete('/conversations/:id', requireAuth(), h(async (req, res) => {
  const r = await pool.query('DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  if (!r.rowCount) throw new HttpError(404, 'Conversa não encontrada');
  res.json({ ok: true });
}));

const chatLimiter = rateLimit({
  windowMs: 60_000, limit: Number(process.env.AI_RATE_LIMIT ?? 20), standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? 'anon', validate: false, message: { error: 'Muitas perguntas seguidas. Aguarde um instante.' },
});

const sse = (res: Response, data: unknown) => { res.write(`data: ${JSON.stringify(data)}\n\n`); (res as unknown as { flush?: () => void }).flush?.(); };

aiRouter.post('/chat', requireAuth(), chatLimiter, h(async (req, res) => {
  const body = parse(z.object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1, 'Digite sua pergunta').max(4000, 'Pergunta muito longa') }), req.body);
  const access = await accessFor(req.user!);
  if (!access.enabled || !(access.finance || access.stock || access.hr)) throw new HttpError(403, 'O administrador ainda não liberou o Assistente de IA para o seu usuário.');
  if (!geminiConfigured()) throw new HttpError(503, 'O Assistente de IA ainda não foi configurado neste ambiente.');
  const u = await usage(req.user!.id);
  if (u.messagesToday >= dailyLimit()) throw new HttpError(429, `Limite diário de ${dailyLimit()} perguntas atingido. Tente novamente amanhã.`);
  if (u.tokensMonth >= monthlyTokenLimit()) throw new HttpError(429, 'O limite mensal de uso do Assistente foi atingido. Fale com o administrador.');

  // CPF digitado pelo usuário nunca segue para o modelo (nem é gravado no histórico).
  const message = redactCpf(body.message);
  const suspectInput = looksLikeInjection(message);                                  // não bloqueia (pode ser legítimo): o modelo recusa e a tentativa fica registrada
  let convId = body.conversationId;
  let history: { role: 'user' | 'assistant'; content: string }[] = [];
  if (convId) {
    const c = (await pool.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [convId, req.user!.id])).rows[0];
    if (!c) throw new HttpError(404, 'Conversa não encontrada');
    history = (await pool.query(`SELECT role, content FROM (SELECT id, role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 16) x ORDER BY id`, [convId])).rows;
  } else {
    convId = (await pool.query('INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id', [req.user!.id, message.slice(0, 60)])).rows[0].id as string;
  }
  await pool.query(`INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`, [convId, message]);

  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  sse(res, { type: 'start', conversationId: convId });
  try {
    const r = await runChat({ userName: req.user!.name, access, history, message, signal: abort.signal,
      onText: (delta) => sse(res, { type: 'text', delta }), onTool: (name) => sse(res, { type: 'tool', name }) });
    if (!r.text && !r.blocks.length) throw new GeminiError('O assistente não conseguiu responder. Tente reformular a pergunta.', 502);
    const text = r.text || 'Segue o resultado abaixo.';
    const saved = (await pool.query(
      `INSERT INTO ai_messages (conversation_id, role, content, blocks, tools, model, tokens_in, tokens_out) VALUES ($1,'assistant',$2,$3,$4,$5,$6,$7) RETURNING id`,
      [convId, text, r.blocks.length ? JSON.stringify(r.blocks) : null, r.tools, r.model, r.usage.in, r.usage.out])).rows[0];
    await pool.query('UPDATE ai_conversations SET updated_at = now() WHERE id = $1', [convId]);
    await audit(req, { action: 'consulta_ia', module: 'ia', entity: 'ai_conversation', entityId: convId, summary: `Consulta ao Assistente (${r.tools.length ? r.tools.join(', ') : 'sem consulta a dados'})`,   // o texto da pergunta fica só no histórico do próprio usuário
      
      details: { ferramentas: r.tools, modelo: r.model, consumoEntrada: r.usage.in, consumoSaida: r.usage.out } });
    if (suspectInput || r.suspicious || r.outputFiltered) {
      await audit(req, { action: 'alerta_ia', module: 'ia', entity: 'ai_conversation', entityId: convId, result: 'falha',
        summary: `Possível tentativa de injeção de prompt${suspectInput ? ' na pergunta' : ''}${r.suspicious ? ` e ${r.suspicious} trecho(s) suspeito(s) nos dados` : ''}${r.outputFiltered ? '; saída filtrada' : ''}`,
        details: { naPergunta: suspectInput, nosDados: r.suspicious, saidaFiltrada: r.outputFiltered, pergunta: message.slice(0, 200) } });
    }
    sse(res, { type: 'done', messageId: saved.id, blocks: r.blocks, text, tools: r.tools, usage: r.usage });
  } catch (e) {
    if (!abort.signal.aborted) {
      const msg = e instanceof GeminiError ? e.message : 'Não foi possível concluir a consulta. Tente novamente.';
      if (!(e instanceof GeminiError)) console.error('[ia] erro:', (e as Error).message);
      await audit(req, { action: 'consulta_ia', module: 'ia', entity: 'ai_conversation', entityId: convId, summary: 'Falha ao responder uma pergunta ao Assistente', result: 'falha' }).catch(() => undefined);
      sse(res, { type: 'error', message: msg });
    }
  } finally { res.end(); }
}));

// ---------- Administração: o administrador define o que a IA pode consultar para cada usuário ----------
aiRouter.get('/admin/access', requireAuth('cfg.users'), h(async (_req, res) => {
  const rows = (await pool.query(
    `SELECT u.id, u.name, u.email, r.name AS role, u.active,
            COALESCE(a.enabled,false) AS enabled, COALESCE(a.finance,false) AS finance, COALESCE(a.stock,false) AS stock, COALESCE(a.hr,false) AS hr, COALESCE(a.hr_salary,false) AS "hrSalary",
            (SELECT count(*)::int FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.user_id=u.id AND m.role='user'
                AND date_trunc('month', m.created_at AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', ${SP})) AS "messagesMonth"
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN ai_user_access a ON a.user_id = u.id ORDER BY u.active DESC, lower(u.name)`)).rows;
  res.json({ users: rows.map((r) => ({ ...r, fullAccess: r.role === 'Administrador' })), limits: { messagesPerDay: dailyLimit(), tokensPerMonth: monthlyTokenLimit() }, usage: await usage(), configured: geminiConfigured() });
}));

aiRouter.put('/admin/access/:userId', requireAuth('cfg.users'), h(async (req, res) => {
  const d = parse(z.object({ enabled: z.boolean(), finance: z.boolean().default(false), stock: z.boolean().default(false), hr: z.boolean().default(false), hrSalary: z.boolean().default(false) }), req.body);
  const u = (await pool.query('SELECT u.id, u.name, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [req.params.userId])).rows[0];
  if (!u) throw new HttpError(404, 'Usuário não encontrado');
  if (u.role === 'Administrador') throw new HttpError(409, 'O administrador já tem acesso total ao Assistente.');
  const salary = d.hr && d.hrSalary;                                              // salário só faz sentido com pessoal liberado
  await pool.query(
    `INSERT INTO ai_user_access (user_id, enabled, finance, stock, hr, hr_salary, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (user_id) DO UPDATE SET enabled=$2, finance=$3, stock=$4, hr=$5, hr_salary=$6, updated_by=$7, updated_at=now()`,
    [u.id, d.enabled, d.finance, d.stock, d.hr, salary, req.user!.id]);
  const areas = [d.finance && 'financeiro', d.stock && 'estoque', d.hr && 'pessoal', salary && 'salários'].filter(Boolean).join(', ') || 'nenhuma área';
  await audit(req, { action: 'permissao_ia', module: 'config', entity: 'ai_user_access', entityId: u.id, summary: `Acesso do Assistente de IA para ${u.name}: ${d.enabled ? `liberado (${areas})` : 'bloqueado'}`, details: { ...d, hrSalary: salary } });
  res.json({ ok: true });
}));
