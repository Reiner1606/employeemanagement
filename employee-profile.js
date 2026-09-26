/**
 * Employee profile: read-only view of one record, with the actions the
 * signed-in account is allowed to take.
 */
(function () {
  "use strict";

  var user = window.Auth.requireSession();
  if (!user) return;
  window.Shell.render(user);

  var root = document.getElementById("profile-root");
  var breadcrumb = document.getElementById("profile-breadcrumb");
  var id = window.UI.queryParam("id") || user.employee_id;
  var isSelf = id === user.employee_id;
  var canManage = window.Auth.can("employees:manage");

  document.getElementById("back").addEventListener("click", function () {
    if (document.referrer && document.referrer.indexOf(window.location.origin) === 0) window.history.back();
    else window.location.href = canManage ? "employees.html" : "dashboard.html";
  });

  function row(label, value) {
    return "<div><dt>" + window.UI.escapeHtml(label) + "</dt><dd>" +
      window.UI.escapeHtml(value === undefined || value === null || value === "" ? "--" : value) + "</dd></div>";
  }

  function section(title, body) {
    return (
      '<section class="card">' +
        '<div class="section-title"><h2>' + window.UI.escapeHtml(title) + "</h2></div>" +
        '<dl class="info-list">' + body + "</dl>" +
      "</section>"
    );
  }

  function render(e) {
    var name = [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ");
    breadcrumb.textContent = (canManage ? "Directory / " : "My account / ") + name;
    document.title = name + " — Google";

    var avatar = e.photo_url
      ? '<img class="avatar avatar--lg" src="' + window.UI.escapeHtml(e.photo_url) + '" alt="">'
      : '<span class="avatar avatar--lg" aria-hidden="true">' + window.UI.initials(name) + "</span>";

    var actions = "";
    if (canManage || isSelf) {
      actions += '<a class="btn btn--primary" href="edit-employee.html?id=' + encodeURIComponent(e.employee_id) + '">' +
        '<span class="btn__label">' + (canManage ? "Edit profile" : "Update my details") + "</span></a>";
    }
    if (canManage) {
      actions += '<button type="button" class="btn" id="create-account" data-role="employee">' +
        '<span class="btn__label">Create login account</span></button>';
      actions += '<button type="button" class="btn btn--danger" id="delete-employee"><span class="btn__label">Delete record</span></button>';
    }

    root.innerHTML =
      '<section class="card">' +
        '<div class="profile-head">' +
          avatar +
          '<div class="profile-head__meta">' +
            '<h2 class="profile-head__name">' + window.UI.escapeHtml(name) + "</h2>" +
            '<p class="profile-head__role">' + window.UI.escapeHtml(e.position) + " \u00B7 " +
              window.UI.escapeHtml(e.department) + "</p>" +
            '<div class="profile-head__tags">' +
              '<span class="badge badge--plain">' + window.UI.escapeHtml(e.employee_id) + "</span>" +
              window.UI.statusBadge(e.employment_status) +
              '<span class="badge badge--plain">Hired ' + window.UI.formatDate(e.date_hired) + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="profile-head__actions">' + actions + "</div>" +
        "</div>" +
      "</section>" +

      '<div class="profile-grid">' +
        section("Personal information",
          row("First name", e.first_name) +
          row("Middle name", e.middle_name) +
          row("Last name", e.last_name) +
          row("Date of birth", window.UI.formatDate(e.date_of_birth)) +
          row("Gender", e.gender)) +

        section("Contact information",
          row("Work email", e.email) +
          row("Contact number", e.contact_number) +
          row("Address", e.address)) +

        section("Employment information",
          row("Employee ID", e.employee_id) +
          row("Position", e.position) +
          row("Department", e.department) +
          row("Employment status", e.employment_status) +
          row("Date hired", window.UI.formatDate(e.date_hired))) +

        section("Emergency contact",
          row("Name", e.emergency_contact_name) +
          row("Relationship", e.emergency_contact_relationship) +
          row("Contact number", e.emergency_contact_number)) +

        section("Account and system information",
          row("Record created", window.UI.formatDate(e.created_at)) +
          row("Last updated", window.UI.formatRelative(e.updated_at)) +
          row("Directory access", isSelf ? "This is your own record" : "Administrator view") +
          row("Viewed by", user.display_name + " (" + user.username + ")")) +
      "</div>";

    var createAccountButton = document.getElementById("create-account");
    if (createAccountButton) {
      createAccountButton.addEventListener("click", function () {
        showInviteDialog(e.employee_id, name);
      });
    }

    var deleteButton = document.getElementById("delete-employee");
    if (deleteButton) {
      deleteButton.addEventListener("click", async function () {
        var confirmed = await window.UI.confirmDialog({
          title: "Delete " + name + "?",
          message: "The record is removed from the directory. This cannot be undone.",
          confirmLabel: "Delete record",
          danger: true
        });
        if (!confirmed) return;
        window.UI.setLoading(deleteButton, true, "Deleting");
        try {
          await window.Api.deleteEmployee(e.employee_id);
          window.UI.toast("Employee record deleted.", "success");
          setTimeout(function () { window.location.href = "employees.html"; }, 600);
        } catch (error) {
          window.UI.setLoading(deleteButton, false);
          window.Auth.handleApiError(error, "The record could not be deleted.");
        }
      });
    }
  }

  function showInviteDialog(employeeId, name) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">' +
        '<h3 id="invite-title">Create a login account for ' + window.UI.escapeHtml(name) + '</h3>' +
        '<p class="muted small">Choose a username and password for this account. ' +
          'Share them with ' + window.UI.escapeHtml(name) + ' directly \u2014 there is no email link.</p>' +
        '<div class="field" style="margin-top:16px">' +
          '<label for="invite-role">Account type</label>' +
          '<select class="select" id="invite-role">' +
            '<option value="employee">Employee (self-service only)</option>' +
            '<option value="admin">Administrator</option>' +
          '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label for="invite-username">Username</label>' +
          '<input class="input" id="invite-username" value="' + window.UI.escapeHtml(employeeId) + '">' +
        '</div>' +
        '<div class="field">' +
          '<label for="invite-password">Initial password</label>' +
          '<div class="input-group">' +
            '<input class="input" type="password" id="invite-password" minlength="8" placeholder="At least 8 characters">' +
            '<button type="button" class="input-group__action" id="invite-toggle-password">Show</button>' +
          '</div>' +
        '</div>' +
        '<div id="invite-result"></div>' +
        '<div class="modal__actions">' +
          '<button type="button" class="btn" data-action="close"><span class="btn__label">Close</span></button>' +
          '<button type="button" class="btn btn--primary" id="invite-generate"><span class="btn__label">Create account</span></button>' +
        '</div>' +
      '</div>';

    function close() { backdrop.remove(); }
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop || event.target.closest('[data-action="close"]')) close();
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    document.body.appendChild(backdrop);

    document.getElementById("invite-toggle-password").addEventListener("click", function () {
      var input = document.getElementById("invite-password");
      var toggle = document.getElementById("invite-toggle-password");
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
    });

    var generateButton = document.getElementById("invite-generate");
    generateButton.addEventListener("click", async function () {
      var role = document.getElementById("invite-role").value;
      var username = document.getElementById("invite-username").value.trim();
      var password = document.getElementById("invite-password").value;
      var resultBox = document.getElementById("invite-result");

      if (!username) {
        resultBox.innerHTML = '<div class="alert alert--error" style="margin-top:16px">Enter a username.</div>';
        return;
      }
      if (password.length < 8) {
        resultBox.innerHTML = '<div class="alert alert--error" style="margin-top:16px">Use a password of at least 8 characters.</div>';
        return;
      }

      window.UI.setLoading(generateButton, true, "Creating");
      try {
        var result = await window.Api.createAccount(employeeId, role, username, password);
        resultBox.innerHTML =
          '<div class="alert alert--success" style="margin-top:16px">' +
            "Account created. Give " + window.UI.escapeHtml(name) + " this username and password directly:" +
          "</div>" +
          '<div class="field"><label>Username</label><input class="input" readonly value="' +
            window.UI.escapeHtml(result.username) + '"></div>' +
          '<div class="field"><label>Password</label><input class="input" readonly value="' +
            window.UI.escapeHtml(password) + '"></div>';
        document.getElementById("invite-role").disabled = true;
        document.getElementById("invite-username").disabled = true;
        document.getElementById("invite-password").disabled = true;
        document.getElementById("invite-toggle-password").disabled = true;
        generateButton.remove();
      } catch (error) {
        resultBox.innerHTML =
          '<div class="alert alert--error" style="margin-top:16px">' + window.UI.escapeHtml(error.message) + "</div>";
        window.UI.setLoading(generateButton, false);
      }
    });
  }

  async function load() {
    try {
      var response = await window.Api.getEmployee(id);
      render(response.data);
    } catch (error) {
      breadcrumb.textContent = "Profile unavailable";
      root.innerHTML =
        '<section class="card"><div class="state">' +
          "<h3>" + (error.status === 404 ? "That employee record no longer exists" : "This profile could not be opened") + "</h3>" +
          "<p>" + window.UI.escapeHtml(error.message) + "</p>" +
          '<a class="btn btn--sm" href="' + (window.Auth.can("employees:manage") ? "employees.html" : "dashboard.html") + '">' +
            '<span class="btn__label">Go back</span></a>' +
        "</div></section>";
      if (error.status === 401) window.Auth.handleApiError(error);
    }
  }

  load();
})();
