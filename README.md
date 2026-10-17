# All World — Node.js API Server

## Konto und Anmeldung
- `POST /api/auth/register` — create an account
- `POST /api/auth/login` — sign in
- `GET /api/auth/me` — current session
- `POST /api/auth/logout` — sign out
- `GET /api/account` — protected account endpoint

Accounts are stored persistently in SQLite at `data/all-world.sqlite` (or `DATABASE_FILE`). Passwords are hashed with bcrypt and are never stored as plain text. Usernames are unique regardless of letter case. Login and registration are rate-limited, and session cookies are HttpOnly. If the old `data/users.json` prototype exists, valid accounts are imported into SQLite without deleting the original file.

## Start
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set values for your environment.
4. Run `npm start`.
5. Run `npm test` to exercise health, validation, registration, duplicate protection, login/logout, sessions and the protected account endpoint.

For local frontend development, set `APP_ORIGIN=http://localhost:5500` and serve the source-code folder on port 5500. Set `API_BASE_URL` in frontend `app.js` to the API address.

## Before public deployment
Use HTTPS, set a long random `SESSION_SECRET`, and set `APP_ORIGIN` to the exact deployed frontend origin. The current Express session store is in-memory, so users will need to sign in again after a server restart; configure a persistent session store before running multiple server instances or deploying publicly. Back up the SQLite database securely, never commit `.env` or `data/`, and do not expose the database file over the web.
