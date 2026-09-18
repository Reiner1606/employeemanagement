# Architecture

## Shape of the system

```
Browser (HTML, CSS, vanilla JS)
   │  fetch() with JSON + session cookie
   ▼
HTTP/REST  ──────────────  /api/*
   ▼
C backend (backend/build/epms-server)
   │  repository calls only
   ▼
Database (PostgreSQL; in-memory adapter ships by default)
```

The frontend is a set of static files. It never talks to the database, never
holds a secret, and makes no decision that matters: it renders what the API
returns and hides controls the account cannot use. Every rule is re-checked
server side on each request.

## Frontend layers

| File | Responsibility |
|---|---|
| `js/config.js` | Where the API lives, feature flags. No logic. |
| `js/api.js` | The only file that calls `fetch`. Builds requests, attaches the bearer token and CSRF header, normalises errors into `ApiError`. |
| `js/mock-api.js` | Development stand-in implementing the same contract. Bypassed entirely when `USE_MOCK_API` is false. |
| `js/auth.js` | Session copy in `sessionStorage`, page guards, idle timeout, sign-out. |
| `js/shell.js` | Sidebar and responsive navigation, built from the account's role and permissions. |
| `js/ui.js` | Toasts, confirm dialogs, button loading states, validation display, formatting. |
| `js/login.js`, `dashboard.js`, `employees.js`, `employee-profile.js`, `employee-form.js` | One controller per screen group. They call `Api.*` and `UI.*` and contain no HTTP details. |

A page script never constructs a URL or reads a cookie. That keeps the swap
from mock to C backend to a single configuration change.

## Backend layers

| File | Responsibility |
|---|---|
| `src/http_server.c` | Sockets, request parsing, response writing, CORS preflight, security headers. Knows nothing about employees. |
| `routes/router.c` | Method + path → handler group. |
| `routes/auth_routes.c` | Login, 2FA, permission check, logout, password reset. |
| `routes/employee_routes.c` | Employee CRUD, departments, dashboard summary, audit history. |
| `auth/auth.c` | Password hashing and verification, session table, permission lookup. |
| `database/db.c` | The only file that knows how records are stored. |
| `src/json.c` | JSON writing and flat-object reading. |
| `utils/utils.c` | Configuration, logging, string helpers, SHA-256. |

Each connection is served on its own detached thread. Shared tables are guarded
by a mutex. Sessions expire on a sliding window and are swept on every accept.

## Request lifecycle

1. `http_server.c` parses the request into `http_request_t`.
2. `router.c` strips `/api` and picks a handler group.
3. The handler resolves the session (`auth_current_session`) and rejects
   anything that has not passed two-factor verification.
4. The handler checks the specific permission it needs.
5. Input is read out of the JSON body into a typed struct and validated.
6. `db_*` performs the read or write and `db_audit_write` records it.
7. The handler builds a JSON response through `json_writer_t`.

## Where to change things

- **New field on an employee**: `employee_t` in `include/epms.h`, the reader and
  writer in `employee_routes.c`, `schema.sql`, and the `SCHEMA` array in
  `frontend/js/employee-form.js`. The profile page picks it up from one added
  `row(...)` call.
- **New endpoint**: add a handler, wire it in the route group, add a method to
  `frontend/js/api.js`. Nothing else needs to know.
- **Real database**: implement the `db_*` functions with libpq. No other file
  changes.
- **Real 2FA**: replace `code_is_valid()` in `auth_routes.c` with a TOTP check
  against `users.totp_secret`.
- **Stronger hashing**: replace `auth_hash_password` and
  `auth_verify_password` in `auth/auth.c` with libsodium's
  `crypto_pwhash_str` and `crypto_pwhash_str_verify`. The stored format already
  carries its algorithm, so old and new hashes can coexist during a migration.
