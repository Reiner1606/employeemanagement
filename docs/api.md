# API reference

Base path: `/api`. All request and response bodies are JSON.

Authentication uses an `epms_session` cookie (HttpOnly, SameSite=Lax, Secure
when `COOKIE_SECURE=1`). Clients that cannot use cookies may send
`Authorization: Bearer <token>` instead. State-changing requests should also
echo the `csrf_token` cookie in an `X-CSRF-Token` header.

## Errors

Every failure returns the same envelope alongside a matching HTTP status:

```json
{ "error": { "code": "validation_failed",
             "message": "Some fields need attention.",
             "details": { "email": "Enter a valid email address." } } }
```

`details` appears only on `400 validation_failed` and maps field name to
message, which is what the frontend uses to mark inputs.

| Status | Meaning |
|---|---|
| 400 | Body failed validation |
| 401 | Not signed in, session expired, or wrong verification code |
| 403 | Signed in but not permitted |
| 404 | No such record or endpoint |
| 429 | Rate limited (too many sign-in attempts) |
| 500 | Server fault |

---

## Authentication

### `POST /api/auth/login`

```json
{ "role": "admin", "identifier": "ADM-0001", "password": "...", "remember": false }
```

Success — credentials accepted, verification code issued:

```json
{ "status": "2fa_required", "challenge_id": "…64 hex…",
  "delivery": "Authenticator app", "expires_in": 300 }
```

The challenge id is a pre-authentication session token. It opens nothing until
the code is verified. Failures return `401 invalid_credentials` with the same
message whatever went wrong, so the endpoint cannot be used to discover which
accounts exist. After `LOGIN_MAX_ATTEMPTS` failures the account is locked for
five minutes and further attempts return `429 rate_limited`.

### `POST /api/auth/2fa/verify`

```json
{ "challenge_id": "…", "code": "123456" }
```

```json
{ "status": "authenticated", "token": "…64 hex…",
  "user": { "username": "ADM-0001", "role": "admin",
            "display_name": "Marisol Ferrer", "employee_id": "EMP-1003",
            "permissions": ["employees:manage", "employees:read",
                            "reports:read", "audit:read"] },
  "next": "validate_permissions" }
```

`next` is `validate_permissions` for administrators and `dashboard` for
employees, which is how the frontend follows the flowchart. Three wrong codes
destroy the challenge (`401 challenge_locked`).

### `POST /api/auth/2fa/resend`
`{ "challenge_id": "…" }` → `{ "status": "sent", "expires_in": 300 }`

### `GET /api/auth/permissions`

The administrator authorisation step.

```json
{ "authorized": true, "role": "admin",
  "permissions": ["employees:manage", "…"], "reason": null }
```

When `authorized` is false, `reason` explains why and the frontend closes the
session and shows the access-denied page.

### `GET /api/auth/me`
Returns `{ "user": { … } }` for the current session.

### `POST /api/auth/logout`
Destroys the session and clears the cookie. `{ "status": "signed_out" }`

### `POST /api/auth/password-reset`
`{ "identifier": "EMP-1001" }` → always `{ "status": "accepted" }`, whether or
not the account exists.

---

## Employees

### `GET /api/employees`
Requires `employees:read`.

| Query | Default | Notes |
|---|---|---|
| `q` | — | Matches name, employee ID, email, position |
| `department` | — | Exact department name |
| `status` | — | `Active`, `On Leave`, `Inactive` |
| `sort` | `last_name` | Also `position`, `department`, `employment_status`, `date_hired`, `employee_id` |
| `order` | `asc` | `asc` or `desc` |
| `page` | 1 | |
| `page_size` | 10 | Capped at 100 |

```json
{ "data": [ { "employee_id": "EMP-1001", "first_name": "Alia", … } ],
  "meta": { "page": 1, "page_size": 8, "total": 14, "total_pages": 2 } }
```

### `GET /api/employees/{id}`
Requires `employees:read`, or that `{id}` is the caller's own record.
Returns `{ "data": { … } }`.

### `POST /api/employees`
Requires `employees:manage`. Body is an employee object without
`employee_id`, which the server assigns. Returns `201` and the created record.

Required fields: `first_name`, `last_name`, `date_of_birth`, `gender`, `email`,
`contact_number`, `address`, `position`, `department`, `employment_status`,
`date_hired`, `emergency_contact_name`, `emergency_contact_number`.

### `PUT /api/employees/{id}`
Requires `employees:manage` for any field. A holder of `self:update` editing
their own record may change only `email`, `contact_number`, `address` and the
three emergency-contact fields; anything else in the body is ignored rather
than rejected. Returns `200` and the updated record.

### `DELETE /api/employees/{id}`
Requires `employees:manage`. Soft-deletes the row so the audit trail stays
meaningful. Returns `204` with no body.

---

## Reference and reporting

### `GET /api/departments`
`{ "data": [ { "id": 1, "name": "Engineering", "employee_count": 4 } ] }`

### `GET /api/dashboard/summary`
Requires `employees:read`. Totals by status, headcount by department, and the
five most recently added and updated records.

### `GET /api/audit-logs?limit=10`
Requires `audit:read`.
`{ "data": [ { "id": 4, "actor": "ADM-0001", "action": "employee.delete",
               "target": "EMP-1002", "at": "2026-09-18T07:49:50Z" } ] }`

### `GET /api/health`
Unauthenticated liveness check for the proxy and for Tailscale.
`{ "status": "ok", "employees": 6 }`

---

## Permissions

| Permission | Grants |
|---|---|
| `employees:read` | Open the directory and any profile |
| `employees:manage` | Add, edit and delete records; required for the admin dashboard |
| `self:read` | Open one's own profile |
| `self:update` | Change one's own contact and emergency details |
| `reports:read` | Dashboard summary |
| `audit:read` | Audit history |
