/**
 * Session handling for the browser side.
 *
 * The browser copy of the session exists only to render the interface and to
 * avoid pointless navigation. Authorisation is always re-checked by the
 * backend on every request — a user who edits sessionStorage gains nothing.
 */
(function () {
  "use strict";

  var USER_KEY = "epms.user";
  var LAST_SEEN_KEY = "epms.lastSeen";

  function readUser() {
    try {
      var raw = sessionStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeUser(user) {
    try {
      if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      else sessionStorage.removeItem(USER_KEY);
    } catch (err) { /* ignore */ }
  }

  function touch() {
    try { sessionStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch (err) { /* ignore */ }
  }

  function isIdleExpired() {
    try {
      var last = parseInt(sessionStorage.getItem(LAST_SEEN_KEY), 10);
      if (!last) return false;
      return Date.now() - last > window.APP_CONFIG.SESSION_IDLE_MINUTES * 60000;
    } catch (err) {
      return false;
    }
  }

  function can(permission) {
    var user = readUser();
    return !!user && user.permissions.indexOf(permission) !== -1;
  }

  function homeRouteFor(user) {
    if (!user) return window.APP_CONFIG.ROUTES.login;
    return user.role === "admin"
      ? window.APP_CONFIG.ROUTES.adminDashboard
      : window.APP_CONFIG.ROUTES.employeeDashboard;
  }

  function redirectToLogin(reason) {
    writeUser(null);
    window.Api.setToken(null);
    var url = window.APP_CONFIG.ROUTES.login;
    if (reason) url += "?reason=" + encodeURIComponent(reason);
    window.location.replace(url);
  }

  /**
   * Page guard. Call at the top of every protected page.
   * @param {object} [options] { role: "admin"|"employee", permission: "..." }
   * @returns {object|null} the signed-in user, or null while redirecting
   */
  function requireSession(options) {
    options = options || {};
    var user = readUser();

    if (!user) { redirectToLogin("signin_required"); return null; }
    if (isIdleExpired()) { redirectToLogin("session_expired"); return null; }
    if (options.role && user.role !== options.role) {
      window.location.replace(homeRouteFor(user));
      return null;
    }
    if (options.permission && user.permissions.indexOf(options.permission) === -1) {
      window.location.replace(window.APP_CONFIG.ROUTES.accessDenied);
      return null;
    }

    touch();
    ["click", "keydown"].forEach(function (evt) {
      document.addEventListener(evt, window.UI.debounce(touch, 2000), { passive: true });
    });

    return user;
  }

  async function signOut(options) {
    options = options || {};
    if (options.confirm) {
      var ok = await window.UI.confirmDialog({
        title: "Sign out?",
        message: "You will need your password and a verification code to sign back in.",
        confirmLabel: "Sign out"
      });
      if (!ok) return;
    }
    try {
      await window.Api.logout();
    } catch (err) {
      /* Sign out locally even if the server call fails. */
    }
    writeUser(null);
    window.Api.setToken(null);
    try { sessionStorage.removeItem(LAST_SEEN_KEY); } catch (e) { /* ignore */ }
    window.location.replace(window.APP_CONFIG.ROUTES.login + "?reason=signed_out");
  }

  /** Common handler for API failures on protected pages. */
  function handleApiError(error, fallbackMessage) {
    if (error && error.status === 401) {
      redirectToLogin("session_expired");
      return;
    }
    if (error && error.status === 403) {
      window.UI.toast(error.message, "error");
      return;
    }
    window.UI.toast((error && error.message) || fallbackMessage || "Something went wrong.", "error");
  }

  window.Auth = {
    getUser: readUser,
    setUser: writeUser,
    can: can,
    touch: touch,
    homeRouteFor: homeRouteFor,
    requireSession: requireSession,
    signOut: signOut,
    redirectToLogin: redirectToLogin,
    handleApiError: handleApiError
  };
})();
