/**
 * Development mock backend.
 *
 * It implements exactly the REST contract documented in docs/api.md, so the
 * real C backend can replace it without any change to page scripts. Set
 * APP_CONFIG.USE_MOCK_API = false to bypass this file entirely.
 *
 * Seed data: one administrator and six employees, all sharing one password —
 * the fixed roster for this project (see seedRosterIfEmpty below). This is
 * real roster data, not placeholder example content. Every account after
 * these seven is created from the admin dashboard, with its username and
 * password set directly by whoever is running the system.
 */
(function () {
  "use strict";

  var STORE_KEY = "epms.mock.db.v1";
  var SESSION_KEY = "epms.mock.session";
  var ATTEMPT_KEY = "epms.mock.attempts";
  var MAX_ATTEMPTS = 5;
  var ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
  var SHARED_PASSWORD = "arellano2026";

  var DEPARTMENTS = [
    { id: 1, code: "ENG", name: "Engineering" },
    { id: 2, code: "HR", name: "Human Resources" },
    { id: 3, code: "FIN", name: "Finance" },
    { id: 4, code: "OPS", name: "Operations" },
    { id: 5, code: "SAL", name: "Sales" }
  ];

  /* --------------------------------------------------------------- Storage */

  function freshDb() {
    return { employees: [], users: [], departments: DEPARTMENTS, audit: [], nextAudit: 1 };
  }

  function nextEmployeeId(db) {
    var max = 1000;
    db.employees.forEach(function (e) {
      var n = parseInt(String(e.employee_id).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return "EMP-" + (max + 1);
  }

  function seedEmployeeRecord(db, lastName, department) {
    var id = nextEmployeeId(db);
    db.employees.push({
      employee_id: id,
      first_name: "Employee",
      middle_name: "",
      last_name: lastName,
      date_of_birth: "2000-01-01",
      gender: "Prefer not to say",
      email: lastName.toLowerCase() + "@google.example",
      contact_number: "+63 900 000 0000",
      address: "Address on file",
      position: "Employee",
      department: department,
      employment_status: "Active",
      date_hired: "2025-01-01",
      photo_url: "",
      emergency_contact_name: "On file with HR",
      emergency_contact_relationship: "Family",
      emergency_contact_number: "+63 900 000 0000",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    return id;
  }

  function seedNamedAccount(db, username, displayName, role, permissions, employeeId) {
    db.users.push({
      username: username,
      password: SHARED_PASSWORD,
      role: role,
      display_name: displayName,
      employee_id: employeeId || "",
      permissions: permissions,
      failed_attempts: 0,
      lockout_until: 0
    });
  }

  function seedRosterIfEmpty(db) {
    if (db.users.length > 0) return db;

    seedNamedAccount(db, "Marisol300", "Marisol", "admin",
      ["employees:manage", "employees:read", "reports:read", "audit:read"], "");

    [
      ["Serano300", "Serano", "Engineering"],
      ["Velasco300", "Velasco", "Human Resources"],
      ["Yacanle300", "Yacanle", "Finance"],
      ["Sion300", "Sion", "Operations"],
      ["Zapanta300", "Zapanta", "Sales"],
      ["Soliveres300", "Soliveres", "Engineering"]
    ].forEach(function (row) {
      var id = seedEmployeeRecord(db, row[1], row[2]);
      seedNamedAccount(db, row[0], row[1], "employee", ["self:read", "self:update"], id);
    });

    return db;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    var db;
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = freshDb(); }
    } else {
      db = freshDb();
    }
    if (!db.users) db.users = [];
    if (!db.audit) db.audit = [];
    if (!db.nextAudit) db.nextAudit = 1;

    var before = db.users.length;
    db = seedRosterIfEmpty(db);
    if (db.users.length !== before) save(db);
    return db;
  }

  function save(db) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  }

  function readJson(key, fallback) {
    try {
      var raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- Helpers */

  function fail(status, code, message, details) {
    var err = new window.Api.ApiError(message, status, code, details || null);
    return Promise.reject(err);
  }

  function delay(value) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, window.APP_CONFIG.MOCK_LATENCY_MS);
    });
  }

  function currentSession() {
    return readJson(SESSION_KEY, null);
  }

  function requireSession() {
    var s = currentSession();
    if (!s || !s.authenticated) return null;
    return s;
  }

  function fullName(e) {
    return [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ");
  }

  function audit(db, actor, action, target) {
    db.audit.unshift({ id: db.nextAudit++, actor: actor, action: action, target: target, at: new Date().toISOString() });
    db.audit = db.audit.slice(0, 60);
  }

  function attemptsFor(identifier) {
    var all = readJson(ATTEMPT_KEY, {});
    var entry = all[identifier];
    if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) return { count: 0, first: Date.now() };
    return entry;
  }

  function recordAttempt(identifier, reset) {
    var all = readJson(ATTEMPT_KEY, {});
    if (reset) { delete all[identifier]; }
    else {
      var entry = attemptsFor(identifier);
      entry.count += 1;
      all[identifier] = entry;
    }
    writeJson(ATTEMPT_KEY, all);
  }

  var REQUIRED_FIELDS = [
    "first_name", "last_name", "date_of_birth", "gender", "contact_number",
    "email", "address", "position", "department", "employment_status", "date_hired"
  ];

  function validateEmployee(db, data, existingId) {
    var details = {};
    REQUIRED_FIELDS.forEach(function (f) {
      if (!data[f] || String(data[f]).trim() === "") details[f] = "This field is required.";
    });
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      details.email = "Enter a valid email address.";
    }
    if (data.email) {
      var clash = db.employees.some(function (e) {
        return e.email.toLowerCase() === String(data.email).toLowerCase() && e.employee_id !== existingId;
      });
      if (clash) details.email = "Another employee already uses this email address.";
    }
    if (data.date_of_birth && new Date(data.date_of_birth) > new Date()) {
      details.date_of_birth = "Date of birth cannot be in the future.";
    }
    if (data.date_hired && data.date_of_birth && new Date(data.date_hired) < new Date(data.date_of_birth)) {
      details.date_hired = "Date hired must be after the date of birth.";
    }
    return Object.keys(details).length ? details : null;
  }

  function publicUser(user) {
    return {
      username: user.username,
      role: user.role,
      display_name: user.display_name,
      employee_id: user.employee_id || "",
      permissions: user.permissions
    };
  }

  /* ----------------------------------------------------------------- Router */

  function handle(method, path, body, query) {
    var route = method + " " + path;

    /* ------------------------------------------------------------- Auth */

    if (route === "POST /auth/login") {
      var identifier = String(body.identifier || "").trim();
      var attempts = attemptsFor(identifier);
      if (attempts.count >= MAX_ATTEMPTS) {
        return delay().then(function () {
          return fail(429, "rate_limited", "Too many failed attempts. Try again in a few minutes.");
        });
      }

      var loginDb = load();
      var user = loginDb.users.filter(function (u) {
        return u.username.toLowerCase() === identifier.toLowerCase() && u.role === body.role;
      })[0];

      if (!user || String(body.password || "") !== user.password) {
        recordAttempt(identifier, false);
        return delay().then(function () {
          return fail(401, "invalid_credentials",
            body.role === "admin"
              ? "Administrator sign-in failed. Check the username and password, then contact the system administrator if the problem continues."
              : "Sign-in failed. Check your username and password.");
        });
      }
      recordAttempt(identifier, true);

      var session = {
        authenticated: true,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        employee_id: user.employee_id || "",
        permissions: user.permissions,
        permission_checked: false,
        issued_at: Date.now(),
        token: "mock_" + Math.random().toString(36).slice(2)
      };
      writeJson(SESSION_KEY, session);
      window.Api.setToken(session.token, !!body.remember);

      audit(loginDb, session.username, "auth.login", session.username);
      save(loginDb);

      return delay({
        status: "authenticated",
        token: session.token,
        user: publicUser(session),
        next: session.role === "admin" ? "validate_permissions" : "dashboard"
      });
    }

    if (route === "GET /auth/permissions") {
      var s = requireSession();
      if (!s) return delay().then(function () { return fail(401, "unauthenticated", "Your session has ended. Sign in again."); });
      var authorized = s.role !== "admin" || s.permissions.indexOf(window.APP_CONFIG.ADMIN_PERMISSION) !== -1;
      s.permission_checked = true;
      writeJson(SESSION_KEY, s);
      return delay({
        authorized: authorized,
        role: s.role,
        permissions: s.permissions,
        reason: authorized ? null : "This account does not have the employee management role assigned."
      });
    }

    if (route === "GET /auth/me") {
      var me = requireSession();
      if (!me) return delay().then(function () { return fail(401, "unauthenticated", "Your session has ended. Sign in again."); });
      return delay({ user: publicUser(me) });
    }

    if (route === "POST /auth/logout") {
      var out = currentSession();
      if (out) {
        var dbl = load();
        audit(dbl, out.username, "auth.logout", out.username);
        save(dbl);
      }
      writeJson(SESSION_KEY, null);
      window.Api.setToken(null);
      return delay({ status: "signed_out" });
    }

    if (route === "POST /auth/password-reset") {
      // Always the same answer, so the endpoint cannot be used to discover
      // which accounts exist. In this system passwords are set directly by
      // an administrator, not emailed as a link.
      return delay({ status: "accepted" });
    }

    if (route === "POST /auth/accounts") {
      var creatorSession = requireSession();
      if (!creatorSession) return delay().then(function () { return fail(401, "unauthenticated", "Your session has ended. Sign in again."); });
      if (creatorSession.permissions.indexOf("employees:manage") === -1) {
        return delay().then(function () { return fail(403, "forbidden", "You do not have permission to create accounts."); });
      }

      var newUsername = String(body.username || "").trim();
      var newPassword = String(body.password || "");
      var newRole = body.role === "admin" ? "admin" : "employee";
      var newEmployeeId = String(body.employee_id || "").trim();

      if (!newUsername || !newPassword) {
        return delay().then(function () { return fail(400, "missing_fields", "Choose a username and a password."); });
      }
      if (newPassword.length < 8) {
        return delay().then(function () { return fail(400, "weak_password", "Use at least 8 characters."); });
      }

      var acctDb = load();
      if (newEmployeeId && !acctDb.employees.some(function (e) { return e.employee_id === newEmployeeId; })) {
        return delay().then(function () { return fail(404, "not_found", "That employee record does not exist."); });
      }
      if (acctDb.users.some(function (u) { return u.username.toLowerCase() === newUsername.toLowerCase(); })) {
        return delay().then(function () { return fail(409, "username_taken", "That username is already in use. Choose a different one."); });
      }

      acctDb.users.push({
        username: newUsername,
        password: newPassword,
        role: newRole,
        display_name: newEmployeeId || newUsername,
        employee_id: newEmployeeId,
        permissions: newRole === "admin"
          ? ["employees:read"]
          : ["self:read", "self:update"],
        failed_attempts: 0,
        lockout_until: 0
      });
      audit(acctDb, creatorSession.username, "account.created", newUsername);
      save(acctDb);

      return delay({ username: newUsername, role: newRole });
    }

    /* -------------------------------------------------------- Employees */

    var session = requireSession();
    if (!session) {
      return delay().then(function () {
        return fail(401, "unauthenticated", "Your session has ended. Sign in again.");
      });
    }

    var db = load();
    var idMatch = path.match(/^\/employees\/([^/]+)$/);

    if (route === "GET /employees") {
      if (session.role !== "admin") {
        return delay().then(function () { return fail(403, "forbidden", "Employee records are limited to administrators."); });
      }
      var list = db.employees.slice();
      var q = String(query.q || "").trim().toLowerCase();
      if (q) {
        list = list.filter(function (e) {
          return (fullName(e) + " " + e.employee_id + " " + e.email + " " + e.position).toLowerCase().indexOf(q) !== -1;
        });
      }
      if (query.department) list = list.filter(function (e) { return e.department === query.department; });
      if (query.status) list = list.filter(function (e) { return e.employment_status === query.status; });

      var sort = query.sort || "last_name";
      var dir = query.order === "desc" ? -1 : 1;
      list.sort(function (a, b) {
        var av = String(a[sort] === undefined ? "" : a[sort]).toLowerCase();
        var bv = String(b[sort] === undefined ? "" : b[sort]).toLowerCase();
        return av < bv ? -dir : av > bv ? dir : 0;
      });

      var page = parseInt(query.page, 10) || 1;
      var size = parseInt(query.page_size, 10) || window.APP_CONFIG.PAGE_SIZE;
      var total = list.length;
      var start = (page - 1) * size;

      return delay({
        data: list.slice(start, start + size),
        meta: { page: page, page_size: size, total: total, total_pages: Math.max(1, Math.ceil(total / size)) }
      });
    }

    if (method === "GET" && idMatch) {
      var wanted = idMatch[1];
      if (session.role !== "admin" && wanted !== session.employee_id) {
        return delay().then(function () { return fail(403, "forbidden", "You can only open your own profile."); });
      }
      var found = db.employees.filter(function (e) { return e.employee_id === wanted; })[0];
      if (!found) return delay().then(function () { return fail(404, "not_found", "That employee record no longer exists."); });
      return delay({ data: found });
    }

    if (route === "POST /employees") {
      if (session.permissions.indexOf("employees:manage") === -1) {
        return delay().then(function () { return fail(403, "forbidden", "You do not have permission to add employees."); });
      }
      var problems = validateEmployee(db, body, null);
      if (problems) return delay().then(function () { return fail(400, "validation_failed", "Some fields need attention.", problems); });

      var record = Object.assign({}, body, {
        employee_id: nextEmployeeId(db),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      db.employees.push(record);
      audit(db, session.username, "employee.create", record.employee_id);
      save(db);
      return delay({ data: record });
    }

    if (method === "PUT" && idMatch) {
      var targetId = idMatch[1];
      var isSelf = targetId === session.employee_id;
      var canManage = session.permissions.indexOf("employees:manage") !== -1;
      if (!canManage && !isSelf) {
        return delay().then(function () { return fail(403, "forbidden", "You can only update your own profile."); });
      }
      var index = -1;
      db.employees.forEach(function (e, i) { if (e.employee_id === targetId) index = i; });
      if (index === -1) return delay().then(function () { return fail(404, "not_found", "That employee record no longer exists."); });

      var merged = Object.assign({}, db.employees[index], body, { employee_id: targetId });
      if (!canManage) {
        // Employees may only change their own contact details.
        merged = Object.assign({}, db.employees[index], {
          contact_number: body.contact_number,
          email: body.email,
          address: body.address,
          emergency_contact_name: body.emergency_contact_name,
          emergency_contact_relationship: body.emergency_contact_relationship,
          emergency_contact_number: body.emergency_contact_number
        });
      }
      var invalid = validateEmployee(db, merged, targetId);
      if (invalid) return delay().then(function () { return fail(400, "validation_failed", "Some fields need attention.", invalid); });

      merged.updated_at = new Date().toISOString();
      db.employees[index] = merged;
      audit(db, session.username, isSelf && !canManage ? "self.update" : "employee.update", targetId);
      save(db);
      return delay({ data: merged });
    }

    if (method === "DELETE" && idMatch) {
      if (session.permissions.indexOf("employees:manage") === -1) {
        return delay().then(function () { return fail(403, "forbidden", "You do not have permission to remove employees."); });
      }
      var delId = idMatch[1];
      var before = db.employees.length;
      db.employees = db.employees.filter(function (e) { return e.employee_id !== delId; });
      if (db.employees.length === before) {
        return delay().then(function () { return fail(404, "not_found", "That employee record no longer exists."); });
      }
      audit(db, session.username, "employee.delete", delId);
      save(db);
      return delay(null);
    }

    if (route === "GET /departments") {
      var counts = {};
      db.employees.forEach(function (e) { counts[e.department] = (counts[e.department] || 0) + 1; });
      return delay({
        data: db.departments.map(function (d) {
          return { id: d.id, code: d.code, name: d.name, employee_count: counts[d.name] || 0 };
        })
      });
    }

    if (route === "GET /dashboard/summary") {
      var active = db.employees.filter(function (e) { return e.employment_status === "Active"; }).length;
      var inactive = db.employees.filter(function (e) { return e.employment_status === "Inactive"; }).length;
      var onLeave = db.employees.filter(function (e) { return e.employment_status === "On Leave"; }).length;
      var byDept = {};
      db.employees.forEach(function (e) { byDept[e.department] = (byDept[e.department] || 0) + 1; });

      var recentlyAdded = db.employees.slice().sort(function (a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      }).slice(0, 5).map(summaryRow);

      var recentlyUpdated = db.employees.slice().sort(function (a, b) {
        return new Date(b.updated_at) - new Date(a.updated_at);
      }).slice(0, 5).map(summaryRow);

      return delay({
        data: {
          total_employees: db.employees.length,
          active_employees: active,
          inactive_employees: inactive,
          on_leave_employees: onLeave,
          department_count: db.departments.length,
          headcount_by_department: Object.keys(byDept).map(function (name) {
            return { department: name, count: byDept[name] };
          }).sort(function (a, b) { return b.count - a.count; }),
          recently_added: recentlyAdded,
          recently_updated: recentlyUpdated
        }
      });
    }

    if (route === "GET /audit-logs") {
      if (session.permissions.indexOf("audit:read") === -1) {
        return delay().then(function () { return fail(403, "forbidden", "Audit history is limited to administrators."); });
      }
      return delay({ data: db.audit.slice(0, parseInt(query.limit, 10) || 8) });
    }

    return delay().then(function () {
      return fail(404, "route_not_found", "Unknown endpoint: " + route);
    });
  }

  function summaryRow(e) {
    return {
      employee_id: e.employee_id,
      name: fullName(e),
      department: e.department,
      position: e.position,
      employment_status: e.employment_status,
      created_at: e.created_at,
      updated_at: e.updated_at
    };
  }

  window.MockApi = {
    handle: handle,
    reset: function () {
      try {
        localStorage.removeItem(STORE_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(ATTEMPT_KEY);
      } catch (e) { /* ignore */ }
    }
  };
})();
