/*
 * Optional deployment override. Copy to frontend/env.js, edit, and add
 *   <script src="../js/../env.js"></script>
 * before config.js — or have the web server generate it from the environment
 * at start-up. Without this file the frontend derives the API address from the
 * hostname in the address bar, which already covers localhost, Tailscale and
 * reverse-proxy deployments.
 *
 * This file must never contain credentials. It only says where the API lives.
 */
window.__ENV__ = {
  API_BASE_URL: "https://hr.example.com/api",
  USE_MOCK_API: false,
  APP_NAME: "Northline HR",
  SESSION_IDLE_MINUTES: 30
};
