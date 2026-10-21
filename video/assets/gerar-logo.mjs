// Gera um logotipo FICTÍCIO ("Exemplo RH") só para a demonstração.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 480, height: 160 } });
await p.setContent(`<html><body style="margin:0;background:transparent"><div style="display:flex;align-items:center;gap:18px;padding:20px 24px;font-family:Arial,sans-serif">
<svg width="110" height="110" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#1e3a8a"/><circle cx="50" cy="38" r="13" fill="#fbbf24"/><path d="M24 78c4-16 16-24 26-24s22 8 26 24" fill="#fbbf24"/></svg>
<div><div style="font-size:46px;font-weight:800;color:#1e3a8a;letter-spacing:-1px">Exemplo RH</div><div style="font-size:18px;color:#475569;letter-spacing:4px">SERVIÇOS EMPRESARIAIS</div></div></div></body></html>`);
await p.screenshot({ path: (await import('node:url')).fileURLToPath(new URL('./logo-empresa-demo.png', import.meta.url)), omitBackground: true });
await b.close();
