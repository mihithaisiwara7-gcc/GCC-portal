import bcrypt from 'bcryptjs';
import { sqlite } from './sqlite.js';

const username = 'Alpha';
const password = process.env.ADMIN_RESET_PASSWORD || '12345678';
if (password.length < 8) {
  console.error('Admin password must be at least 8 characters.');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
const existing = sqlite.prepare('SELECT id FROM idps_users WHERE username = ?').get(username);
if (existing) {
  sqlite.prepare("UPDATE idps_users SET password_hash = ?, role = 'admin', theme_key = NULL, active = 1 WHERE username = ?").run(hash, username);
} else {
  sqlite.prepare("INSERT INTO idps_users (username, password_hash, role, theme_key, active) VALUES (?, ?, 'admin', NULL, 1)").run(username, hash);
}
console.log(`Administrator credentials reset for ${username}.`);
console.log('Use the configured password to sign in, then change it to a strong unique password.');
sqlite.close();
