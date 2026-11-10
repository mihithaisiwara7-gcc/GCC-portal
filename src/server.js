import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { sqlite, ensureInitialAdmin, getCurrentYear, setCurrentYear } from './sqlite.js';
import { pool, initPostgres } from './postgres.js';
import { THEMES, themeByKey } from './themes.js';

await ensureInitialAdmin();
await initPostgres();
fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(config.rootDir, 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(config.rootDir, 'public'), { maxAge: '1d' }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(config.rootDir, 'storage') }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.user = req.session.user || null;
  res.locals.currentYear = getCurrentYear();
  res.locals.themes = THEMES;
  next();
});

function requireCsrf(req, res, next) {
  if (!req.body?.csrfToken || req.body.csrfToken !== req.session.csrfToken) {
    return res.status(403).send('Invalid CSRF token. Please go back and try again.');
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/');
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.user?.role !== 'admin') return res.status(403).send('Administrator access required.');
  next();
}

function requireThemeAccess(req, res, next) {
  const theme = themeByKey(req.params.themeKey);
  if (!theme) return res.status(404).send('Theme not found.');
  if (!req.session.user) return res.redirect(`/login/${encodeURIComponent(theme.key)}`);
  if (req.session.user.role === 'admin' || req.session.user.themeKey === theme.key) return next();
  return res.status(403).send('You do not have access to this theme.');
}

function safeFileName(original) {
  const ext = path.extname(original).toLowerCase();
  return `${crypto.randomUUID()}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, safeFileName(file.originalname))
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    // Browsers decode multipart filenames as latin1; restore proper UTF-8 names.
    try { file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (_) {}
    const allowedMime = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv'
    ];
    const allowedExt = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
      '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'];
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype || '';
    const genericMime = ['application/octet-stream', ''].includes(mime);
    const ok = allowedMime.includes(mime)
      || (mime.startsWith('image/') && mime !== 'image/svg+xml')
      || (genericMime && allowedExt.includes(ext));
    if (ok) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.originalname}`));
  }
});

const issueImageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/heic', 'image/heif', 'image/tiff'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP, GIF, BMP, AVIF, HEIC and TIFF images are allowed.'));
  }
});

function render(res, view, data = {}) {
  return res.render(view, { ...data });
}

app.get('/', async (req, res) => {
  render(res, 'home', { pageTitle: 'Dashboard' });
});

app.get('/login/:themeKey', (req, res) => {
  const theme = themeByKey(req.params.themeKey);
  if (!theme) return res.status(404).send('Theme not found.');
  if (req.session.user?.role === 'admin' || req.session.user?.themeKey === theme.key) return res.redirect(`/themes/${theme.key}`);
  render(res, 'login', { pageTitle: `${theme.shortTitle} Login`, theme, error: null });
});

app.post('/login/:themeKey', requireCsrf, async (req, res) => {
  const theme = themeByKey(req.params.themeKey);
  if (!theme) return res.status(404).send('Theme not found.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = sqlite.prepare('SELECT * FROM idps_users WHERE username = ? AND active = 1').get(username);
  const valid = row ? await bcrypt.compare(password, row.password_hash) : false;
  if (!valid || (row.role !== 'admin' && row.theme_key !== theme.key)) {
    return render(res, 'login', { pageTitle: `${theme.shortTitle} Login`, theme, error: 'Invalid ID/password or this account is not assigned to this theme.' });
  }
  req.session.user = { id: row.id, username: row.username, role: row.role, themeKey: row.theme_key };
  res.redirect(`/themes/${theme.key}`);
});

app.get('/idps', (req, res) => {
  if (req.session.user?.role === 'admin') return res.redirect('/administrator');
  render(res, 'idps-login', { pageTitle: 'IDPS Administration', error: null });
});

app.post('/idps', requireCsrf, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const row = sqlite.prepare('SELECT * FROM idps_users WHERE username = ? AND active = 1').get(username);
  const valid = row ? await bcrypt.compare(password, row.password_hash) : false;
  if (!valid || row.role !== 'admin') {
    return render(res, 'idps-login', { pageTitle: 'IDPS Administration', error: 'Invalid administrator credentials.' });
  }
  req.session.user = { id: row.id, username: row.username, role: row.role, themeKey: null };
  res.redirect('/administrator');
});

