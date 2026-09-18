# Flowchart to page mapping

Every box and decision diamond in the source flowchart is listed here with the
page, script and endpoint that implement it.

## Shared entry

| Flowchart step | Page | Script | Endpoint |
|---|---|---|---|
| **User access portal** — select Employee or Admin | `frontend/index.html` | inline redirect for an existing session | — |

The portal offers two cards. Employee goes to `pages/login.html?role=employee`,
Administrator to `pages/login.html?role=admin`. The `role` parameter is what
splits the two branches below; both use the same page with different labels,
rules and failure messages.

## Employee branch

| Flowchart step | Page | Script | Endpoint |
|---|---|---|---|
| **Employee login page** — enter employee ID and password | `pages/login.html?role=employee` | `js/login.js` → `initLogin` | — |
| **Credential validation** | — | — | `POST /api/auth/login` |
| **Valid?** → No | Error shown in place on the login page | `initLogin` catch block | `401 invalid_credentials` |
| **Login failed** — display error, link to reset password | inline alert plus the "Forgot password?" link | `initLogin` | — |
| Reset password | `pages/reset-password.html` | `initReset` | `POST /api/auth/password-reset` |
| **Valid?** → Yes → **Enter 2FA code** | `pages/verify-2fa.html` | `initTwoFactor` | — |
| **Code correct?** → No → back to code entry | same page, field cleared, attempts counted | `initTwoFactor` catch | `401 invalid_code` |
| **Code correct?** → Yes | redirect | `initTwoFactor` on `next: "dashboard"` | `POST /api/auth/2fa/verify` |
| **Employee dashboard** — profile, self-service, logout | `pages/dashboard.html` | `js/dashboard.js` → `loadEmployee` | `GET /api/employees/{own id}` |
| Self-service: view profile | `pages/employee-profile.html` | `js/employee-profile.js` | `GET /api/employees/{id}` |
| Self-service: update own details | `pages/edit-employee.html` | `js/employee-form.js` | `PUT /api/employees/{id}` |
| Logout | sidebar "Sign out", with confirmation | `Auth.signOut` | `POST /api/auth/logout` |

## Administrator branch

| Flowchart step | Page | Script | Endpoint |
|---|---|---|---|
| **Administrator login page** — username and complex password | `pages/login.html?role=admin` | `initLogin` (minimum length raised to 12) | — |
| **Valid?** → No → **Login failed** — display error, system admin contact | inline alert; the footer link becomes "Contact the system administrator" | `initLogin` | `401 invalid_credentials` |
| **Valid?** → Yes → **Enter 2FA code** | `pages/verify-2fa.html` | `initTwoFactor` | — |
| **Code correct?** → No → back to code entry | same page | `initTwoFactor` | `401 invalid_code` |
| **Code correct?** → Yes → **Validate permissions** | `pages/validate-permissions.html` | `initPermissionCheck` | `GET /api/auth/permissions` |
| **Authorized?** → No → back to validate permissions | "Check again" button re-runs the check once | `initPermissionCheck`, `attempts < 2` | — |
| **Secure logout — contact system admin** | `pages/access-denied.html` | `initAccessDenied` (signs out on arrival) | `POST /api/auth/logout` |
| **Authorized?** → Yes → **Admin dashboard** — overview, employee management, tools, logout | `pages/admin-dashboard.html` | `js/dashboard.js` → `loadAdmin` | `GET /api/dashboard/summary`, `GET /api/audit-logs` |
| Employee management: directory | `pages/employees.html` | `js/employees.js` | `GET /api/employees` |
| Employee management: view | `pages/employee-profile.html` | `js/employee-profile.js` | `GET /api/employees/{id}` |
| Employee management: add | `pages/add-employee.html` | `js/employee-form.js` | `POST /api/employees` |
| Employee management: edit | `pages/edit-employee.html` | `js/employee-form.js` | `PUT /api/employees/{id}` |
| Employee management: delete | confirmation dialog on the directory and profile | `UI.confirmDialog` then `Api.deleteEmployee` | `DELETE /api/employees/{id}` |
| Logout | sidebar "Sign out" | `Auth.signOut` | `POST /api/auth/logout` |

## Decisions kept intact

- The two login pages stay separate in the interface, as drawn, even though one
  file serves both: the labels, the password rule and the failure message all
  differ by branch.
- Both 2FA loops return to code entry on a wrong code rather than to the login
  page. Three wrong codes end the attempt and send the person back to sign in.
- The administrator permission check happens **after** two-factor verification
  and **before** the dashboard, and its "No" path ends in a secure logout, not
  in a reduced dashboard.
- An employee who is not an administrator never reaches the permission check;
  the backend's `next` value routes them straight to their own dashboard.

## Exercising each branch in development

With `USE_MOCK_API` on (the default), the mock backend produces every path:

| To see | Do this |
|---|---|
| Login failed | Any unknown account, or a password under 8 characters |
| Rate limiting | Five failed attempts on the same account |
| Wrong 2FA code | Enter `000000` |
| Locked challenge | Three wrong codes |
| Authorized administrator | Sign in as `ADM-0001` |
| Not-authorized administrator → secure logout | Sign in as `ADM-0002` |
| Employee dashboard | Sign in as `EMP-1001` |

Any other 6-digit code passes verification, and any password of 8 or more
characters is accepted for a known account. No password is stored anywhere in
the frontend.
