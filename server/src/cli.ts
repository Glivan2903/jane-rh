import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { migrate, pool } from './db.js';
import { strongPassword, PASSWORD_RULE } from './auth.js';

const cmd = process.argv[2];

async function ask(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
  }
  const a = await rl.question(q);
  rl.close();
  if (hidden) process.stdout.write('\n');
  return a.trim();
}

if (cmd === 'migrate') {
  console.log('Aplicadas:', (await migrate()).join(', ') || '(nenhuma, já atualizado)');
} else if (cmd === 'create-admin') {
  // Cria o primeiro administrador. Use variáveis ADMIN_NAME/ADMIN_EMAIL/ADMIN_PASSWORD ou responda aos prompts.
  await migrate();
  const exists = (await pool.query(`SELECT count(*)::int n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'`)).rows[0].n;
  if (exists > 0 && process.env.ALLOW_EXTRA_ADMIN !== 'true') {
    console.error('Já existe um administrador. Para criar outro, defina ALLOW_EXTRA_ADMIN=true ou use Configurações > Usuários.');
    process.exit(1);
  }
  const name = process.env.ADMIN_NAME || await ask('Nome completo: ');
  const email = (process.env.ADMIN_EMAIL || await ask('E-mail: ')).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || await ask('Senha: ', true);
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) { console.error('Nome ou e-mail inválido.'); process.exit(1); }
  if (!strongPassword(password)) { console.error(PASSWORD_RULE); process.exit(1); }
  const role = (await pool.query(`SELECT id FROM roles WHERE name='Administrador'`)).rows[0];
  await pool.query(`INSERT INTO users (name,email,password_hash,role_id) VALUES ($1,$2,$3,$4)`, [name, email, await bcrypt.hash(password, 12), role.id]);
  await pool.query(`INSERT INTO audit_logs (action,module,entity,summary,user_name) VALUES ('criar','config','user',$1,'cli')`, [`Administrador inicial criado: ${email}`]);
  console.log('Administrador criado com sucesso.');
} else {
  console.log('Uso: npm run migrate | npm run create-admin');
}
await pool.end();