app.get('/administrator', (req, res) => {
  if (!req.session.user) return res.redirect('/idps');
  if (req.session.user.role !== 'admin') return res.status(403).send('Administrator access required.');
  render(res, 'administrator', { pageTitle: 'Administrator Workspace', themes: THEMES });
});

app.get('/idps/admin', requireAdmin, (req, res) => {
  const users = sqlite.prepare(`
    SELECT id, username, role, theme_key AS themeKey, active, created_at AS createdAt
    FROM idps_users ORDER BY role DESC, username ASC
  `).all();
  render(res, 'admin', { pageTitle: 'IDPS Administration', users, themes: THEMES, currentYear: getCurrentYear(), message: null, error: null });
});

app.post('/idps/users', requireAdmin, requireCsrf, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'teacher';
  const themeKey = role === 'teacher' ? String(req.body.themeKey || '') : null;
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) return res.status(400).send('Username must be 3-50 characters and use letters, numbers, dot, underscore or hyphen.');
  if (password.length < 8) return res.status(400).send('Password must be at least 8 characters.');
  if (role === 'teacher' && !themeByKey(themeKey)) return res.status(400).send('A valid theme is required for teacher accounts.');
  try {
    const hash = await bcrypt.hash(password, 12);
    sqlite.prepare('INSERT INTO idps_users (username, password_hash, role, theme_key) VALUES (?, ?, ?, ?)').run(username, hash, role, themeKey);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).send('That username already exists.');
    throw error;
  }
  res.redirect('/idps/admin');
});

app.post('/idps/users/:id/toggle', requireAdmin, requireCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).send('You cannot disable your own active session.');
  sqlite.prepare('UPDATE idps_users SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  res.redirect('/idps/admin');
});

app.post('/idps/users/:id/password', requireAdmin, requireCsrf, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).send('Password must be at least 8 characters.');
  const hash = await bcrypt.hash(password, 12);
  sqlite.prepare('UPDATE idps_users SET password_hash = ? WHERE id = ?').run(hash, Number(req.params.id));
  res.redirect('/idps/admin');
});

app.post('/idps/year', requireAdmin, requireCsrf, (req, res) => {
  try {
    setCurrentYear(req.body.year);
    res.redirect('/idps/admin');
  } catch {
    res.status(400).send('Invalid academic year.');
  }
});

app.get('/themes/:themeKey', requireThemeAccess, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured. Add your Neon PostgreSQL connection string to .env.');
  const theme = themeByKey(req.params.themeKey);
  const year = getCurrentYear();
  const search = String(req.query.search || '').trim();
  const params = [theme.key, year];
  let query = `
    SELECT id, title, description, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM articles WHERE theme_key = $1 AND year = $2
  `;
  if (search) {
    params.push(`%${search}%`);
    query += ` AND (title ILIKE $3 OR description ILIKE $3)`;
  }
  query += ' ORDER BY updated_at DESC';
  const { rows: articles } = await pool.query(query, params);
  render(res, 'theme', { pageTitle: theme.shortTitle, theme, articles, search, year });
});


app.get('/themes/:themeKey/issues', requireThemeAccess, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const theme = themeByKey(req.params.themeKey);
  const { rows: issues } = await pool.query(`
    SELECT i.id, i.description, i.created_by AS "createdBy", i.created_at AS "createdAt",
      COALESCE(json_agg(json_build_object('id', im.id, 'originalName', im.original_name, 'mimeType', im.mime_type, 'sizeBytes', im.size_bytes))
      FILTER (WHERE im.id IS NOT NULL), '[]') AS images
    FROM issues i LEFT JOIN issue_images im ON im.issue_id = i.id
    WHERE i.theme_key = $1 GROUP BY i.id ORDER BY i.created_at DESC
  `, [theme.key]);
  render(res, 'issues', { pageTitle: `Issues - ${theme.shortTitle}`, theme, issues });
});

