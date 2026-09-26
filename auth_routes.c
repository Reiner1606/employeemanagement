/*
 * auth_routes.c — the login flow:
 *
 *   POST /api/auth/login        credential validation -> session
 *   GET  /api/auth/permissions  administrator authorisation check
 *   GET  /api/auth/me           current account
 *   POST /api/auth/logout       secure logout
 *   POST /api/auth/password-reset
 *   POST /api/auth/accounts     administrator creates a login account directly
 *
 * There is no verification-code step and no self-service invite link. Every
 * account is created by someone with employees:manage, who sets the username
 * and the initial password themselves (see handle_account_create below and
 * README.md → "Creating accounts").
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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

/* Resolves the signed-in account for endpoints that require one, or writes
   the matching error and returns NULL. */
static app_user_t *resolve_user(const http_request_t *req, http_response_t *res)
{
    session_t *session = auth_current_session(req);
    app_user_t *user;

    if (!session) {
        http_error(res, 401, "unauthenticated", "Your session has ended. Sign in again.");
        return NULL;
    }
    user = db_user_find(session->username);
    if (!user) {
        http_error(res, 401, "unauthenticated", "This account is no longer active.");
        return NULL;
    }
    return user;
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
                     : "Sign-in failed. Check your username and password.");
        return;
    }

    user->failed_attempts = 0;
    session = auth_session_create(user->username);
    if (!session) {
        http_error(res, 500, "session_unavailable", "No sessions are available. Try again shortly.");
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

/* ------------------------------------------------------------ permissions */

static void handle_permissions(const http_request_t *req, http_response_t *res)
{
    app_user_t *user = resolve_user(req, res);
    session_t *session;
    json_writer_t w;
    int authorized;

    if (!user) return;
    session = auth_current_session(req);

    authorized = strcmp(user->role, "admin") != 0 ||
                 auth_has_permission(user, "employees:manage");
    if (session) session->permissions_checked = 1;

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
    app_user_t *user = resolve_user(req, res);
    json_writer_t w;

    if (!user) return;

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

    /* Always the same answer, whether or not the account exists. In this
       build the actual reset still has to be done by an administrator
       through POST /auth/accounts (or --hash-password + SQL); this endpoint
       only records that someone asked. */
    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "status", "accepted");
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

/* --------------------------------------------------------------- accounts
 *
 * The administrator creates the login account AND its password in one step.
 * No link, no code, nothing for the employee to do first — the admin hands
 * them the username and password directly (in person, or however the
 * company already shares that kind of thing).
 */

static void handle_account_create(const http_request_t *req, http_response_t *res)
{
    app_user_t *actor = resolve_user(req, res);
    char employee_id[EPMS_ID_LEN] = {0};
    char role[16] = {0};
    char username[EPMS_ID_LEN] = {0};
    char password[128] = {0};
    app_user_t user;
    app_user_t *existing;
    json_writer_t w;

    if (!actor) return;
    if (!auth_has_permission(actor, "employees:manage")) {
        http_error(res, 403, "forbidden", "You do not have permission to create accounts.");
        return;
    }

    json_get_string(req->body, "employee_id", employee_id, sizeof(employee_id));
    json_get_string(req->body, "role", role, sizeof(role));
    json_get_string(req->body, "username", username, sizeof(username));
    json_get_string(req->body, "password", password, sizeof(password));

    if (!username[0] || !password[0]) {
        http_error(res, 400, "missing_fields", "Choose a username and a password.");
        return;
    }
    if (strcmp(role, "admin") != 0 && strcmp(role, "employee") != 0) {
        http_error(res, 400, "invalid_role", "Role must be admin or employee.");
        return;
    }
    if (strlen(password) < 8) {
        http_error(res, 400, "weak_password", "Use at least 8 characters.");
        return;
    }
    if (employee_id[0] && !db_employee_find(employee_id)) {
        http_error(res, 404, "not_found", "That employee record does not exist.");
        return;
    }

    existing = db_user_find(username);
    if (existing) {
        http_error(res, 409, "username_taken",
                   "That username is already in use. Choose a different one.");
        return;
    }

    memset(&user, 0, sizeof(user));
    str_copy(user.username, username, sizeof(user.username));
    str_copy(user.employee_id, employee_id, sizeof(user.employee_id));
    str_copy(user.role, role, sizeof(user.role));
    str_copy(user.display_name, employee_id[0] ? employee_id : username, sizeof(user.display_name));
    user.active = 1;

    if (strcmp(role, "admin") == 0) {
        str_copy(user.permissions, "employees:read", sizeof(user.permissions));
    } else {
        str_copy(user.permissions, "self:read self:update", sizeof(user.permissions));
    }

    if (auth_hash_password(password, user.password_hash, sizeof(user.password_hash)) != 0) {
        http_error(res, 500, "hash_error", "The password could not be saved.");
        return;
    }
    if (db_user_upsert(&user) != 0) {
        http_error(res, 500, "storage_error", "The account could not be created.");
        return;
    }
    db_audit_write(actor->username, "account.created", username);

    json_init(&w);
    json_object_start(&w, NULL);
    json_string(&w, "username", username);
    json_string(&w, "role", role);
    json_object_end(&w);
    http_set_json(res, 201, json_finish(&w));
}

/* ----------------------------------------------------------------- router */

void auth_routes(const http_request_t *req, http_response_t *res, const char *tail)
{
    int is_post = strcmp(req->method, "POST") == 0;
    int is_get  = strcmp(req->method, "GET") == 0;

    if (is_post && strcmp(tail, "/login") == 0)           { handle_login(req, res); return; }
    if (is_get  && strcmp(tail, "/permissions") == 0)     { handle_permissions(req, res); return; }
    if (is_get  && strcmp(tail, "/me") == 0)              { handle_me(req, res); return; }
    if (is_post && strcmp(tail, "/logout") == 0)          { handle_logout(req, res); return; }
    if (is_post && strcmp(tail, "/password-reset") == 0)  { handle_password_reset(req, res); return; }
    if (is_post && strcmp(tail, "/accounts") == 0)        { handle_account_create(req, res); return; }

    http_error(res, 405, "method_not_allowed", "That method is not supported on this endpoint.");
}
