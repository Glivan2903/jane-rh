// Grava a navegação pelo Gentis (API de demonstração na porta 3003), cena a cena, no ritmo da narração.
// Saída: captura/frames/*.jpg + captura/timeline.json (instantes dos quadros e início de cada cena).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DEMO_URL ?? 'http://localhost:3003';
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const OUT = path.join(AQUI, 'captura');
const FRAMES = path.join(OUT, 'frames');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const narr = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(AQUI, 'remotion/public/narracao.json'), 'utf8')).map((n) => [n.id, n]));

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--hide-scrollbars', '--font-render-hinting=none'] });
// 1600×900: o mesmo tamanho da janela na composição do Remotion (imagem 1:1, nítida)
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('gentis-theme', 'light'); localStorage.setItem('gentis-sb-mode', 'full'); } catch {}
  // Sem GPU, o desfoque de fundo (backdrop-filter) deixa cada quadro lento: desligado só na gravação.
  const st = () => { const e = document.createElement('style'); e.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'; document.documentElement.appendChild(e); };
  if (document.documentElement) st(); else document.addEventListener('DOMContentLoaded', st);
  // Cursor visível (o screencast do Chrome não desenha o ponteiro do sistema)
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 21l-3 1.3-3.5-8.1L4 18z" fill="#0b1f2e" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
    document.documentElement.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: `${e.clientX - 18}px`, top: `${e.clientY - 18}px`, width: '36px', height: '36px', borderRadius: '50%', border: '3px solid #ff7a59', zIndex: '2147483646', pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.3)', opacity: '1' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.6)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

// ---- captura via CDP screencast ----
const cdp = await ctx.newCDPSession(page);
const frames = [];
let n = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = `${String(n++).padStart(6, '0')}.jpg`;
  frames.push({ file, ts: metadata.timestamp });
  fs.writeFile(path.join(FRAMES, file), Buffer.from(data, 'base64'), () => {});
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

// ---- utilitários de "atuação" ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mx = 800, my = 450;
async function moveTo(x, y, steps = 22) { await page.mouse.move(x, y, { steps }); mx = x; my = y; }
async function point(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error('elemento sem posição');
  await moveTo(b.x + b.width / 2, b.y + b.height / 2);
  return b;
}
async function click(loc) { await point(loc); await sleep(180); await page.mouse.click(mx, my); await sleep(350); }
async function type(loc, text) { await click(loc); await loc.pressSequentially(text, { delay: 55 }); await sleep(250); }
async function pick(loc, opt) { await point(loc); await sleep(250); await loc.selectOption(opt); await sleep(450); }
async function setDate(loc, v) { await point(loc); await sleep(200); await loc.fill(v); await sleep(350); }
async function wheel(total, step = 90) { await moveTo(940, 580, 10); for (let s = 0; s < Math.abs(total); s += step) { await page.mouse.wheel(0, Math.sign(total) * step); await sleep(55); } }
const L = (label, root = page) => root.getByLabel(label, { exact: false }).first();
const dlg = () => page.locator('[role=dialog]').last();
const aside = (href) => page.locator(`aside a[href="${href}"]`).first();
async function openGroup(name) {
  const b = page.locator('aside button', { hasText: name }).first();
  if ((await b.getAttribute('aria-expanded')) !== 'true') await click(b);
}

// ---- cenas ----
const timeline = [];
async function cena(id, fn) {
  const d = narr[id]?.duracao ?? 6;
  const t0 = Date.now();
  timeline.push({ id, start: t0 / 1000 });
  const at = async (s) => { const w = t0 + s * 1000 - Date.now(); if (w > 0) await sleep(w); };
  // limite por cena: se algo travar, segue para a próxima (a montagem corta o trecho parado)
  const limite = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo limite da cena')), (d + 25) * 1000));
  try { await Promise.race([fn(at, d), limite]); } catch (e) { console.error(`! cena ${id}: ${e.message.split('\n')[0]}`); }
  await at(d + 0.8);
  console.log(`✓ ${id} (${((Date.now() - t0) / 1000).toFixed(1)}s / narração ${d.toFixed(1)}s)`);
}

