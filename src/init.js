import fs from 'node:fs';
import { config } from './config.js';
import { ensureInitialAdmin } from './sqlite.js';
import { initPostgres, pool } from './postgres.js';

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.rootDir + '/storage', { recursive: true });

await ensureInitialAdmin();
if (config.databaseUrl) {
  await initPostgres();
  await pool.end();
}

console.log('Local IDPS database initialized.');
console.log('Initial admin: Alpha / 12345678');
console.log('Change this temporary password immediately after login.');
