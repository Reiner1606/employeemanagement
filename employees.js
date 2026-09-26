/**
 * Employee directory: search, filtering, sorting, pagination and deletion.
 */
(function () {
  "use strict";

  var user = window.Auth.requireSession({ role: "admin", permission: "employees:read" });
  if (!user) return;
  window.Shell.render(user);

  var canManage = window.Auth.can("employees:manage");
  var rows = document.getElementById("employee-rows");
  var pageInfo = document.getElementById("page-info");
  var summary = document.getElementById("result-summary");
  var form = document.getElementById("filter-form");
  var prev = document.getElementById("prev-page");
  var next = document.getElementById("next-page");

  var state = {
    q: window.UI.queryParam("q") || "",
    department: window.UI.queryParam("department") || "",
    status: window.UI.queryParam("status") || "",
    sort: "last_name",
    order: "asc",
    page: 1,
    page_size: window.APP_CONFIG.PAGE_SIZE
  };

  document.getElementById("search").value = state.q;
  document.getElementById("status").value = state.status;
  document.getElementById("page-size").value = String(state.page_size);

  /* ------------------------------------------------------------ Rendering */

  function rowHtml(e) {
    var name = [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ");
    var profileUrl = "employee-profile.html?id=" + encodeURIComponent(e.employee_id);
    return (
      "<tr>" +
        "<td>" +
          '<div class="person">' +
            '<span class="avatar" aria-hidden="true">' + window.UI.initials(name) + "</span>" +
            "<span>" +
              '<a class="person__name" href="' + profileUrl + '">' + window.UI.escapeHtml(name) + "</a><br>" +
              '<span class="person__id">' + window.UI.escapeHtml(e.employee_id) + " \u00B7 " +
                window.UI.escapeHtml(e.email) + "</span>" +
            "</span>" +
          "</div>" +
        "</td>" +
        "<td>" + window.UI.escapeHtml(e.position) + "</td>" +
        "<td>" + window.UI.escapeHtml(e.department) + "</td>" +
        "<td>" + window.UI.statusBadge(e.employment_status) + "</td>" +
        "<td>" + window.UI.formatDate(e.date_hired) + "</td>" +
        '<td><div class="row-actions">' +
          '<a class="btn btn--sm" href="' + profileUrl + '"><span class="btn__label">View</span></a>' +
          (canManage
            ? '<a class="btn btn--sm" href="edit-employee.html?id=' + encodeURIComponent(e.employee_id) + '"><span class="btn__label">Edit</span></a>' +
              '<button type="button" class="btn btn--sm btn--danger" data-delete="' + window.UI.escapeHtml(e.employee_id) +
                '" data-name="' + window.UI.escapeHtml(name) + '"><span class="btn__label">Delete</span></button>'
            : "") +
        "</div></td>" +
      "</tr>"
    );
  }

  function showMessage(html) {
    rows.innerHTML = '<tr><td colspan="6">' + html + "</td></tr>";
  }

  async function load() {
    showMessage('<div class="state"><span class="spinner"></span>Loading employees</div>');
    prev.disabled = true;
    next.disabled = true;

    try {
      var response = await window.Api.listEmployees(state);
      var list = response.data;
      var meta = response.meta;

      if (!list.length) {
        var filtered = state.q || state.department || state.status;
        showMessage(
          '<div class="state">' +
            "<h3>" + (filtered ? "No employees match those filters" : "The directory is empty") + "</h3>" +
            "<p>" + (filtered
              ? "Try a different search term, or clear the filters to see everyone."
              : "Add the first employee record to get started.") + "</p>" +
            (filtered
              ? '<button type="button" class="btn btn--sm" id="empty-clear"><span class="btn__label">Clear filters</span></button>'
              : '<a class="btn btn--sm btn--primary" href="add-employee.html"><span class="btn__label">Add employee</span></a>') +
          "</div>"
        );
        var clear = document.getElementById("empty-clear");
        if (clear) clear.addEventListener("click", resetFilters);
      } else {
        rows.innerHTML = list.map(rowHtml).join("");
      }

      var from = meta.total ? (meta.page - 1) * meta.page_size + 1 : 0;
      var to = Math.min(meta.page * meta.page_size, meta.total);
      pageInfo.textContent = meta.total
        ? "Showing " + from + "-" + to + " of " + meta.total + " employees"
        : "No results";
      summary.textContent = meta.total + (meta.total === 1 ? " record" : " records") +
        " \u00B7 page " + meta.page + " of " + meta.total_pages;

      prev.disabled = meta.page <= 1;
      next.disabled = meta.page >= meta.total_pages;
    } catch (error) {
      showMessage('<div class="alert alert--error">' + window.UI.escapeHtml(error.message) + "</div>");
      summary.textContent = "Could not load records";
      window.Auth.handleApiError(error, "The directory could not be loaded.");
    }
  }

  async function loadDepartments() {
    try {
      var response = await window.Api.listDepartments();
      var select = document.getElementById("department");
      response.data.forEach(function (d) {
        var option = document.createElement("option");
        option.value = d.name;
        option.textContent = d.name + " (" + d.employee_count + ")";
        select.appendChild(option);
      });
      select.value = state.department;
    } catch (error) {
      /* Filtering still works without the list. */
    }
  }

  /* -------------------------------------------------------------- Events */

  var runSearch = window.UI.debounce(function () {
    state.q = document.getElementById("search").value.trim();
    state.page = 1;
    load();
  }, 300);

  document.getElementById("search").addEventListener("input", runSearch);
  form.addEventListener("submit", function (event) { event.preventDefault(); runSearch(); });

  document.getElementById("department").addEventListener("change", function (event) {
    state.department = event.target.value;
    state.page = 1;
    load();
  });
  document.getElementById("status").addEventListener("change", function (event) {
    state.status = event.target.value;
    state.page = 1;
    load();
  });
  document.getElementById("page-size").addEventListener("change", function (event) {
    state.page_size = parseInt(event.target.value, 10);
    state.page = 1;
    load();
  });

  function resetFilters() {
    state.q = state.department = state.status = "";
    state.page = 1;
    form.reset();
    document.getElementById("page-size").value = String(state.page_size);
    load();
  }
  document.getElementById("clear-filters").addEventListener("click", resetFilters);

  document.querySelectorAll(".sortable").forEach(function (th) {
    th.setAttribute("tabindex", "0");
    function toggle() {
      var key = th.dataset.sort;
      state.order = state.sort === key && state.order === "asc" ? "desc" : "asc";
      state.sort = key;
      state.page = 1;
      document.querySelectorAll(".sortable").forEach(function (other) { delete other.dataset.dir; });
      th.dataset.dir = state.order;
      load();
    }
    th.addEventListener("click", toggle);
    th.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });
  });

  prev.addEventListener("click", function () { if (state.page > 1) { state.page -= 1; load(); } });
  next.addEventListener("click", function () { state.page += 1; load(); });

  rows.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-delete]");
    if (!button) return;
    var id = button.dataset.delete;
    var confirmed = await window.UI.confirmDialog({
      title: "Delete " + button.dataset.name + "?",
      message: "The record and its history are removed from the directory. This cannot be undone.",
      confirmLabel: "Delete record",
      danger: true
    });
    if (!confirmed) return;

    window.UI.setLoading(button, true, "Deleting");
    try {
      await window.Api.deleteEmployee(id);
      window.UI.toast("Employee record deleted.", "success");
      load();
    } catch (error) {
      window.UI.setLoading(button, false);
      window.Auth.handleApiError(error, "The record could not be deleted.");
    }
  });

  loadDepartments();
  load();
})();
