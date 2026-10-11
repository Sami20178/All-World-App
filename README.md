# All World — Node.js API Server


## API
- `GET /api/health` — health check
- `POST /api/auth/register` — create an account
- `POST /api/auth/login` — sign in
- `GET /api/auth/me` — current session
- `POST /api/auth/logout` — sign out
- `GET /api/account` — protected account endpoint

Passwords are hashed with bcrypt. Login and registration are rate-limited. Session cookies are HttpOnly. Account records are stored in the server's `data/users.json`; that directory is ignored by Git.

## Start
1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set values for your environment.
4. Run `npm start`.
5. Run `npm test` to start an isolated temporary server and exercise health, validation, registration, login/logout, sessions and the protected account endpoint. The test uses a temporary data directory and removes it afterward.

For local frontend development, set `APP_ORIGIN=http://localhost:5500` and serve the source-code folder on port 5500. Set `API_BASE_URL` in frontend `app.js` to the API address.

## Before public deployment
Use HTTPS, set a long random `SESSION_SECRET`, set `APP_ORIGIN` to the exact deployed frontend origin, and replace Express's in-memory session store with a persistent session store. The JSON user store is a small starter implementation; for a larger production service, migrate accounts to a database. Do not commit `.env` or `data/users.json`.
