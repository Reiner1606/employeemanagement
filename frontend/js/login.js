/**
 * Controller for every screen in the authentication flow:
 * login -> credential validation -> 2FA -> (admin) permission check -> dashboard
 */
(function () {
  "use strict";

  var CHALLENGE_KEY = "epms.pending.challenge";
  var page = document.body.dataset.page;

  function stash(value) {
    try {
      if (value) sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(CHALLENGE_KEY);
    } catch (err) { /* ignore */ }
  }

  function pending() {
    try {
      var raw = sessionStorage.getItem(CHALLENGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  /* ------------------------------------------------------------ Login page */

  function initLogin() {
    var role = window.UI.queryParam("role") === "admin" ? "admin" : "employee";
    var isAdmin = role === "admin";

    var form = document.getElementById("login-form");
    var alertBox = document.getElementById("login-alert");
    var submit = document.getElementById("login-submit");
    var identifier = document.getElementById("identifier");
    var password = document.getElementById("password");
    var resetLink = document.getElementById("reset-link");

    document.getElementById("login-title").textContent = isAdmin ? "Administrator sign in" : "Employee sign in";
    document.getElementById("login-subtitle").textContent = isAdmin
      ? "Use your administrator username and complex password."
      : "Use your employee ID and password.";
    document.getElementById("identifier-label").innerHTML = isAdmin
      ? 'Administrator username <span class="req">*</span>'
      : 'Employee ID <span class="req">*</span>';
    identifier.placeholder = isAdmin ? "ADM-0001" : "EMP-1001";
    identifier.dataset.label = isAdmin ? "Administrator username" : "Employee ID";
    if (isAdmin) {
      password.minLength = 12;
      password.dataset.label = "Password";
      resetLink.textContent = "Contact the system administrator";
      resetLink.href = "mailto:it-helpdesk@northline.example?subject=Administrator%20access";
    }

    var reason = window.UI.queryParam("reason");
    if (reason === "session_expired") {
      window.UI.showAlert(alertBox, "Your session ended after a period of inactivity. Sign in again.", "warning");
    } else if (reason === "signed_out") {
      window.UI.showAlert(alertBox, "You are signed out.", "success");
    } else if (reason === "signin_required") {
      window.UI.showAlert(alertBox, "Sign in to open that page.", "info");
    }

    var toggle = document.getElementById("toggle-password");
    toggle.addEventListener("click", function () {
      var showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", String(!showing));
      password.focus();
    });

    window.UI.attachLiveValidation(form);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      window.UI.hideAlert(alertBox);
      if (!window.UI.validateForm(form)) return;

      window.UI.setLoading(submit, true, "Checking credentials");
      try {
        var result = await window.Api.login(
          role,
          identifier.value.trim(),
          password.value,
          document.getElementById("remember").checked
        );
        stash({
          challenge_id: result.challenge_id,
          role: role,
          identifier: identifier.value.trim(),
          delivery: result.delivery,
          expires_at: Date.now() + (result.expires_in || 300) * 1000
        });
        window.location.href = "verify-2fa.html";
      } catch (error) {
        password.value = "";
        var message = error.message;
        if (isAdmin && error.status === 401) {
          message += " Repeated failures are reported to the system administrator.";
        }
        window.UI.showAlert(alertBox, message, error.status === 429 ? "warning" : "error");
        identifier.focus();
      } finally {
        window.UI.setLoading(submit, false);
      }
    });

    if (window.APP_CONFIG.USE_MOCK_API) {
      var accounts = window.MockApi.demoAccounts
        .filter(function (a) { return a.role === role; })
        .map(function (a) { return a.username; })
        .join(", ");
      document.getElementById("dev-note").textContent =
        "Development mode: sample accounts " + accounts +
        ". Any password of 8 or more characters is accepted; no passwords are stored in the frontend.";
    }
  }

  /* ---------------------------------------------------------- 2FA page */

  function initTwoFactor() {
    var challenge = pending();
    if (!challenge) {
      window.location.replace("login.html?reason=signin_required");
      return;
    }

    var form = document.getElementById("twofa-form");
    var alertBox = document.getElementById("twofa-alert");
    var submit = document.getElementById("twofa-submit");
    var codeInput = document.getElementById("code");
    var expiry = document.getElementById("expiry");

    document.getElementById("twofa-subtitle").textContent =
      "Open " + (challenge.delivery || "your authenticator app") + " and enter the 6-digit code.";
    document.getElementById("twofa-account").textContent = "Signing in as " + challenge.identifier;

    var timer = setInterval(function () {
      var left = Math.max(0, Math.round((challenge.expires_at - Date.now()) / 1000));
      var minutes = Math.floor(left / 60);
      var seconds = String(left % 60).padStart(2, "0");
      expiry.textContent = left > 0 ? "Code expires in " + minutes + ":" + seconds : "Code expired";
      if (left === 0) clearInterval(timer);
    }, 1000);

    codeInput.addEventListener("input", function () {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
      window.UI.clearFieldError(codeInput);
    });

    document.getElementById("resend").addEventListener("click", async function () {
      try {
        var result = await window.Api.resendTwoFactor(challenge.challenge_id);
        challenge.expires_at = Date.now() + (result.expires_in || 300) * 1000;
        stash(challenge);
        window.UI.toast("A new code is on its way.", "success");
      } catch (error) {
        window.UI.showAlert(alertBox, error.message, "error");
      }
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      window.UI.hideAlert(alertBox);
      if (!window.UI.validateForm(form)) return;

      window.UI.setLoading(submit, true, "Verifying");
      try {
        var result = await window.Api.verifyTwoFactor(challenge.challenge_id, codeInput.value);
        window.Api.setToken(result.token, false);
        window.Auth.setUser(result.user);
        window.Auth.touch();
        stash(null);
        window.location.replace(
          result.next === "validate_permissions" ? "validate-permissions.html" : "dashboard.html"
        );
      } catch (error) {
        codeInput.value = "";
        codeInput.focus();
        window.UI.showAlert(alertBox, error.message, "error");
        if (error.code === "challenge_locked" || error.code === "challenge_expired") {
          stash(null);
          setTimeout(function () { window.location.replace("login.html"); }, 1800);
        }
      } finally {
        window.UI.setLoading(submit, false);
      }
    });
  }

  /* -------------------------------------------- Administrator permissions */

  function initPermissionCheck() {
    var user = window.Auth.getUser();
    if (!user) { window.location.replace("login.html?reason=signin_required"); return; }
    if (user.role !== "admin") { window.location.replace("dashboard.html"); return; }

    var checks = document.getElementById("perm-checks");
    var alertBox = document.getElementById("perm-alert");
    var actions = document.getElementById("perm-actions");
    var attempts = 0;

    function mark(name, state) {
      var li = checks.querySelector('[data-check="' + name + '"]');
      if (li) li.dataset.state = state;
    }

    async function run() {
      attempts += 1;
      actions.classList.add("hidden");
      window.UI.hideAlert(alertBox);
      mark("identity", "pass");
      mark("role", "running");
      mark("scope", "idle");

      try {
        var result = await window.Api.validatePermissions();
        mark("role", result.role === "admin" ? "pass" : "fail");
        mark("scope", "running");

        setTimeout(function () {
          if (result.authorized) {
            mark("scope", "pass");
            window.Auth.setUser(Object.assign({}, user, { permissions: result.permissions }));
            window.location.replace("admin-dashboard.html");
            return;
          }
          mark("scope", "fail");
          window.UI.showAlert(alertBox, result.reason || "This account is not authorised for employee management.", "error");
          if (attempts >= 2) {
            sessionStorage.setItem("epms.denied", JSON.stringify({
              account: user.username,
              reason: result.reason,
              reference: "AUTHZ-" + Date.now().toString(36).toUpperCase()
            }));
            window.location.replace("access-denied.html");
            return;
          }
          actions.classList.remove("hidden");
        }, 450);
      } catch (error) {
        mark("role", "fail");
        window.UI.showAlert(alertBox, error.message, "error");
        actions.classList.remove("hidden");
      }
    }

    document.getElementById("perm-retry").addEventListener("click", run);
    document.getElementById("perm-signout").addEventListener("click", function () {
      window.Auth.signOut({ confirm: false });
    });

    run();
  }

  /* ------------------------------------------------------- Access denied */

  function initAccessDenied() {
    var info = { account: "--", reason: null, reference: "--" };
    try {
      var raw = sessionStorage.getItem("epms.denied");
      if (raw) info = Object.assign(info, JSON.parse(raw));
    } catch (err) { /* ignore */ }

    var user = window.Auth.getUser();
    document.getElementById("denied-account").textContent =
      info.account !== "--" ? info.account : (user ? user.username : "--");
    document.getElementById("denied-reference").textContent = info.reference;
    if (info.reason) document.getElementById("denied-reason").textContent = info.reason;

    // The flowchart ends this branch with a secure logout, so close the
    // session immediately rather than leaving it open on screen.
    window.Api.logout().catch(function () { /* already invalid */ });
    window.Auth.setUser(null);
    window.Api.setToken(null);
    try { sessionStorage.removeItem("epms.denied"); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------ Password reset */

  function initReset() {
    var form = document.getElementById("reset-form");
    var alertBox = document.getElementById("reset-alert");
    var submit = document.getElementById("reset-submit");
    window.UI.attachLiveValidation(form);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!window.UI.validateForm(form)) return;
      window.UI.setLoading(submit, true, "Sending");
      try {
        await window.Api.requestPasswordReset(document.getElementById("identifier").value.trim());
        window.UI.showAlert(
          alertBox,
          "If that account exists, a reset link is on its way to the work email on file. The link expires in 30 minutes.",
          "success"
        );
        form.reset();
      } catch (error) {
        window.UI.showAlert(alertBox, error.message, "error");
      } finally {
        window.UI.setLoading(submit, false);
      }
    });
  }

  var routes = {
    "login": initLogin,
    "verify-2fa": initTwoFactor,
    "validate-permissions": initPermissionCheck,
    "access-denied": initAccessDenied,
    "reset-password": initReset
  };

  if (routes[page]) routes[page]();
})();
