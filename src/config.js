import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-env',
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || './uploads'),
  rootDir
};
