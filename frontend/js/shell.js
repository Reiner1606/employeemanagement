/**
 * Renders the sidebar and wires up the responsive navigation. Pages only need
 * an empty <aside class="sidebar" id="sidebar"> and a topbar with a
 * [data-menu-toggle] button.
 */
(function () {
  "use strict";

  var NAV = {
    admin: [
      { group: "Overview", items: [
        { href: "admin-dashboard.html", icon: "\u25A6", label: "Dashboard" }
      ]},
      { group: "Employee management", items: [
        { href: "employees.html", icon: "\u2630", label: "Employee directory" },
        { href: "add-employee.html", icon: "\u002B", label: "Add employee", permission: "employees:manage" }
      ]},
      { group: "Account", items: [
        { href: "employee-profile.html", icon: "\u25CB", label: "My profile", self: true }
      ]}
    ],
    employee: [
      { group: "Overview", items: [
        { href: "dashboard.html", icon: "\u25A6", label: "Dashboard" }
      ]},
      { group: "Self service", items: [
        { href: "employee-profile.html", icon: "\u25CB", label: "My profile", self: true },
        { href: "edit-employee.html", icon: "\u270E", label: "Update my details", self: true }
      ]}
    ]
  };

  function currentPage() {
    var parts = window.location.pathname.split("/");
    return parts[parts.length - 1] || "dashboard.html";
  }

  function render(user) {
    var sidebar = document.getElementById("sidebar");
    if (!sidebar || !user) return;

    var page = currentPage();
    var groups = NAV[user.role] || NAV.employee;
    var html = "";

    html +=
      '<div class="sidebar__brand brand">' +
        '<span class="brand__mark" aria-hidden="true">NL</span>' +
        "<span>" +
          '<span class="brand__name">' + window.UI.escapeHtml(window.APP_CONFIG.APP_NAME) + "</span><br>" +
          '<span class="brand__org">Employee profiles</span>' +
        "</span>" +
      "</div>";

    html += '<nav class="nav" aria-label="Main">';
    groups.forEach(function (group) {
      var items = group.items.filter(function (item) {
        return !item.permission || user.permissions.indexOf(item.permission) !== -1;
      });
      if (!items.length) return;
      html += '<div class="nav__label">' + window.UI.escapeHtml(group.group) + "</div>";
      items.forEach(function (item) {
        var href = item.self ? item.href + "?id=" + encodeURIComponent(user.employee_id) : item.href;
        var isCurrent = page === item.href;
        html +=
          '<a class="nav__link" href="' + href + '"' + (isCurrent ? ' aria-current="page"' : "") + ">" +
            '<span class="nav__icon" aria-hidden="true">' + item.icon + "</span>" +
            window.UI.escapeHtml(item.label) +
          "</a>";
      });
    });
    html += "</nav>";

    html +=
      '<div class="sidebar__foot">' +
        '<div class="session">' +
          '<span class="session__avatar" aria-hidden="true">' + window.UI.initials(user.display_name) + "</span>" +
          "<span>" +
            '<span class="session__name">' + window.UI.escapeHtml(user.display_name) + "</span><br>" +
            '<span class="session__role">' + (user.role === "admin" ? "Administrator" : "Employee") +
              " \u00B7 " + window.UI.escapeHtml(user.username) + "</span>" +
          "</span>" +
        "</div>" +
        '<button type="button" class="btn btn--block btn--sm" id="sign-out">' +
          '<span class="btn__label">Sign out</span>' +
        "</button>" +
      "</div>";

    sidebar.innerHTML = html;
    sidebar.querySelector("#sign-out").addEventListener("click", function () {
      window.Auth.signOut({ confirm: true });
    });

    wireResponsiveNav(sidebar);
  }

  function wireResponsiveNav(sidebar) {
    var toggle = document.querySelector("[data-menu-toggle]");
    if (!toggle) return;
    var backdrop = null;

    function close() {
      sidebar.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
      if (backdrop) { backdrop.remove(); backdrop = null; }
    }

    toggle.addEventListener("click", function () {
      var open = sidebar.dataset.open === "true";
      if (open) { close(); return; }
      sidebar.dataset.open = "true";
      toggle.setAttribute("aria-expanded", "true");
      backdrop = document.createElement("div");
      backdrop.className = "backdrop";
      backdrop.addEventListener("click", close);
      document.body.appendChild(backdrop);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && sidebar.dataset.open === "true") close();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860 && sidebar.dataset.open === "true") close();
    });
  }

  window.Shell = { render: render };
})();