await page.goto(BASE + '/login');
await page.waitForLoadState('networkidle');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1600, maxHeight: 900, everyNthFrame: 1 });
await sleep(300);

await cena('login', async (at) => {
  await at(1.5); await moveTo(1150, 300, 30);
  await at(3); await type(page.locator('input[autocomplete=username]'), 'admin@gentis.demo');
  await type(page.locator('input[type=password]'), 'GentisDemo2026');
  await at(10.5); await click(page.getByRole('button', { name: 'Entrar' }));
});

await cena('dashboard', async (at) => {
  await page.getByText('Olá,').waitFor(); await at(2.5);
  for (const t of ['Funcionários ativos', 'Admissões no período', 'Por departamento']) { await point(page.getByText(t).first()); await sleep(1300); }
});

await cena('dashboard-periodo', async (at) => {
  await at(1.5); await click(page.getByRole('button', { name: 'Mês anterior' }));
  await at(4.5); await click(page.getByRole('button', { name: 'Ano atual' }));
  await at(8); await click(page.getByRole('button', { name: 'Mês atual' }));
});

await cena('dashboard-graficos', async () => { await wheel(2600, 70); await sleep(700); });

await cena('menu', async (at) => {
  await page.locator('main').evaluate((m) => m.scrollTo({ top: 0, behavior: 'smooth' }));
  await at(1); await openGroup('RH / Pessoal'); await openGroup('Financeiro'); await openGroup('Estoque');
  await at(6.5); await click(page.locator('button[aria-label="Recolher menu"]'));
  await at(9.5); await click(page.locator('button[aria-label="Expandir menu"]'));
  await at(11); await click(page.locator('button[aria-label^="Notificações"]'));
  await at(14.2); await click(page.locator('button[aria-label^="Notificações"]'));
});

await cena('rh-lista', async (at) => {
  await openGroup('RH / Pessoal'); await click(aside('/rh/funcionarios'));
  await at(5); await type(page.getByPlaceholder('Buscar nome, CPF'), 'Juliana');
  await at(9.5); await page.getByPlaceholder('Buscar nome, CPF').fill(''); await sleep(400);
  await at(12); await pick(page.locator('select[aria-label="Situação"]'), 'todos');
});

const NOVO = 'Renata Oliveira Prado';
await cena('rh-novo', async (at) => {
  await click(page.getByRole('link', { name: 'Novo funcionário' }));
  await type(L('Nome completo'), NOVO);
  await type(L('CPF'), '62918473537');
  await type(L('Telefone principal'), '11987651234');
  await type(L('E-mail pessoal'), 'renata@email.demo');
  await type(L('CEP'), '01310100'); await page.keyboard.press('Tab'); await sleep(900);
  await type(page.getByLabel('Número', { exact: true }), '1000');
});

await cena('rh-vt', async () => {
  await type(L('Nº Folha'), '100520');
  await type(L('Nº PIS/PASEP'), '12398745610');
  await pick(L('Cargo'), { label: 'Atendente' });
  await pick(L('Departamento'), { label: 'Atendimento' });
  await pick(L('Tipo de vínculo'), 'CLT');
  await setDate(L('Data de admissão'), '2026-10-20');
  await type(L('Salário contratual'), '2450');
  await click(page.getByRole('radio', { name: 'Sim' }));
});

await cena('rh-ficha', async (at) => {
  await click(page.getByRole('button', { name: 'Cadastrar funcionário' }));
  await page.getByRole('heading', { name: NOVO }).waitFor();
  await at(3); await point(page.getByLabel('Situação do vínculo'));
  await at(6); await wheel(500); await at(8.5); await wheel(-500);
});

