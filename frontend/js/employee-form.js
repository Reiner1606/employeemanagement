/**
 * Add and edit employee. Both pages share one field schema, so a change to the
 * employee record shape only has to be made once.
 *
 * Employees editing their own record may only change contact and emergency
 * details; everything else is read-only for them. The backend enforces the
 * same rule — the disabled attributes here are a convenience, not a control.
 */
(function () {
  "use strict";

  var page = document.body.dataset.page;
  var isEdit = page === "edit-employee";

  var user = window.Auth.requireSession();
  if (!user) return;
  window.Shell.render(user);

  var canManage = window.Auth.can("employees:manage");
  if (!isEdit && !canManage) {
    window.location.replace("access-denied.html");
    return;
  }

  var SELF_EDITABLE = [
    "contact_number", "email", "address",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_number"
  ];

  var SCHEMA = [
    { title: "Personal information", fields: [
      { name: "first_name", label: "First name", required: true },
      { name: "middle_name", label: "Middle name", placeholder: "Optional" },
      { name: "last_name", label: "Last name", required: true },
      { name: "date_of_birth", label: "Date of birth", type: "date", required: true },
      { name: "gender", label: "Gender", type: "select", required: true,
        options: ["Female", "Male", "Non-binary", "Prefer not to say"] }
    ]},
    { title: "Contact information", fields: [
      { name: "email", label: "Work email", type: "email", required: true, placeholder: "name@northline.example" },
      { name: "contact_number", label: "Contact number", required: true, placeholder: "+63 917 000 0000",
        pattern: "^[0-9 +().-]{7,20}$", patternMessage: "Use digits, spaces and + ( ) - only." },
      { name: "address", label: "Home address", type: "textarea", required: true, full: true }
    ]},
    { title: "Employment information", fields: [
      { name: "position", label: "Position", required: true },
      { name: "department", label: "Department", type: "select", required: true, options: [] },
      { name: "employment_status", label: "Employment status", type: "select", required: true,
        options: ["Active", "On Leave", "Inactive"] },
      { name: "date_hired", label: "Date hired", type: "date", required: true }
    ]},
    { title: "Emergency contact", anchor: "emergency", fields: [
      { name: "emergency_contact_name", label: "Contact name", required: true },
      { name: "emergency_contact_relationship", label: "Relationship", required: true },
      { name: "emergency_contact_number", label: "Contact number", required: true,
        pattern: "^[0-9 +().-]{7,20}$", patternMessage: "Use digits, spaces and + ( ) - only." }
    ]}
  ];

  var form = document.getElementById("employee-form");
  var fieldsRoot = document.getElementById("form-fields");
  var alertBox = document.getElementById("form-alert");
  var employeeId = window.UI.queryParam("id") || (isEdit ? user.employee_id : null);
  var isSelf = isEdit && employeeId === user.employee_id;
  var editableOnly = isEdit && !canManage;

  function fieldHtml(field) {
    var disabled = editableOnly && SELF_EDITABLE.indexOf(field.name) === -1;
    var attrs =
      ' id="' + field.name + '" name="' + field.name + '" class="' +
      (field.type === "select" ? "select" : field.type === "textarea" ? "textarea" : "input") + '"' +
      ' data-label="' + field.label + '"' +
      (field.required && !disabled ? " required" : "") +
      (disabled ? " disabled" : "") +
      (field.placeholder ? ' placeholder="' + field.placeholder + '"' : "") +
      (field.pattern ? ' data-pattern="' + field.pattern + '"' : "") +
      (field.patternMessage ? ' data-pattern-message="' + field.patternMessage + '"' : "");

    var control;
    if (field.type === "select") {
      control = "<select" + attrs + '><option value="">Select ' + field.label.toLowerCase() + "</option>" +
        (field.options || []).map(function (o) { return "<option>" + window.UI.escapeHtml(o) + "</option>"; }).join("") +
        "</select>";
    } else if (field.type === "textarea") {
      control = "<textarea" + attrs + " rows=\"3\"></textarea>";
    } else {
      control = '<input type="' + (field.type || "text") + '"' + attrs + ">";
    }

    return (
      '<div class="field"' + (field.full ? ' style="grid-column:1/-1"' : "") + ">" +
        '<label for="' + field.name + '">' + window.UI.escapeHtml(field.label) +
          (field.required ? ' <span class="req">*</span>' : "") + "</label>" +
        control +
        '<span class="field__error"></span>' +
      "</div>"
    );
  }

  function renderForm(departments) {
    SCHEMA.forEach(function (group) {
      group.fields.forEach(function (field) {
        if (field.name === "department") field.options = departments;
      });
    });

    var html = SCHEMA.map(function (group) {
      return (
        '<div class="form-section"' + (group.anchor ? ' id="' + group.anchor + '"' : "") + ">" +
          '<div class="section-title"><h2>' + window.UI.escapeHtml(group.title) + "</h2></div>" +
          '<div class="form-grid">' + group.fields.map(fieldHtml).join("") + "</div>" +
        "</div>"
      );
    }).join("");

    if (editableOnly) {
      html =
        '<div class="alert alert--info">You can update your contact details and emergency contact. ' +
        "Position, department and status are maintained by Human Resources.</div>" + html;
    }

    html +=
      '<div class="form-actions">' +
        '<button type="submit" class="btn btn--primary" id="save">' +
          '<span class="btn__label">' + (isEdit ? "Save changes" : "Create employee") + "</span></button>" +
        '<button type="button" class="btn" id="cancel"><span class="btn__label">Cancel</span></button>' +
      "</div>";

    fieldsRoot.innerHTML = html;
    window.UI.attachLiveValidation(form);

    document.getElementById("cancel").addEventListener("click", function () {
      window.location.href = canManage
        ? (isEdit ? "employee-profile.html?id=" + encodeURIComponent(employeeId) : "employees.html")
        : "dashboard.html";
    });
  }

  function fill(record) {
    Object.keys(record).forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]');
      if (input) input.value = record[key] || "";
    });
  }

  async function loadDepartments() {
    try {
      var response = await window.Api.listDepartments();
      return response.data.map(function (d) { return d.name; });
    } catch (error) {
      return ["Engineering", "Human Resources", "Finance", "Operations", "Sales"];
    }
  }

  async function init() {
    var departments = await loadDepartments();
    renderForm(departments);

    if (isEdit) {
      try {
        var response = await window.Api.getEmployee(employeeId);
        fill(response.data);
        var name = [response.data.first_name, response.data.last_name].filter(Boolean).join(" ");
        var title = document.getElementById("page-title");
        var sub = document.getElementById("page-sub");
        var back = document.getElementById("back-link");
        if (title) title.textContent = isSelf && !canManage ? "Update my details" : "Edit employee";
        if (sub) sub.textContent = name + " \u00B7 " + response.data.employee_id;
        if (back) back.href = "employee-profile.html?id=" + encodeURIComponent(employeeId);
        document.title = "Edit " + name + " — Northline HR";
      } catch (error) {
        fieldsRoot.innerHTML =
          '<div class="state"><h3>This record could not be opened</h3><p>' +
          window.UI.escapeHtml(error.message) + "</p></div>";
        window.Auth.handleApiError(error);
        return;
      }
    }

    form.addEventListener("submit", onSubmit);
    if (window.location.hash === "#emergency") {
      var target = document.getElementById("emergency");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    window.UI.hideAlert(alertBox);
    if (!window.UI.validateForm(form)) {
      window.UI.showAlert(alertBox, "Some fields need attention before this can be saved.", "error");
      return;
    }

    var save = document.getElementById("save");
    var payload = window.UI.serializeForm(form);
    window.UI.setLoading(save, true, "Saving");

    try {
      if (isEdit) {
        await window.Api.updateEmployee(employeeId, payload);
        window.UI.toast("Profile updated.", "success");
        setTimeout(function () {
          window.location.href = "employee-profile.html?id=" + encodeURIComponent(employeeId);
        }, 500);
      } else {
        var created = await window.Api.createEmployee(payload);
        window.UI.toast("Employee created.", "success");
        setTimeout(function () {
          window.location.href = "employee-profile.html?id=" + encodeURIComponent(created.data.employee_id);
        }, 500);
      }
    } catch (error) {
      window.UI.setLoading(save, false);
      if (error.status === 400 && error.details) {
        window.UI.applyServerErrors(form, error.details);
        window.UI.showAlert(alertBox, "Some fields need attention before this can be saved.", "error");
      } else {
        window.UI.showAlert(alertBox, error.message, "error");
        window.Auth.handleApiError(error);
      }
    }
  }

  init();
})();