app.post('/themes/:themeKey/issues', requireThemeAccess, (req, res) => {
  issueImageUpload.array('images', 20)(req, res, async (uploadError) => {
    const images = req.files || [];
    const cleanup = () => images.forEach(file => fs.rmSync(file.path, { force: true }));
    if (uploadError) {
      cleanup();
      if (uploadError.code === 'LIMIT_FILE_SIZE') return res.status(413).send('Each image must be 10 MB or smaller.');
      return res.status(400).send(uploadError.message);
    }
    if (!req.body?.csrfToken || req.body.csrfToken !== req.session.csrfToken) {
      cleanup(); return res.status(403).send('Invalid CSRF token. Refresh and try again.');
    }
    const theme = themeByKey(req.params.themeKey);
    const description = String(req.body.description || '').trim();
    if (!description) { cleanup(); return res.status(400).send('Please enter the issue details.'); }
    if (!config.databaseUrl) { cleanup(); return res.status(500).send('DATABASE_URL is not configured.'); }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const saved = await client.query(
        'INSERT INTO issues (theme_key, description, created_by) VALUES ($1, $2, $3) RETURNING id',
        [theme.key, description, req.session.user.username]
      );
      for (const file of images) {
        await client.query(
          'INSERT INTO issue_images (issue_id, original_name, stored_name, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5)',
          [saved.rows[0].id, file.originalname, file.filename, file.mimetype, file.size]
        );
      }
      await client.query('COMMIT');
      res.redirect(`/themes/${theme.key}/issues`);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      cleanup(); console.error(error); res.status(500).send('Could not save this issue.');
    } finally { client?.release(); }
  });
});

app.get('/issue-images/:id', requireLogin, async (req, res) => {
  const result = await pool.query(`
    SELECT im.stored_name AS "storedName", im.original_name AS "originalName",
      im.mime_type AS "mimeType", i.theme_key AS "themeKey"
    FROM issue_images im JOIN issues i ON i.id = im.issue_id WHERE im.id = $1
  `, [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).send('Image not found.');
  const item = result.rows[0];
  if (req.session.user.role !== 'admin' && req.session.user.themeKey !== item.themeKey) return res.status(403).send('Access denied.');
  const filePath = path.join(config.uploadDir, item.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Stored image is missing.');
  res.type(item.mimeType).sendFile(filePath);
});

app.get('/themes/:themeKey/articles/new', requireThemeAccess, (req, res) => {
  const theme = themeByKey(req.params.themeKey);
  render(res, 'article-form', { pageTitle: `New Article - ${theme.shortTitle}`, theme, article: null, isEdit: false, currentYear: getCurrentYear(), error: null });
});

app.post('/themes/:themeKey/articles', requireThemeAccess, (req, res) => {
  // multer must parse the multipart body BEFORE the CSRF token can be read from req.body.
  upload.fields([
    { name: 'documents', maxCount: 1000 },
    { name: 'images', maxCount: 1000 }
  ])(req, res, async (uploadError) => {
    const documents = req.files?.documents || [];
    const images = req.files?.images || [];
    const cleanup = () => { for (const file of [...documents, ...images]) fs.rmSync(file.path, { force: true }); };
    const fail = (status, message) => { cleanup(); return res.status(status).send(message); };

    if (uploadError) {
      cleanup();
      if (uploadError.code === 'LIMIT_FILE_SIZE') return res.status(413).send('A file exceeded the 2 GB limit.');
      return res.status(400).send(uploadError.message);
    }
    if (!req.body?.csrfToken || req.body.csrfToken !== req.session.csrfToken) {
      return fail(403, 'Invalid CSRF token. Please go back, refresh the page and try again.');
    }
    const theme = themeByKey(req.params.themeKey);
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    if (!title) return fail(400, 'Article title is required.');
    if (!config.databaseUrl) return fail(500, 'DATABASE_URL is not configured.');

    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const articleResult = await client.query(
        `INSERT INTO articles (theme_key, year, title, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [theme.key, getCurrentYear(), title, description || null, req.session.user.username]
      );
      const articleId = articleResult.rows[0].id;
      for (const file of [...documents.map((f) => ({ ...f, kind: 'document' })), ...images.map((f) => ({ ...f, kind: 'image' }))]) {
        await client.query(
          `INSERT INTO attachments (article_id, kind, original_name, stored_name, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
          [articleId, file.kind, file.originalname, file.filename, file.mimetype, file.size]
        );
      }
      await client.query('COMMIT');
      res.redirect(`/themes/${theme.key}/articles/${articleId}`);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      cleanup();
      console.error(error);
      res.status(500).send(`Could not save the article. Details: ${error?.code ? error.code + ' - ' : ''}${error?.message || error}`);
    } finally {
      client?.release();
    }
  });
});

app.get('/themes/:themeKey/articles/:id/edit', requireThemeAccess, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const theme = themeByKey(req.params.themeKey);
  const result = await pool.query(
    `SELECT id, title, description, year FROM articles WHERE id = $1 AND theme_key = $2`,
    [Number(req.params.id), theme.key]
  );
  if (!result.rowCount) return res.status(404).send('Article not found.');
  render(res, 'article-form', {
    pageTitle: `Edit Article - ${theme.shortTitle}`, theme, article: result.rows[0],
    currentYear: result.rows[0].year, isEdit: true, error: null
  });
});