await cena('rh-desligar', async (at) => {
  await click(page.getByRole('button', { name: 'Voltar' }));
  await click(page.getByRole('link', { name: 'Lucas Pereira Duarte' }));
  await page.getByRole('heading', { name: 'Lucas Pereira Duarte' }).waitFor(); await sleep(600);
  await click(page.locator('main').getByRole('button', { name: 'Desligar' }));
  await setDate(L('Data de desligamento', dlg()), '2026-10-20');
  await pick(L('Motivo', dlg()), 'Término de contrato');
  await click(dlg().getByRole('button', { name: 'Registrar desligamento' }));
  await sleep(500); await click(dlg().getByRole('button', { name: 'Confirmar desligamento' }));
  await sleep(1200); await point(page.getByLabel('Situação do vínculo')); await sleep(1800);
});

await cena('rh-cadastros', async (at) => {
  await click(aside('/rh/cadastros'));
  await at(4.5); await click(page.getByRole('tab', { name: 'Cargos' }));
});

await cena('rh-relatorios', async (at) => {
  await click(aside('/rh/relatorios'));
  await at(3); await pick(page.locator('select[aria-label="Relatório"]'), 'admissoes');
  await setDate(page.getByLabel('De', { exact: true }), '2026-01-01');
  await click(page.getByRole('button', { name: 'Gerar' }));
  await at(10); await point(page.getByRole('button', { name: 'Exportar CSV' }));
});

await cena('fin-visao', async () => {
  await openGroup('Financeiro'); await click(aside('/financeiro'));
  await sleep(2500); await wheel(900, 60); await sleep(1500); await wheel(-900);
});

const REC = 'Consultoria em gestão de pessoas';
await cena('fin-receita', async () => {
  await click(aside('/financeiro/receitas'));
  await click(page.getByRole('button', { name: 'Nova receita' }));
  const d = dlg();
  await type(L('Descrição', d), REC);
  await pick(L('Categoria financeira', d), { label: 'Serviços prestados' });
  await type(L('Cliente', d), 'Empresa Beta (fictícia)');
  await type(L('Valor', d), '4800');
  await pick(L('Forma de recebimento', d), 'PIX');
  await setDate(L('Data de competência', d), '2026-10-21');
  await setDate(L('Data de vencimento', d), '2026-10-21');
  await click(d.getByRole('button', { name: 'Salvar' }));
});

await cena('fin-baixa', async () => {
  await sleep(600);
  await click(page.locator(`button[aria-label="Baixar ${REC}"]`));
  await sleep(800); await click(dlg().getByRole('button', { name: 'Confirmar recebimento' }));
  await sleep(900); await point(page.locator('tr', { hasText: REC }).getByText('Recebida'));
});

await cena('fin-despesas', async () => {
  await click(aside('/financeiro/despesas'));
  await pick(page.locator('select[aria-label="Situação"]'), 'vencida');
});

await cena('fin-categorias', async () => { await click(aside('/financeiro/categorias')); await sleep(1500); await wheel(500); });

await cena('fin-relatorios', async () => {
  await click(aside('/financeiro/relatorios'));
  await pick(page.locator('select[aria-label="Relatório"]'), 'fluxo-caixa');
  await setDate(page.getByLabel('De', { exact: true }), '2026-09-01');
  await click(page.getByRole('button', { name: 'Gerar' }));
});

await cena('est-produtos', async () => {
  await openGroup('Estoque'); await click(aside('/estoque'));
  await sleep(1200); await point(page.getByText(/alerta\(s\) de estoque/)); await sleep(1500);
  await point(page.locator('tr', { hasText: 'Papel toalha' }).getByText('Sem estoque'));
});

await cena('est-novo', async () => {
  await click(page.getByRole('button', { name: 'Novo produto' }));
  const d = dlg();
  await type(L('Nome do produto', d), 'Etiqueta adesiva (rolo)');
  await pick(L('Categoria', d), { label: 'Escritório' });
  await pick(L('Unidade de medida', d), { label: 'UN — Unidade' });
  await type(L('Custo unitário', d), '12.5');
  await type(L('Quantidade inicial', d), '20');
  await type(L('Estoque mínimo', d), '5');
  await click(d.getByRole('button', { name: 'Salvar' }));
});

