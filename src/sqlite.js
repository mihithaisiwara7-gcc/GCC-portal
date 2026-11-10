import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { config } from './config.js';

const dbPath = path.join(config.rootDir, 'storage', 'idps.sqlite');
export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS idps_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher' CHECK(role IN ('admin','teacher')),
    theme_key TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export async function ensureInitialAdmin() {
  const bootstrapKey = 'admin_password_reset_20261029';
  const resetAlreadyApplied = sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(bootstrapKey);
  const existing = sqlite.prepare('SELECT id FROM idps_users WHERE username = ?').get('Alpha');
  if (!existing) {
    const hash = await bcrypt.hash('12345678', 12);
    sqlite.prepare(
      `INSERT INTO idps_users (username, password_hash, role, theme_key, active) VALUES (?, ?, 'admin', NULL, 1)`
    ).run('Alpha', hash);
  } else if (!resetAlreadyApplied) {
    // One-time compatibility reset for deployments that still have the original bundled admin hash.
    const hash = await bcrypt.hash('12345678', 12);
    sqlite.prepare("UPDATE idps_users SET password_hash = ?, role = 'admin', theme_key = NULL, active = 1 WHERE username = ?").run(hash, 'Alpha');
    sqlite.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(bootstrapKey, 'done');
  }
  const year = sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('academic_year');
  if (!year) {
    sqlite.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('academic_year', String(new Date().getFullYear()));
  }
}

export function getCurrentYear() {
  return Number(sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('academic_year')?.value || new Date().getFullYear());
}

export function setCurrentYear(year) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
    throw new Error('Invalid academic year');
  }
  sqlite.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('academic_year', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(numericYear));
}
