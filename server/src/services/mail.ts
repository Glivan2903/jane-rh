import nodemailer from 'nodemailer';
import { config, isProd } from '../config.js';

export interface Mail { to: string; subject: string; text: string; html?: string }

/** Últimos e-mails "enviados" sem SMTP configurado (desenvolvimento e testes). */
export const outbox: Mail[] = [];

const smtpConfigured = () => !!process.env.SMTP_HOST;
export const mailEnabled = () => smtpConfigured() || !isProd;

let transport: nodemailer.Transporter | undefined;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });
  return transport;
}

/** Envia por SMTP. Sem SMTP_HOST, fora de produção, grava na caixa de saída em memória e imprime no console. */
export async function sendMail(m: Mail): Promise<void> {
  if (!smtpConfigured()) {
    if (isProd) throw new Error('SMTP não configurado (defina SMTP_HOST).');
    outbox.push(m); if (outbox.length > 50) outbox.shift();
    if (process.env.NODE_ENV !== 'test') console.log(`[e-mail simulado] Para: ${m.to}\nAssunto: ${m.subject}\n${m.text}`);
    return;
  }
  await getTransport().sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, ...m });
}

export const appUrl = () => (process.env.APP_URL ?? config.webOrigin).replace(/\/$/, '');
