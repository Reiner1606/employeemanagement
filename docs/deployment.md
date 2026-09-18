# Deployment

Three environments, one codebase. The only thing that changes between them is
configuration: where the API listens, where the browser sends requests, and who
terminates TLS.

| Environment | Frontend served by | API address the browser uses | TLS |
|---|---|---|---|
| Local development | any static server on :5500 | `http://localhost:8080/api` (derived) | none |
| Tailscale private access | nginx or Caddy on the server | `http://<machine>.<tailnet>.ts.net/api` (derived) | optional, via Tailscale Serve |
| Public domain | nginx or Caddy | `https://hr.example.com/api` (derived) | at the proxy |

"Derived" means `frontend/js/config.js` works it out from the hostname in the
address bar. Nothing needs editing unless the API lives on a different host
from the pages, in which case copy `frontend/env.example.js` to
`frontend/env.js` and set `API_BASE_URL`.

---

## 1. Local development

**Frontend only, no backend.** The mock API is on by default.

```bash
cd frontend
python3 -m http.server 5500
# open http://localhost:5500
```

Open the file directly if you prefer (`file://`), though a server is better
because it matches how the app will really be loaded.

**With the C backend.**

```bash
cp config/.env.example config/.env      # edit as needed
cd backend
make
SERVER_HOST=127.0.0.1 SERVER_PORT=8080 COOKIE_SECURE=0 \
  EPMS_SEED_PASSWORD='choose-a-long-dev-password' ./build/epms-server
```

Then turn the mock off. Either set `USE_MOCK_API: false` in `frontend/env.js`,
or edit the default in `frontend/js/config.js`. Sign in with `ADM-0001` or
`EMP-1001` and the seed password.

`COOKIE_SECURE=0` is only for plain-HTTP localhost. Everywhere else, leave it 1.

### Database

```bash
createdb employee_system
psql -d employee_system -f database/schema.sql
psql -d employee_system -f database/seed.sql
```

The shipped `backend/database/db.c` keeps records in memory; port its `db_*`
functions to libpq to use the tables above. `seed.sql` deliberately creates
accounts that cannot sign in until a real password hash is set.

---

## 2. Tailscale private access

Tailscale is the network layer. It is not the authentication layer — the
backend still checks credentials, two-factor codes and permissions on every
request, exactly as it would on the public internet.

```
Employee device (Tailscale client)
        │  WireGuard
        ▼
Tailnet
        ▼
Company server  ──► nginx :80/:443  ──► epms-server :8080 ──► PostgreSQL :5432
```

**Install and join:**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=hr-server
tailscale ip -4                 # the tailnet address, e.g. 100.x.y.z
```

**Bind the API to every interface** so the tailnet address reaches it:

```bash
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
```

**Close everything else.** The tailnet address is reachable only by devices on
your tailnet, but the machine may also have a public interface:

```bash
sudo ufw default deny incoming
sudo ufw allow in on tailscale0
sudo ufw allow 22/tcp           # or drop this too and use Tailscale SSH
sudo ufw enable
```

**HTTPS on the tailnet** without certificates of your own:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080
```

With Tailscale Serve in front, set `SERVER_HOST=127.0.0.1` and keep
`COOKIE_SECURE=1`.

**Access control.** Restrict who can reach the server with a tailnet policy:

```json
{
  "acls": [
    { "action": "accept", "src": ["group:hr", "group:it"],
      "dst": ["hr-server:443"] }
  ]
}
```

The database must never be exposed. Keep PostgreSQL on `127.0.0.1` (or a
private subnet the tailnet cannot route to) and let only the API talk to it.

---

## 3. Public domain

Put a reverse proxy in front, terminate TLS there, and forward `/api` to the
backend. The frontend and API then share one origin, so no CORS configuration
is needed and `ALLOWED_ORIGIN` stays blank.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name hr.example.com;

    ssl_certificate     /etc/letsencrypt/live/hr.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hr.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;

    root /srv/epms/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name hr.example.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

```
hr.example.com {
    root * /srv/epms/frontend
    file_server
    handle_path /api/* {
        reverse_proxy 127.0.0.1:8080
    }
}
```

With a proxy on the same machine, set `SERVER_HOST=127.0.0.1` so the API is not
reachable except through it.

### Running as a service

`/etc/systemd/system/epms.service`:

```ini
[Unit]
Description=Employee Profile Management API
After=network-online.target postgresql.service

[Service]
Type=simple
User=epms
WorkingDirectory=/srv/epms/backend
EnvironmentFile=/srv/epms/config/.env
ExecStart=/srv/epms/backend/build/epms-server
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/epms/var

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 600 /srv/epms/config/.env
sudo chown epms:epms /srv/epms/config/.env
sudo systemctl enable --now epms
curl -s https://hr.example.com/api/health
```

---

## Checklist before real staff data goes in

- [ ] `EPMS_SEED_PASSWORD` unset; accounts created against the `users` table
- [ ] `auth_hash_password` / `auth_verify_password` moved to Argon2id
- [ ] `code_is_valid()` replaced with a real TOTP check
- [ ] `db_*` ported to libpq with parameterised statements
- [ ] Sessions moved from memory to the `sessions` table if more than one API
      process runs
- [ ] `COOKIE_SECURE=1` and HTTPS everywhere
- [ ] `config/.env` readable only by the service user, never committed
- [ ] Database bound to a private interface, not the internet
- [ ] Backups of `employees`, `users` and `audit_logs` tested by restoring one
