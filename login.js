/**
 * Controller for the authentication screens:
 * login -> credential validation -> (admin) permission check -> dashboard
 *
 * There is no verification-code step. A correct username and password signs
 * the person in immediately; administrators then pass through one more
 * check (their permission to manage employees) before reaching their
 * dashboard.
 */
(function () {
  "use strict";

  var page = document.body.dataset.page;

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
      ? "Use the administrator username and password your admin gave you."
      : "Use the username and password your admin gave you.";
    document.getElementById("identifier-label").innerHTML = isAdmin
      ? 'Administrator username <span class="req">*</span>'
      : 'Username <span class="req">*</span>';
    identifier.placeholder = isAdmin ? "e.g. jane.admin" : "e.g. jane.doe";
    identifier.dataset.label = isAdmin ? "Administrator username" : "Username";
    if (isAdmin) {
      password.minLength = 12;
      password.dataset.label = "Password";
      resetLink.textContent = "Contact the system administrator";
      resetLink.href = "mailto:it-helpdesk@google.example?subject=Administrator%20access";
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

      window.UI.setLoading(submit, true, "Signing in");
      try {
        var result = await window.Api.login(
          role,
          identifier.value.trim(),
          password.value,
          document.getElementById("remember").checked
        );
        window.Api.setToken(result.token, document.getElementById("remember").checked);
        window.Auth.setUser(result.user);
        window.Auth.touch();
        window.location.replace(
          result.next === "validate_permissions" ? "validate-permissions.html" : "dashboard.html"
        );
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
      document.getElementById("dev-note").textContent =
        "Development mode: sign in with an account you created from the admin dashboard, " +
        "or set BOOTSTRAP_ADMIN in js/config.js for the very first one.";
    }
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
          "The system administrator has been notified. Passwords in this system are set " +
          "directly by an administrator rather than by an emailed link.",
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
    "validate-permissions": initPermissionCheck,
    "access-denied": initAccessDenied,
    "reset-password": initReset
  };

  if (routes[page]) routes[page]();
})();
