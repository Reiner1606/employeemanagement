# Employee Profile Management System

An internal HR system for managing employee profiles: a static
HTML/CSS/JavaScript frontend, a C backend that speaks JSON over HTTP, and a
relational schema behind it. Built to the login and navigation flow in the
project flowchart — see [docs/flowchart-mapping.md](docs/flowchart-mapping.md)
for the step-by-step correspondence.

## Try it in two minutes

```bash
cd frontend
python3 -m http.server 5500
```

Open <http://localhost:5500>. The mock API is on by default, so no backend or
database is needed to click through every screen.

| Sign in as | To see |
|---|---|
| `ADM-0001` | Administrator dashboard and employee management |
| `ADM-0002` | The "not authorised" branch that ends in a secure logout |
| `EMP-1001` | Employee self-service dashboard |

Any password of 8 or more characters works in development, and any 6-digit
verification code except `000000`. No password is stored in the frontend.

## Run the real backend

```bash
cp config/.env.example config/.env
cd backend && make
SERVER_HOST=127.0.0.1 SERVER_PORT=8080 COOKIE_SECURE=0 \
  EPMS_SEED_PASSWORD='choose-a-long-dev-password' ./build/epms-server
```

Then turn the mock off: copy `frontend/env.example.js` to `frontend/env.js` and
set `USE_MOCK_API: false`. Nothing else changes — every page talks to the API
through one client module.

Verify with:

```bash
curl -s localhost:8080/api/health
```

## What is here

```
employee-profile-management/
├── frontend/
│   ├── index.html              user access portal
│   ├── pages/                  login, 2FA, permission check, dashboards, employee screens
│   ├── css/                    style, login, dashboard, employee
│   ├── js/                     config, api, mock-api, auth, shell, ui, page controllers
│   ├── assets/
│   └── env.example.js          optional deploy-time overrides
├── backend/
│   ├── include/epms.h          shared declarations
│   ├── src/                    main, http_server, json
│   ├── routes/                 router, auth_routes, employee_routes
│   ├── auth/                   passwords, sessions, permissions
│   ├── database/               the only file that knows about storage
│   ├── utils/                  config, logging, SHA-256
│   └── Makefile
├── database/
│   ├── schema.sql              users, employees, departments, sessions, audit_logs
│   └── seed.sql                sample employees; accounts with no usable password
├── config/.env.example
└── docs/
    ├── architecture.md
    ├── api.md
    ├── deployment.md
    └── flowchart-mapping.md
```

## Features

**Access.** Role selection at the portal, separate employee and administrator
login screens, credential validation, two-factor code entry with a retry loop,
an administrator permission check that ends in a secure logout when it fails,
password reset request, idle session expiry, and sign-out with confirmation.

**Employee records.** Directory with search, department and status filters,
sortable columns and pagination; profile pages grouped into personal, contact,
employment, emergency and account sections; add, edit and delete with
confirmation. Employees can open their own profile and change their contact and
emergency details, nothing more.

**Interface.** Glassmorphism over a dark navy foundation, responsive from
desktop down to phone with a collapsing sidebar and horizontally scrolling
tables, loading and empty states, inline field validation, toasts, keyboard
focus styles and reduced-motion support.

## Security

- Passwords are hashed with a salt and 120,000 iterations, never stored in
  clear text, and compared in constant time.
- Sessions are opaque 64-character tokens in an HttpOnly, SameSite=Lax cookie,
  Secure when `COOKIE_SECURE=1`, with a sliding expiry.
- A session that has passed credentials but not the verification code opens
  nothing.
- Every endpoint re-checks the session and the specific permission it needs.
  The browser's copy of the session decides only what to render.
- Sign-in failures are rate limited and lock the account for five minutes.
- Login and password-reset responses are identical whether or not an account
  exists.
- Input is validated in the browser for speed and on the server for safety.
- Output is escaped on the way into the DOM; responses carry `nosniff`,
  `X-Frame-Options: DENY` and `no-store`.
- Sign-ins, failures, authorisation denials and every record change are written
  to the audit trail.
- No secret appears in any frontend file or any committed file. Configuration
  comes from the environment.

Before real staff data goes in, work through the checklist at the end of
[docs/deployment.md](docs/deployment.md): Argon2id hashing, real TOTP
verification, libpq with parameterised statements, and HTTPS.

## Deployment

`docs/deployment.md` covers all three, with working nginx, Caddy, systemd and
Tailscale configuration:

- **Local development** — static server plus the API on :8080
- **Tailscale** — API bound to `0.0.0.0`, firewall open only on `tailscale0`,
  optional HTTPS through Tailscale Serve, database never exposed
- **Public domain** — reverse proxy terminating TLS and forwarding `/api`

No localhost address is hardcoded anywhere. The frontend derives the API
address from the hostname it was loaded from, so the same files work at
`localhost`, at `hr-server.tailnet.ts.net` and at `hr.example.com`.

## Where the C backend connects to the frontend

One place: `frontend/js/api.js`. It is the only file that calls `fetch`. It
sends JSON to `APP_CONFIG.API_BASE_URL + path`, attaches the session cookie and
CSRF header, and turns error responses into a single `ApiError` shape. Page
scripts call methods like `Api.listEmployees(...)` and never touch HTTP.

`frontend/js/mock-api.js` implements the identical contract for development.
Setting `USE_MOCK_API` to false bypasses it entirely — that is the whole
migration.

## Building and testing the backend

```bash
cd backend
make           # optimised build
make debug     # address and undefined-behaviour sanitizers
make clean
```

The build is warning-clean under `-Wall -Wextra -Wpedantic`. The full flow —
login, wrong code, correct code, permission check, search, validation failure,
create, delete, audit read, logout, and rejection after logout — has been
exercised end to end against the compiled server.
