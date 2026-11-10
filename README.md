# Gamini Central College – Nuwara Eliya Evidence Portal

A responsive Node.js + Express + EJS school evidence portal for eight evaluation themes. The interface uses the school's green-and-yellow identity and supports light/dark mode on desktop and mobile.

## Stack

- Node.js 20 or newer + Express
- EJS server-rendered templates
- PostgreSQL / Neon for article records and attachment metadata
- SQLite (`better-sqlite3`) for IDPS accounts and academic-year settings
- SQLite-backed Express sessions
- Local filesystem for uploaded evidence files

## Install and run

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to your own Neon/PostgreSQL connection string.
4. Set `SESSION_SECRET` to a long random secret. Do not publish your `.env` file.
5. Install dependencies and start the app:

   ```bash
   npm install
   npm start
   ```

6. Open `http://localhost:3000`.

The app creates the PostgreSQL tables when `DATABASE_URL` is configured. Run `npm run init` only if you want to run the project's explicit initialization task.

## Initial IDPS administrator

The bundled local IDPS database contains the original initial administrator account:

- Username: `Alpha`
- Password: `12345678` (initial/recovery password)

Use the same account to access any theme and `/idps`. This is a temporary recovery password and is weak. Change it immediately after the first login. On the first startup after this update, the app resets the Alpha password once to this value. If you need to reset it again, run `npm run reset-admin` (or set `ADMIN_RESET_PASSWORD` to a different password before running the command). Teachers should be created through IDPS Administration and assigned to their appropriate theme.

## Storage and deployment

- PostgreSQL/Neon stores article records and attachment metadata.
- Files are stored in `uploads/`; configure persistent storage on your host.
- The application accepts individual files up to 2 GB, but the hosting provider, reverse proxy and available disk space may impose lower limits.
- Use HTTPS in production and set `NODE_ENV=production`.
- Back up `storage/idps.sqlite` and the `uploads/` directory.
- The distributed ZIP intentionally does not include `.env`, the old session database, or `node_modules`. Configure your own secret and install dependencies on the target machine.

## UI maintenance

The homepage template is `views/home.ejs`, shared page chrome is in `views/partials-head.ejs` and `views/partials-foot.ejs`, global styling is in `public/css/app.css`, and theme-toggle behavior is in `public/js/app.js`.
## Administrator workspace

The home page includes an **Administrator** card. Sign in with an active account whose role is `admin` through IDPS Administration to open `/administrator`. The workspace provides direct access to all eight themes in the same authenticated session, plus a link to manage IDPS accounts and the academic year. The server checks the role on each protected route; a teacher account cannot enter the administrator workspace. Administrators can create, edit, and delete articles in any theme.

