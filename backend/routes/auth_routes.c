/*
 * auth_routes.c — the login flow from the system flowchart:
 *
 *   POST /api/auth/login        credential validation  -> 2FA challenge
 *   POST /api/auth/2fa/verify   code check             -> session
 *   POST /api/auth/2fa/resend   new code
 *   GET  /api/auth/permissions  administrator authorisation check
 *   GET  /api/auth/me           current account
 *   POST /api/auth/logout       secure logout
 *   POST /api/auth/password-reset
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#define LOCKOUT_SECONDS 300

static void write_user(json_writer_t *w, const app_user_t *user)
{
    json_object_start(w, "user");
    json_string(w, "username", user->username);
    json_string(w, "role", user->role);
    json_string(w, "display_name", user->display_name);
    json_string(w, "employee_id", user->employee_id);
    json_array_start(w, "permissions");
    {
        char copy[256], *token, *saveptr = NULL;
        str_copy(copy, user->permissions, sizeof(copy));
        token = strtok_r(copy, " ", &saveptr);
        while (token) {
            json_string(w, NULL, token);
            token = strtok_r(NULL, " ", &saveptr);
        }
    }
    json_array_end(w);
    json_object_end(w);
}

static void set_session_cookie(http_response_t *res, const char *token)
{
    snprintf(res->extra_headers, sizeof(res->extra_headers),
             "Set-Cookie: epms_session=%s; Path=/; HttpOnly; SameSite=Lax%s; Max-Age=%d\r\n",
             token,
             g_config.require_secure_cookie ? "; Secure" : "",
             g_config.session_ttl_minutes * 60);
}

static void clear_session_cookie(http_response_t *res)
{
    snprintf(res->extra_headers, sizeof(res->extra_headers),
             "Set-Cookie: epms_session=; Path=/; HttpOnly; SameSite=Lax%s; Max-Age=0\r\n",
             g_config.require_secure_cookie ? "; Secure" : "");
}

/* ------------------------------------------------------------------ login */

static void handle_login(const http_request_t *req, http_response_t *res)
{
    char identifier[EPMS_ID_LEN] = {0};
    char password[128] = {0};
    char role[16] = {0};
    app_user_t *user;
    session_t *session;
    json_writer_t w;
    time_t now = time(NULL);

    json_get_string(req->body, "identifier", identifier, sizeof(identifier));
    json_get_string(req->body, "password", password, sizeof(password));
    json_get_string(req->body, "role", role, sizeof(role));

    if (!identifier[0] || !password[0]) {
        http_error(res, 400, "missing_fields", "Enter both an account and a password.");
        return;
    }

    user = db_user_find(identifier);

    if (user && user->lockout_until > now) {
        db_audit_write(identifier, "auth.locked_out", identifier);
        http_error(res, 429, "rate_limited",
                   "Too many failed attempts. Try again in a few minutes.");
        return;
    }

    /* One message for every failure so the endpoint cannot be used to find out
       which accounts exist. */
    if (!user || (role[0] && strcmp(user->role, role) != 0) ||
        !auth_verify_password(password, user->password_hash)) {
        if (user) {
            user->failed_attempts++;
            if (user->failed_attempts >= g_config.login_max_attempts) {
                user->lockout_until = now + LOCKOUT_SECONDS;
                user->failed_attempts = 0;
                LOG_WARN("account %s locked for %d seconds", user->username, LOCKOUT_SECONDS);
            }
        }
        db_audit_write(identifier, "auth.failed", identifier);
        http_error(res, 401, "invalid_credentials",
                   strcmp(role, "admin") == 0
                     ? "Administrator sign-in failed. Contact the system administrator if this continues."
                     : "Sign-in failed. Check your employee ID and password.");
        return;
    }

    user->failed_attempts = 0;
    session = auth_session_create(user->username);
    if (!session) {
        http_error(res, 500, "session_unavailable", "No sessions are available. Try again shortly.");
        return;
    }

    /* Issue the one-time code here (TOTP verification, SMS or push). The
       challenge id is a pre-authentication token: it grants no access until
       the code is verified. */
    LOG_INFO("2FA challenge issued for %s", user->username);
    db_audit_write(user->username, "auth.2fa_issued", user->username);

    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "2fa_required");
    json_string(&w, "challenge_id", session->token);
    json_string(&w, "delivery", "Authenticator app");
    json_number(&w, "expires_in", 300);
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

/* -------------------------------------------------------------------- 2FA */

static int code_is_valid(const char *code)
{
    int i;
    /*
     * DEVELOPMENT RULE: any 6-digit code except 000000 is accepted, which
     * exercises both branches of the flowchart. Replace this with a real TOTP
     * check (RFC 6238) against the secret stored for the account.
     */
    if (strlen(code) != 6) return 0;
    for (i = 0; i < 6; i++) if (!isdigit((unsigned char)code[i])) return 0;
    return strcmp(code, "000000") != 0;
}

