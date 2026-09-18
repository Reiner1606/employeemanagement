/**
 * Development mock backend.
 *
 * It implements exactly the REST contract documented in docs/api.md, so the
 * real C backend can replace it without any change to page scripts. Set
 * APP_CONFIG.USE_MOCK_API = false to bypass this file entirely.
 *
 * SECURITY NOTE: no passwords are stored here, in any form. During development
 * the mock accepts any password of at least 8 characters for a known account,
 * which is enough to exercise both the success and the failure branches of the
 * login flow. Real credential checking belongs in the C backend only.
 */
(function () {
  "use strict";

  var STORE_KEY = "epms.mock.db.v1";
  var SESSION_KEY = "epms.mock.session";
  var CHALLENGE_KEY = "epms.mock.challenges";
  var ATTEMPT_KEY = "epms.mock.attempts";
  var MAX_ATTEMPTS = 5;
  var ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

  var DEPARTMENTS = [
    { id: 1, code: "ENG", name: "Engineering" },
    { id: 2, code: "HR", name: "Human Resources" },
    { id: 3, code: "FIN", name: "Finance" },
    { id: 4, code: "OPS", name: "Operations" },
    { id: 5, code: "SAL", name: "Sales" }
  ];

  var USERS = [
    {
      username: "ADM-0001",
      role: "admin",
      display_name: "Marisol Ferrer",
      employee_id: "EMP-1003",
      permissions: ["employees:manage", "employees:read", "reports:read", "audit:read"]
    },
    {
      username: "ADM-0002",
      role: "admin",
      display_name: "Ruben Caltrider",
      employee_id: "EMP-1009",
      // Account exists but its role assignment has not been approved yet:
      // exercises the "Authorized? -> No -> secure logout" branch.
      permissions: ["employees:read"]
    },
    {
      username: "EMP-1001",
      role: "employee",
      display_name: "Alia Navarro",
      employee_id: "EMP-1001",
      permissions: ["self:read", "self:update"]
    },
    {
      username: "EMP-1005",
      role: "employee",
      display_name: "Teodoro Vasquez",
      employee_id: "EMP-1005",
      permissions: ["self:read", "self:update"]
    }
  ];

  function seedEmployees() {
    var rows = [
      ["EMP-1001", "Alia", "Reyes", "Navarro", "1994-03-11", "Female", "Engineering", "Backend Engineer", "Active", "2021-06-14"],
      ["EMP-1002", "Marcus", "T.", "Oyelaran", "1988-11-02", "Male", "Engineering", "Engineering Manager", "Active", "2019-02-04"],
      ["EMP-1003", "Marisol", "", "Ferrer", "1985-07-23", "Female", "Human Resources", "HR Director", "Active", "2017-09-18"],
      ["EMP-1004", "Priya", "K.", "Raman", "1996-01-30", "Female", "Finance", "Financial Analyst", "Active", "2022-03-07"],
      ["EMP-1005", "Teodoro", "L.", "Vasquez", "1991-05-19", "Male", "Operations", "Logistics Coordinator", "Active", "2020-08-24"],
      ["EMP-1006", "Hana", "", "Sugimoto", "1993-09-08", "Female", "Sales", "Account Executive", "On Leave", "2021-01-11"],
      ["EMP-1007", "Dmitri", "A.", "Volkov", "1982-12-15", "Male", "Engineering", "Platform Architect", "Active", "2016-05-30"],
      ["EMP-1008", "Grace", "M.", "Abiodun", "1998-04-27", "Female", "Human Resources", "Recruitment Officer", "Active", "2023-02-13"],
      ["EMP-1009", "Ruben", "", "Caltrider", "1990-10-05", "Male", "Operations", "Facilities Supervisor", "Active", "2018-11-26"],
      ["EMP-1010", "Ines", "B.", "Delacroix", "1987-02-14", "Female", "Finance", "Payroll Specialist", "Inactive", "2015-07-01"],
      ["EMP-1011", "Samuel", "", "Okonjo", "1995-06-21", "Male", "Sales", "Sales Development Rep", "Active", "2023-09-04"],
      ["EMP-1012", "Nadia", "R.", "Haddad", "1992-08-17", "Female", "Engineering", "QA Engineer", "Active", "2022-11-21"],
      ["EMP-1013", "Owen", "P.", "Whitlock", "1980-01-09", "Male", "Operations", "Operations Director", "Active", "2014-04-15"],
      ["EMP-1014", "Lucia", "", "Moreno", "1999-12-03", "Female", "Human Resources", "HR Assistant", "Active", "2024-01-08"]
    ];

    return rows.map(function (r, index) {
      var slug = (r[1] + "." + r[3]).toLowerCase();
      return {
        employee_id: r[0],
        first_name: r[1],
        middle_name: r[2],
        last_name: r[3],
        date_of_birth: r[4],
        gender: r[5],
        department: r[6],
        position: r[7],
        employment_status: r[8],
        date_hired: r[9],
        email: slug + "@northline.example",
        contact_number: "+63 917 " + (1000000 + index * 13571).toString().slice(0, 3) + " " + (4000 + index * 7),
        address: (120 + index) + " Katipunan Ave, Quezon City, Metro Manila",
        photo_url: "",
        emergency_contact_name: ["Elena Navarro", "Bisi Oyelaran", "Paulo Ferrer", "Anil Raman", "Mila Vasquez", "Kenji Sugimoto", "Irina Volkov", "Tunde Abiodun", "Dana Caltrider", "Paul Delacroix", "Ada Okonjo", "Rami Haddad", "Ellen Whitlock", "Jose Moreno"][index],
        emergency_contact_relationship: ["Mother", "Sister", "Spouse", "Father", "Spouse", "Brother", "Spouse", "Father", "Spouse", "Spouse", "Mother", "Brother", "Spouse", "Father"][index],
        emergency_contact_number: "+63 918 " + (2000000 + index * 20931).toString().slice(0, 3) + " " + (7100 + index * 3),
        created_at: isoDaysAgo(420 - index * 11),
        updated_at: isoDaysAgo(index * 3 + 1)
      };
    });
  }

  function isoDaysAgo(days) {
    var d = new Date(Date.now() - days * 86400000);
    return d.toISOString();
  }

  /* --------------------------------------------------------------- Storage */

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* fall through to reseed */ }
    }
    var db = {
      employees: seedEmployees(),
      departments: DEPARTMENTS,
      audit: [
        { id: 1, actor: "ADM-0001", action: "employee.create", target: "EMP-1014", at: isoDaysAgo(2) },
        { id: 2, actor: "ADM-0001", action: "employee.update", target: "EMP-1006", at: isoDaysAgo(1) },
        { id: 3, actor: "EMP-1001", action: "self.update", target: "EMP-1001", at: isoDaysAgo(0.4) }
      ],
      nextAudit: 4
    };
    save(db);
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

  function nextEmployeeId(db) {
    var max = 1000;
    db.employees.forEach(function (e) {
      var n = parseInt(String(e.employee_id).replace(/\D/g, ""), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return "EMP-" + (max + 1);
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
      var user = USERS.filter(function (u) {
        return u.username.toLowerCase() === identifier.toLowerCase() && u.role === body.role;
      })[0];
      var passwordLooksValid = String(body.password || "").length >= 8;

      if (!user || !passwordLooksValid) {
        recordAttempt(identifier, false);
        return delay().then(function () {
          return fail(401, "invalid_credentials",
            body.role === "admin"
              ? "Administrator sign-in failed. Check the username and password, then contact the system administrator if the problem continues."
              : "Sign-in failed. Check your employee ID and password.");
        });
      }
      recordAttempt(identifier, true);

      var challenge = {
        challenge_id: "chg_" + Math.random().toString(36).slice(2, 10),
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        employee_id: user.employee_id,
        permissions: user.permissions,
        remember: !!body.remember,
        attempts: 0,
        expires_at: Date.now() + 5 * 60 * 1000
      };
      writeJson(CHALLENGE_KEY, challenge);
      return delay({
        status: "2fa_required",
        challenge_id: challenge.challenge_id,
        delivery: "Authenticator app",
        expires_in: 300
      });
    }

    if (route === "POST /auth/2fa/verify") {
      var chg = readJson(CHALLENGE_KEY, null);
      if (!chg || chg.challenge_id !== body.challenge_id) {
        return delay().then(function () {
          return fail(401, "challenge_not_found", "This verification step has expired. Sign in again.");
        });
      }
      if (Date.now() > chg.expires_at) {
        writeJson(CHALLENGE_KEY, null);
        return delay().then(function () {
          return fail(401, "challenge_expired", "The code expired. Sign in again to get a new one.");
        });
      }
      var code = String(body.code || "").trim();
      // Dev rule: any 6-digit code works except 000000, which demonstrates the
      // "Code correct? -> No" branch of the flowchart.
      if (!/^\d{6}$/.test(code) || code === "000000") {
        chg.attempts += 1;
        writeJson(CHALLENGE_KEY, chg);
        if (chg.attempts >= 3) {
          writeJson(CHALLENGE_KEY, null);
          return delay().then(function () {
            return fail(401, "challenge_locked", "Too many incorrect codes. Sign in again.");
          });
        }
        return delay().then(function () {
          return fail(401, "invalid_code", "That code is not correct. " + (3 - chg.attempts) + " attempts left.");
        });
      }

      var session = {
        authenticated: true,
        username: chg.username,
        role: chg.role,
        display_name: chg.display_name,
        employee_id: chg.employee_id,
        permissions: chg.permissions,
        permission_checked: false,
        issued_at: Date.now(),
        token: "mock_" + Math.random().toString(36).slice(2)
      };
      writeJson(SESSION_KEY, session);
      writeJson(CHALLENGE_KEY, null);
      window.Api.setToken(session.token, chg.remember);

      var db = load();
      audit(db, session.username, "auth.login", session.username);
      save(db);

      return delay({
        status: "authenticated",
        token: session.token,
        user: publicUser(session),
        next: session.role === "admin" ? "validate_permissions" : "dashboard"
      });
    }

    if (route === "POST /auth/2fa/resend") {
      var c = readJson(CHALLENGE_KEY, null);
      if (!c) return delay().then(function () { return fail(401, "challenge_not_found", "Sign in again to get a new code."); });
      c.expires_at = Date.now() + 5 * 60 * 1000;
      writeJson(CHALLENGE_KEY, c);
      return delay({ status: "sent", expires_in: 300 });
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
      writeJson(CHALLENGE_KEY, null);
      window.Api.setToken(null);
      return delay({ status: "signed_out" });
    }

    if (route === "POST /auth/password-reset") {
      // Always the same answer, so the endpoint cannot be used to discover
      // which accounts exist.
      return delay({ status: "accepted" });
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

  function publicUser(session) {
    return {
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      employee_id: session.employee_id,
      permissions: session.permissions
    };
  }

  window.MockApi = {
    handle: handle,
    reset: function () {
      try {
        localStorage.removeItem(STORE_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(CHALLENGE_KEY);
        sessionStorage.removeItem(ATTEMPT_KEY);
      } catch (e) { /* ignore */ }
    },
    demoAccounts: USERS.map(function (u) {
      return { username: u.username, role: u.role, name: u.display_name };
    })
  };
})();
