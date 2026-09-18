/**
 * Dashboard controller. Handles both the administrator overview and the
 * employee self-service view, which share the same shell and widgets.
 */
(function () {
  "use strict";

  var page = document.body.dataset.page;
  var isAdmin = page === "admin-dashboard";

  var user = window.Auth.requireSession(
    isAdmin
      ? { role: "admin", permission: window.APP_CONFIG.ADMIN_PERMISSION }
      : { role: "employee" }
  );
  if (!user) return;

  window.Shell.render(user);

  function statCard(label, value, meta, accent) {
    return (
      '<div class="stat' + (accent ? " stat--accent" : "") + '">' +
        '<div class="stat__label">' + window.UI.escapeHtml(label) + "</div>" +
        '<div class="stat__value">' + window.UI.escapeHtml(value) + "</div>" +
        (meta ? '<div class="stat__meta">' + window.UI.escapeHtml(meta) + "</div>" : "") +
      "</div>"
    );
  }

  function activityRow(item, timeField) {
    return (
      "<li>" +
        '<span class="avatar" aria-hidden="true">' + window.UI.initials(item.name) + "</span>" +
        "<span>" +
          '<a class="activity__who" href="employee-profile.html?id=' + encodeURIComponent(item.employee_id) + '">' +
            window.UI.escapeHtml(item.name) + "</a><br>" +
          '<span class="activity__meta">' + window.UI.escapeHtml(item.position) + " \u00B7 " +
            window.UI.escapeHtml(item.department) + "</span>" +
        "</span>" +
        '<span class="activity__time">' + window.UI.formatRelative(item[timeField]) + "</span>" +
      "</li>"
    );
  }

  function emptyRow(message) {
    return '<li class="muted">' + window.UI.escapeHtml(message) + "</li>";
  }

  /* ----------------------------------------------------- Admin dashboard */

  async function loadAdmin() {
    document.getElementById("greeting").textContent =
      "Signed in as " + user.display_name + " \u00B7 administrator";

    try {
      var response = await window.Api.getDashboard();
      var d = response.data;

      document.getElementById("stats").innerHTML =
        statCard("Total employees", String(d.total_employees), "All records in the directory", true) +
        statCard("Active", String(d.active_employees), "Currently employed") +
        statCard("On leave", String(d.on_leave_employees), "Temporarily away") +
        statCard("Inactive", String(d.inactive_employees), "Separated or suspended") +
        statCard("Departments", String(d.department_count), "Cost centres in use");

      document.getElementById("recently-added").innerHTML =
        d.recently_added.length
          ? d.recently_added.map(function (i) { return activityRow(i, "created_at"); }).join("")
          : emptyRow("No employees added yet. Use Add employee to create the first record.");

      document.getElementById("recently-updated").innerHTML =
        d.recently_updated.length
          ? d.recently_updated.map(function (i) { return activityRow(i, "updated_at"); }).join("")
          : emptyRow("No profile changes recorded yet.");

      var total = d.total_employees || 1;
      document.getElementById("departments").innerHTML =
        d.headcount_by_department.map(function (row) {
          var pct = Math.round((row.count / total) * 100);
          return (
            '<div class="dept-bar">' +
              '<div class="dept-bar__head"><span>' + window.UI.escapeHtml(row.department) + "</span>" +
              "<span>" + row.count + " \u00B7 " + pct + "%</span></div>" +
              '<div class="dept-bar__track"><div class="dept-bar__fill" style="width:' + pct + '%"></div></div>' +
            "</div>"
          );
        }).join("");
    } catch (error) {
      document.getElementById("stats").innerHTML =
        '<div class="alert alert--error">' + window.UI.escapeHtml(error.message) + "</div>";
      window.Auth.handleApiError(error, "The dashboard could not be loaded.");
    }

    try {
      var logs = await window.Api.getAuditLog({ limit: 8 });
      document.getElementById("audit").innerHTML =
        logs.data.length
          ? logs.data.map(function (entry) {
              return (
                "<li>" +
                  '<span class="badge badge--plain">' + window.UI.escapeHtml(entry.action) + "</span>" +
                  "<span>" +
                    '<span class="activity__who">' + window.UI.escapeHtml(entry.target) + "</span><br>" +
                    '<span class="activity__meta">by ' + window.UI.escapeHtml(entry.actor) + "</span>" +
                  "</span>" +
                  '<span class="activity__time">' + window.UI.formatRelative(entry.at) + "</span>" +
                "</li>"
              );
            }).join("")
          : emptyRow("No activity recorded in this period.");
    } catch (error) {
      document.getElementById("audit").innerHTML = emptyRow("Activity history is unavailable right now.");
    }
  }

  /* -------------------------------------------------- Employee dashboard */

  function yearsOfService(dateHired) {
    if (!dateHired) return "--";
    var years = (Date.now() - new Date(dateHired).getTime()) / (365.25 * 86400000);
    if (years < 1) return Math.max(1, Math.round(years * 12)) + " months";
    return years.toFixed(1) + " years";
  }

  async function loadEmployee() {
    var id = user.employee_id;
    document.getElementById("greeting").textContent = "Hello, " + user.display_name.split(" ")[0];
    ["edit-mine", "qa-edit", "qa-emergency"].forEach(function (elementId) {
      var el = document.getElementById(elementId);
      if (el) el.href = "edit-employee.html?id=" + encodeURIComponent(id) + (elementId === "qa-emergency" ? "#emergency" : "");
    });
    ["view-profile", "qa-profile"].forEach(function (elementId) {
      document.getElementById(elementId).href = "employee-profile.html?id=" + encodeURIComponent(id);
    });
    document.getElementById("qa-signout").addEventListener("click", function () {
      window.Auth.signOut({ confirm: true });
    });

    try {
      var response = await window.Api.getEmployee(id);
      var e = response.data;

      document.getElementById("stats").innerHTML =
        statCard("Employment status", e.employment_status, "Maintained by HR", true) +
        statCard("Department", e.department, e.position) +
        statCard("Length of service", yearsOfService(e.date_hired), "Since " + window.UI.formatDate(e.date_hired)) +
        statCard("Profile updated", window.UI.formatRelative(e.updated_at), "Keep your contact details current");

      document.getElementById("snapshot-body").innerHTML =
        '<dl class="info-list">' +
          row("Employee ID", e.employee_id) +
          row("Full name", [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ")) +
          row("Work email", e.email) +
          row("Contact number", e.contact_number) +
          row("Address", e.address) +
          row("Emergency contact", e.emergency_contact_name + " (" + e.emergency_contact_relationship + ") \u00B7 " + e.emergency_contact_number) +
        "</dl>";
    } catch (error) {
      document.getElementById("snapshot-body").innerHTML =
        '<div class="alert alert--error">' + window.UI.escapeHtml(error.message) + "</div>";
      document.getElementById("stats").innerHTML = "";
      window.Auth.handleApiError(error, "Your record could not be loaded.");
    }
  }

  function row(label, value) {
    return "<div><dt>" + window.UI.escapeHtml(label) + "</dt><dd>" +
      window.UI.escapeHtml(value || "--") + "</dd></div>";
  }

  if (isAdmin) loadAdmin();
  else loadEmployee();
})();