static void handle_2fa_verify(const http_request_t *req, http_response_t *res)
{
    char challenge[EPMS_TOKEN_LEN] = {0};
    char code[16] = {0};
    session_t *session;
    app_user_t *user;
    json_writer_t w;

    json_get_string(req->body, "challenge_id", challenge, sizeof(challenge));
    json_get_string(req->body, "code", code, sizeof(code));

    session = auth_session_find(challenge);
    if (!session) {
        http_error(res, 401, "challenge_not_found", "This verification step has expired. Sign in again.");
        return;
    }

    if (!code_is_valid(code)) {
        session->two_factor_attempts++;
        if (session->two_factor_attempts >= 3) {
            db_audit_write(session->username, "auth.2fa_locked", session->username);
            auth_session_destroy(challenge);
            http_error(res, 401, "challenge_locked", "Too many incorrect codes. Sign in again.");
            return;
        }
        http_error(res, 401, "invalid_code", "That code is not correct.");
        return;
    }

    session->two_factor_passed = 1;
    user = db_user_find(session->username);
    if (!user) {
        auth_session_destroy(challenge);
        http_error(res, 401, "unauthenticated", "This account is no longer active.");
        return;
    }

    db_audit_write(user->username, "auth.login", user->username);
    set_session_cookie(res, session->token);

    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "authenticated");
    json_string(&w, "token", session->token);
    write_user(&w, user);
    json_string(&w, "next", strcmp(user->role, "admin") == 0 ? "validate_permissions" : "dashboard");
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_2fa_resend(const http_request_t *req, http_response_t *res)
{
    char challenge[EPMS_TOKEN_LEN] = {0};
    session_t *session;
    json_writer_t w;

    json_get_string(req->body, "challenge_id", challenge, sizeof(challenge));
    session = auth_session_find(challenge);
    if (!session) {
        http_error(res, 401, "challenge_not_found", "Sign in again to get a new code.");
        return;
    }
    LOG_INFO("2FA challenge re-issued for %s", session->username);

    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "sent");
    json_number(&w, "expires_in", 300);
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

/* ------------------------------------------------------------ permissions */

static void handle_permissions(const http_request_t *req, http_response_t *res)
{
    session_t *session = auth_current_session(req);
    app_user_t *user;
    json_writer_t w;
    int authorized;

    if (!session || !session->two_factor_passed) {
        http_error(res, 401, "unauthenticated", "Your session has ended. Sign in again.");
        return;
    }
    user = db_user_find(session->username);
    if (!user) {
        http_error(res, 401, "unauthenticated", "This account is no longer active.");
        return;
    }

    authorized = strcmp(user->role, "admin") != 0 ||
                 auth_has_permission(user, "employees:manage");
    session->permissions_checked = 1;

    if (!authorized)
        db_audit_write(user->username, "authz.denied", user->username);

    json_init(&w);
    json_object_start(&w, NULL);
    json_bool(&w, "authorized", authorized);
    json_string(&w, "role", user->role);
    json_array_start(&w, "permissions");
    {
        char copy[256], *token, *saveptr = NULL;
        str_copy(copy, user->permissions, sizeof(copy));
        token = strtok_r(copy, " ", &saveptr);
        while (token) { json_string(&w, NULL, token); token = strtok_r(NULL, " ", &saveptr); }
    }
    json_array_end(&w);
    if (authorized) json_null(&w, "reason");
    else json_string(&w, "reason", "This account does not have the employee management role assigned.");
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

/* ------------------------------------------------------------ me / logout */

static void handle_me(const http_request_t *req, http_response_t *res)
{
    session_t *session = auth_current_session(req);
    app_user_t *user;
    json_writer_t w;

    if (!session || !session->two_factor_passed) {
        http_error(res, 401, "unauthenticated", "Your session has ended. Sign in again.");
        return;
    }
    user = db_user_find(session->username);
    if (!user) {
        http_error(res, 401, "unauthenticated", "This account is no longer active.");
        return;
    }

    json_init(&w);
    json_object_start(&w, NULL);
    write_user(&w, user);
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_logout(const http_request_t *req, http_response_t *res)
{
    session_t *session = auth_current_session(req);
    json_writer_t w;

    if (session) {
        db_audit_write(session->username, "auth.logout", session->username);
        auth_session_destroy(session->token);
    }
    clear_session_cookie(res);

    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "signed_out");
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_password_reset(const http_request_t *req, http_response_t *res)
{
    char identifier[EPMS_ID_LEN] = {0};
    json_writer_t w;

    json_get_string(req->body, "identifier", identifier, sizeof(identifier));
    LOG_INFO("password reset requested for %s", identifier[0] ? identifier : "(blank)");
    db_audit_write(identifier, "auth.reset_requested", identifier);

    /* Always the same answer, whether or not the account exists. */
    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "accepted");
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

/* ----------------------------------------------------------------- router */

void auth_routes(const http_request_t *req, http_response_t *res, const char *tail)
{
    int is_post = strcmp(req->method, "POST") == 0;
    int is_get  = strcmp(req->method, "GET") == 0;

    if (is_post && strcmp(tail, "/login") == 0)           { handle_login(req, res); return; }
    if (is_post && strcmp(tail, "/2fa/verify") == 0)      { handle_2fa_verify(req, res); return; }
    if (is_post && strcmp(tail, "/2fa/resend") == 0)      { handle_2fa_resend(req, res); return; }
    if (is_get  && strcmp(tail, "/permissions") == 0)     { handle_permissions(req, res); return; }
    if (is_get  && strcmp(tail, "/me") == 0)              { handle_me(req, res); return; }
    if (is_post && strcmp(tail, "/logout") == 0)          { handle_logout(req, res); return; }
    if (is_post && strcmp(tail, "/password-reset") == 0)  { handle_password_reset(req, res); return; }

    http_error(res, 405, "method_not_allowed", "That method is not supported on this endpoint.");
}
