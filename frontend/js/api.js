/**
 * API client — the single place where the frontend talks to the backend.
 *
 * Every call goes through request(), so swapping the mock layer for the real
 * C backend is a one-line configuration change (APP_CONFIG.USE_MOCK_API).
 *
 * Transport contract with the C backend:
 *   - JSON request and response bodies
 *   - Session cookie (HttpOnly, Secure, SameSite=Lax) sent via credentials
 *   - Bearer token fallback for clients that cannot use cookies
 *   - CSRF token echoed from the non-HttpOnly "csrf_token" cookie
 *   - Errors: { "error": { "code": "...", "message": "..." } } + HTTP status
 */
(function () {
  "use strict";

  var TOKEN_KEY = "epms.session.token";

  function ApiError(message, status, code, details) {
    this.name = "ApiError";
    this.message = message || "The request could not be completed.";
    this.status = status || 0;
    this.code = code || "unknown_error";
    this.details = details || null;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function readCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null;
    }
  }

  function setToken(token, persist) {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      if (!token) return;
      (persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch (err) {
      /* storage unavailable — cookie auth still works */
    }
  }

  /**
   * @param {string} path      e.g. "/employees/EMP-1001"
   * @param {object} [options] { method, body, query, signal }
   */
  async function request(path, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var query = options.query ? toQueryString(options.query) : "";

    if (window.APP_CONFIG.USE_MOCK_API) {
      return window.MockApi.handle(method, path, options.body || null, options.query || {});
    }

    var headers = { Accept: "application/json" };
    if (options.body !== undefined && options.body !== null) {
      headers["Content-Type"] = "application/json";
    }
    var token = getToken();
    if (token) headers.Authorization = "Bearer " + token;

    var csrf = readCookie("csrf_token");
    if (csrf && method !== "GET" && method !== "HEAD") {
      headers["X-CSRF-Token"] = csrf;
    }

    var response;
    try {
      response = await fetch(window.APP_CONFIG.API_BASE_URL + path + query, {
        method: method,
        headers: headers,
        credentials: "include",
        signal: options.signal,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (networkError) {
      throw new ApiError(
        "Cannot reach the server. Check your connection and try again.",
        0,
        "network_error"
      );
    }

    if (response.status === 204) return null;

    var payload = null;
    try {
      payload = await response.json();
    } catch (parseError) {
      payload = null;
    }

    if (!response.ok) {
      var err = (payload && payload.error) || {};
      if (response.status === 401) setToken(null);
      throw new ApiError(
        err.message || defaultMessageFor(response.status),
        response.status,
        err.code || "http_" + response.status,
        err.details || null
      );
    }

    return payload;
  }

  function defaultMessageFor(status) {
    switch (status) {
      case 400: return "The information sent was not valid.";
      case 401: return "Your session has ended. Sign in again.";
      case 403: return "You do not have permission to do that.";
      case 404: return "That record no longer exists.";
      case 409: return "That record conflicts with an existing one.";
      case 429: return "Too many attempts. Wait a moment before retrying.";
      default:  return "The server could not complete the request.";
    }
  }

  function toQueryString(params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  window.Api = {
    ApiError: ApiError,
    request: request,
    getToken: getToken,
    setToken: setToken,

    /* ------------------------------------------------- Authentication flow */
    login: function (role, identifier, password, remember) {
      return request("/auth/login", {
        method: "POST",
        body: { role: role, identifier: identifier, password: password, remember: !!remember }
      });
    },
    verifyTwoFactor: function (challengeId, code) {
      return request("/auth/2fa/verify", {
        method: "POST",
        body: { challenge_id: challengeId, code: code }
      });
    },
    resendTwoFactor: function (challengeId) {
      return request("/auth/2fa/resend", { method: "POST", body: { challenge_id: challengeId } });
    },
    validatePermissions: function () {
      return request("/auth/permissions");
    },
    requestPasswordReset: function (identifier) {
      return request("/auth/password-reset", { method: "POST", body: { identifier: identifier } });
    },
    logout: function () {
      return request("/auth/logout", { method: "POST", body: {} });
    },
    me: function () {
      return request("/auth/me");
    },

    /* ------------------------------------------------------------ Employees */
    listEmployees: function (params) {
      return request("/employees", { query: params || {} });
    },
    getEmployee: function (id) {
      return request("/employees/" + encodeURIComponent(id));
    },
    createEmployee: function (data) {
      return request("/employees", { method: "POST", body: data });
    },
    updateEmployee: function (id, data) {
      return request("/employees/" + encodeURIComponent(id), { method: "PUT", body: data });
    },
    deleteEmployee: function (id) {
      return request("/employees/" + encodeURIComponent(id), { method: "DELETE" });
    },

    /* ------------------------------------------------- Reference + summary */
    listDepartments: function () {
      return request("/departments");
    },
    getDashboard: function () {
      return request("/dashboard/summary");
    },
    getAuditLog: function (params) {
      return request("/audit-logs", { query: params || {} });
    }
  };
})();