app.post('/themes/:themeKey/articles/:id/edit', requireThemeAccess, requireCsrf, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const theme = themeByKey(req.params.themeKey);
  const articleId = Number(req.params.id);
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  if (!title) return res.status(400).send('Article title is required.');
  const result = await pool.query(
    `UPDATE articles SET title = $1, description = $2, updated_at = NOW() WHERE id = $3 AND theme_key = $4 RETURNING id`,
    [title, description || null, articleId, theme.key]
  );
  if (!result.rowCount) return res.status(404).send('Article not found.');
  res.redirect(`/themes/${theme.key}/articles/${articleId}`);
});

app.get('/themes/:themeKey/articles/:id', requireThemeAccess, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const theme = themeByKey(req.params.themeKey);
  const articleId = Number(req.params.id);
  const articleResult = await pool.query(
    `SELECT id, theme_key AS "themeKey", year, title, description, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM articles WHERE id = $1 AND theme_key = $2`,
    [articleId, theme.key]
  );
  if (!articleResult.rowCount) return res.status(404).send('Article not found.');
  const attachmentResult = await pool.query(
    `SELECT id, kind, original_name AS "originalName", mime_type AS "mimeType", size_bytes AS "sizeBytes" FROM attachments WHERE article_id = $1 ORDER BY kind, id`,
    [articleId]
  );
  render(res, 'article', { pageTitle: articleResult.rows[0].title, theme, article: articleResult.rows[0], attachments: attachmentResult.rows });
});

app.get('/attachments/:id', requireLogin, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const result = await pool.query(`
    SELECT a.id, a.original_name AS "originalName", a.stored_name AS "storedName", a.mime_type AS "mimeType", ar.theme_key AS "themeKey"
    FROM attachments a JOIN articles ar ON ar.id = a.article_id WHERE a.id = $1
  `, [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).send('File not found.');
  const attachment = result.rows[0];
  if (req.session.user.role !== 'admin' && req.session.user.themeKey !== attachment.themeKey) return res.status(403).send('Access denied.');
  const filePath = path.join(config.uploadDir, attachment.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Stored file is missing.');
  res.type(attachment.mimeType || 'application/octet-stream');
  res.download(filePath, attachment.originalName);
});

app.post('/themes/:themeKey/articles/:id/delete', requireThemeAccess, requireCsrf, async (req, res) => {
  if (!config.databaseUrl) return res.status(500).send('DATABASE_URL is not configured.');
  const theme = themeByKey(req.params.themeKey);
  const articleId = Number(req.params.id);
  const article = await pool.query('SELECT id FROM articles WHERE id = $1 AND theme_key = $2', [articleId, theme.key]);
  if (!article.rowCount) return res.status(404).send('Article not found.');
  const attachments = await pool.query('SELECT stored_name FROM attachments WHERE article_id = $1', [articleId]);
  await pool.query('DELETE FROM articles WHERE id = $1 AND theme_key = $2', [articleId, theme.key]);
  for (const row of attachments.rows) fs.rmSync(path.join(config.uploadDir, row.stored_name), { force: true });
  res.redirect(`/themes/${theme.key}`);
});

app.post('/logout', requireCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.use((error, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return;
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).send('An uploaded file exceeded its size limit. Images in Issues must be 10 MB or smaller.');
  // Show the real reason to signed-in users so problems can be diagnosed.
  const detail = req.session?.user ? ` Details: ${error?.code ? error.code + ' - ' : ''}${error?.message || error}` : '';
  res.status(500).send(`Something went wrong.${detail}`);
});

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

app.listen(config.port, () => {
  console.log(`Gamini Central College portal running at http://localhost:${config.port}`);
});
