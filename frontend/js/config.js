/**
 * Runtime configuration.
 *
 * Nothing here is a secret: the file only decides *where* the browser sends
 * its API calls. Values can be overridden at deploy time without rebuilding
 * the frontend, in this order of priority:
 *
 *   1. window.__ENV__            (injected by the web server, e.g. env.js)
 *   2. <meta name="api-base-url" content="https://hr.example.com/api">
 *   3. Same origin + /api        (reverse-proxy deployments: domain, Tailscale)
 *   4. http://<current host>:8080/api  (local development default)
 *
 * Because rule 3 and 4 are derived from the current hostname, the app also
 * works untouched over a Tailscale MagicDNS name such as
 * http://hr-server.tailnet-name.ts.net:8080.
 */
(function () {
  "use strict";

  var injected = window.__ENV__ || {};
  var metaTag = document.querySelector('meta[name="api-base-url"]');
  var host = window.location.hostname;
  var isLocalDev =
    host === "localhost" ||
    host === "127.0.0.1" ||
    window.location.protocol === "file:";

  function resolveApiBaseUrl() {
    if (injected.API_BASE_URL) return injected.API_BASE_URL;
    if (metaTag && metaTag.content) return metaTag.content;
    if (isLocalDev) {
      return "http://" + (host || "localhost") + ":8080/api";
    }
    // Deployed behind a reverse proxy that forwards /api to the C backend.
    return window.location.origin + "/api";
  }

  window.APP_CONFIG = {
    APP_NAME: injected.APP_NAME || "Northline HR",
    SYSTEM_NAME: injected.SYSTEM_NAME || "Employee Profile Management System",
    API_BASE_URL: resolveApiBaseUrl(),

    /**
     * When true, requests are served by js/mock-api.js instead of the network.
     * Set USE_MOCK_API to false (or inject window.__ENV__.USE_MOCK_API = false)
     * once the C backend is running. No other frontend file changes.
     */
    USE_MOCK_API:
      injected.USE_MOCK_API !== undefined ? injected.USE_MOCK_API : true,

    /** Simulated network latency for the mock layer, in milliseconds. */
    MOCK_LATENCY_MS: injected.MOCK_LATENCY_MS || 320,

    /** Directory page size. */
    PAGE_SIZE: injected.PAGE_SIZE || 8,

    /** Session idle timeout mirrored from the backend, in minutes. */
    SESSION_IDLE_MINUTES: injected.SESSION_IDLE_MINUTES || 30,

    /** Permission required to open the administrator dashboard. */
    ADMIN_PERMISSION: "employees:manage",

    ROUTES: {
      portal: "../index.html",
      login: "login.html",
      twoFactor: "verify-2fa.html",
      resetPassword: "reset-password.html",
      accessDenied: "access-denied.html",
      employeeDashboard: "dashboard.html",
      adminDashboard: "admin-dashboard.html",
      employees: "employees.html",
      profile: "employee-profile.html",
      addEmployee: "add-employee.html",
      editEmployee: "edit-employee.html"
    }
  };
})();
