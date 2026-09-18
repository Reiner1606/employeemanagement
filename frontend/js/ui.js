/**
 * Shared UI helpers used by every page: notifications, confirmation dialogs,
 * button loading states, form validation display and value formatting.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------ Formatting */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "--";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function formatDate(value) {
    if (!value) return "--";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatRelative(value) {
    if (!value) return "--";
    var diff = Date.now() - new Date(value).getTime();
    var minutes = Math.round(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + " min ago";
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    if (days < 30) return days + (days === 1 ? " day ago" : " days ago");
    return formatDate(value);
  }

  function statusBadge(status) {
    var cls = status === "Active" ? "badge--active"
      : status === "On Leave" ? "badge--leave"
      : "badge--inactive";
    return '<span class="badge ' + cls + '">' + escapeHtml(status || "Unknown") + "</span>";
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, context = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, wait || 250);
    };
  }

  /* ---------------------------------------------------------------- Toasts */

  function toastStack() {
    var stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("role", "status");
      stack.setAttribute("aria-live", "polite");
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type) {
    var el = document.createElement("div");
    el.className = "toast toast--" + (type || "info");
    el.textContent = message;
    toastStack().appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .2s ease";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 220);
    }, 3800);
  }

  /* ----------------------------------------------------------- Inline alert */

  function showAlert(container, message, type) {
    if (!container) return;
    container.className = "alert alert--" + (type || "error");
    container.textContent = message;
    container.classList.remove("hidden");
  }

  function hideAlert(container) {
    if (container) container.classList.add("hidden");
  }

  /* -------------------------------------------------------- Button loading */

  function setLoading(button, isLoading, loadingLabel) {
    if (!button) return;
    if (isLoading) {
      if (!button.dataset.originalLabel) {
        var label = button.querySelector(".btn__label");
        button.dataset.originalLabel = label ? label.textContent : button.textContent;
      }
      button.dataset.loading = "true";
      button.disabled = true;
      button.innerHTML =
        '<span class="spinner" aria-hidden="true"></span><span class="btn__label">' +
        escapeHtml(loadingLabel || button.dataset.originalLabel) + "</span>";
    } else {
      button.dataset.loading = "false";
      button.disabled = false;
      button.innerHTML = '<span class="btn__label">' + escapeHtml(button.dataset.originalLabel || "") + "</span>";
    }
  }

  /* ----------------------------------------------------------- Confirmation */

  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">' +
          '<h3 id="confirm-title">' + escapeHtml(options.title || "Are you sure?") + "</h3>" +
          '<p class="muted">' + escapeHtml(options.message || "") + "</p>" +
          '<div class="modal__actions">' +
            '<button type="button" class="btn" data-action="cancel">' + escapeHtml(options.cancelLabel || "Cancel") + "</button>" +
            '<button type="button" class="btn ' + (options.danger ? "btn--danger" : "btn--primary") + '" data-action="confirm">' +
              escapeHtml(options.confirmLabel || "Confirm") + "</button>" +
          "</div>" +
        "</div>";

      function close(result) {
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        resolve(result);
      }
      function onKey(event) {
        if (event.key === "Escape") close(false);
      }

      backdrop.addEventListener("click", function (event) {
        var action = event.target.getAttribute("data-action");
        if (action === "cancel" || event.target === backdrop) close(false);
        if (action === "confirm") close(true);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-action="confirm"]').focus();
    });
  }

  /* ------------------------------------------------------- Form validation */

  function fieldWrapper(input) {
    return input.closest(".field") || input.parentElement;
  }

  function setFieldError(input, message) {
    if (!input) return;
    var wrapper = fieldWrapper(input);
    if (!wrapper) return;
    wrapper.classList.add("field--invalid");
    input.setAttribute("aria-invalid", "true");
    var error = wrapper.querySelector(".field__error");
    if (error) error.textContent = message;
  }

  function clearFieldError(input) {
    if (!input) return;
    var wrapper = fieldWrapper(input);
    if (!wrapper) return;
    wrapper.classList.remove("field--invalid");
    input.removeAttribute("aria-invalid");
  }

  function clearFormErrors(form) {
    form.querySelectorAll(".field--invalid").forEach(function (w) { w.classList.remove("field--invalid"); });
    form.querySelectorAll("[aria-invalid]").forEach(function (i) { i.removeAttribute("aria-invalid"); });
  }

  function applyServerErrors(form, details) {
    if (!details) return;
    var first = null;
    Object.keys(details).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input) {
        setFieldError(input, details[name]);
        if (!first) first = input;
      }
    });
    if (first) first.focus();
  }

  /**
   * Client-side validation driven by data attributes on each input:
   *   required, type="email", data-pattern, data-pattern-message, minlength
   */
  function validateForm(form) {
    clearFormErrors(form);
    var valid = true;
    var firstInvalid = null;

    form.querySelectorAll("input, select, textarea").forEach(function (input) {
      if (input.disabled || input.type === "hidden") return;
      var value = String(input.value || "").trim();
      var label = input.dataset.label || (input.labels && input.labels[0] ? input.labels[0].textContent.replace("*", "").trim() : "This field");
      var message = null;

      if (input.hasAttribute("required") && !value) {
        message = label + " is required.";
      } else if (value && input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        message = "Enter a valid email address.";
      } else if (value && input.minLength > 0 && value.length < input.minLength) {
        message = label + " must be at least " + input.minLength + " characters.";
      } else if (value && input.dataset.pattern && !new RegExp(input.dataset.pattern).test(value)) {
        message = input.dataset.patternMessage || (label + " is not in the expected format.");
      }

      if (message) {
        valid = false;
        setFieldError(input, message);
        if (!firstInvalid) firstInvalid = input;
      }
    });

    if (firstInvalid) firstInvalid.focus();
    return valid;
  }

  function serializeForm(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = typeof value === "string" ? value.trim() : value;
    });
    return data;
  }

  /* ------------------------------------------------------- Live validation */

  function attachLiveValidation(form) {
    form.addEventListener("input", function (event) {
      if (event.target.matches("input, select, textarea")) clearFieldError(event.target);
    });
  }

  window.UI = {
    escapeHtml: escapeHtml,
    initials: initials,
    formatDate: formatDate,
    formatRelative: formatRelative,
    statusBadge: statusBadge,
    queryParam: queryParam,
    debounce: debounce,
    toast: toast,
    showAlert: showAlert,
    hideAlert: hideAlert,
    setLoading: setLoading,
    confirmDialog: confirmDialog,
    setFieldError: setFieldError,
    clearFieldError: clearFieldError,
    clearFormErrors: clearFormErrors,
    applyServerErrors: applyServerErrors,
    validateForm: validateForm,
    serializeForm: serializeForm,
    attachLiveValidation: attachLiveValidation
  };
})();
