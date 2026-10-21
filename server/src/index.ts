import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db.js';
import { startAutoBackup } from './routes/backup.js';

const applied = await migrate();
if (applied.length) console.log('Migrações aplicadas:', applied.join(', '));
createApp().listen(config.port, () => console.log(`Gentis API em http://localhost:${config.port}`));
startAutoBackup(Number(process.env.BACKUP_AUTO_HOURS ?? 0), Number(process.env.BACKUP_KEEP ?? 14));