await cena('est-entrada', async () => {
  await sleep(500);
  await click(page.locator('button[aria-label="Entrada de Detergente neutro 5L"]'));
  const d = dlg();
  await type(L('Quantidade recebida', d), '10');
  await type(L('Custo unitário', d), '30');
  await type(L('Nº da nota fiscal', d), '5530');
  await click(d.getByRole('button', { name: 'Confirmar entrada' }));
});

await cena('est-saida', async () => {
  await sleep(500);
  await click(page.locator('button[aria-label="Saída de Papel A4 75g (resma)"]'));
  const d = dlg();
  await type(L('Quantidade retirada', d), '999');
  await pick(L('Motivo', d), 'Consumo interno');
  await click(d.getByRole('button', { name: 'Confirmar saída' }));
  await sleep(1800);
  await L('Quantidade retirada', d).fill(''); await type(L('Quantidade retirada', d), '8');
  await click(d.getByRole('button', { name: 'Confirmar saída' }));
});

await cena('est-movimentacoes', async () => { await click(aside('/estoque/movimentacoes')); await sleep(2500); await pick(page.locator('select[aria-label="Tipo"]'), 'entrada'); });

await cena('cfg-usuarios', async () => {
  await openGroup('Configurações'); await click(aside('/config/usuarios'));
  await click(page.getByRole('button', { name: 'Novo usuário' }));
  const d = dlg();
  await type(L('Nome completo', d), 'Paulo Henrique Dias');
  await type(L('E-mail de acesso', d), 'paulo@gentis.demo');
  await point(L('Perfil de acesso', d)); await sleep(1200);
  await type(L('Senha inicial', d), 'SenhaInicial2026');
  await click(d.getByRole('button', { name: 'Salvar' }));
});

await cena('cfg-perfis', async () => {
  await click(aside('/config/perfis'));
  await click(page.locator('main button', { hasText: 'RH' }).first());
  await sleep(1500); await point(page.getByText('RH / Pessoal').last());
});

await cena('cfg-empresa', async () => {
  await click(aside('/config/empresa'));
  await type(L('Razão social'), 'Exemplo Serviços Empresariais Ltda');
  await type(L('CNPJ'), '11222333000181');
  await type(L('Nome fantasia'), 'Exemplo RH');
  await type(L('CEP'), '01310100'); await page.keyboard.press('Tab'); await sleep(900);
  await type(page.getByLabel('Número', { exact: true }), '1000');
  await type(page.getByLabel('Telefone', { exact: true }), '1130001234');
  await type(L('E-mail'), 'contato@exemplo.demo');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), click(page.getByRole('button', { name: 'Enviar' }))]);
  await fc.setFiles(path.join(AQUI, 'assets/logo-empresa-demo.png')); await sleep(1200);
  await click(page.getByRole('button', { name: 'Salvar dados da empresa' }));
});

await cena('impressao', async (at) => {
  await openGroup('RH / Pessoal'); await click(aside('/rh/relatorios'));
  await sleep(1500); await point(page.getByRole('button', { name: 'Imprimir' }));
  await page.emulateMedia({ media: 'print' }); await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await at(Math.max(4, (narr.impressao?.duracao ?? 10) - 1.5));
  await page.emulateMedia({ media: 'screen' });
});

await cena('cfg-auditoria', async () => { await openGroup('Configurações'); await click(aside('/config/auditoria')); });

await cena('cfg-backup', async () => {
  await click(aside('/config/backup'));
  await click(page.getByRole('button', { name: 'Executar backup agora' }));
});

await cena('tema', async (at) => {
  await click(page.getByRole('button', { name: 'Menu do usuário' }));
  await point(page.getByRole('button', { name: 'Alterar senha' })); await sleep(1200);
  await click(page.getByRole('button', { name: 'Menu do usuário' }));
  await at(3.5); await click(page.getByRole('button', { name: 'Tema escuro' }));
  await click(aside('/'));
});

await sleep(1500);
await cdp.send('Page.stopScreencast');
await sleep(800);
await browser.close();
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ scenes: timeline, frames }, null, 1));
console.log(`${frames.length} quadros gravados.`);
