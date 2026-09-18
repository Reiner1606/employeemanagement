/*
 * auth.c — password verification, session lifetime and permission checks.
 *
 * Passwords are stored as  algorithm$iterations$salt$digest  and never in
 * clear text. Sessions live in memory here; move them to the sessions table in
 * database/schema.sql when more than one API process runs behind a load
 * balancer.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <time.h>

#define HASH_ITERATIONS 120000

static session_t g_sessions[EPMS_MAX_SESSIONS];
static pthread_mutex_t g_session_lock = PTHREAD_MUTEX_INITIALIZER;

/* ------------------------------------------------------------- passwords */

int auth_hash_password(const char *password, char *out, size_t out_len)
{
    char salt[33];
    char digest[65];

    random_hex(salt, sizeof(salt));
    if (sha256_iterated(salt, password, HASH_ITERATIONS, digest, sizeof(digest)) != 0) return -1;
    snprintf(out, out_len, "sha256$%d$%s$%s", HASH_ITERATIONS, salt, digest);
    return 0;
}

/* Constant-time comparison: never leak how much of a digest matched. */
static int secure_equals(const char *a, const char *b)
{
    size_t i, len_a = strlen(a), len_b = strlen(b);
    unsigned char diff = (unsigned char)(len_a ^ len_b);

    for (i = 0; i < len_a && i < len_b; i++)
        diff |= (unsigned char)(a[i] ^ b[i]);
    return diff == 0;
}

int auth_verify_password(const char *password, const char *stored_hash)
{
    char algorithm[16], salt[64], expected[128], computed[65];
    int iterations = 0;

    if (!stored_hash || !*stored_hash || !password || !*password) return 0;

    if (sscanf(stored_hash, "%15[^$]$%d$%63[^$]$%127s",
               algorithm, &iterations, salt, expected) != 4) return 0;
    if (strcmp(algorithm, "sha256") != 0 || iterations <= 0) return 0;
    if (sha256_iterated(salt, password, iterations, computed, sizeof(computed)) != 0) return 0;

    return secure_equals(computed, expected);
}

/* -------------------------------------------------------------- sessions */

session_t *auth_session_create(const char *username)
{
    int i, slot = -1;
    time_t now = time(NULL);

    pthread_mutex_lock(&g_session_lock);
    for (i = 0; i < EPMS_MAX_SESSIONS; i++) {
        if (g_sessions[i].token[0] == '\0') { slot = i; break; }
    }
    if (slot < 0) {
        pthread_mutex_unlock(&g_session_lock);
        LOG_WARN("session table is full");
        return NULL;
    }

    memset(&g_sessions[slot], 0, sizeof(session_t));
    random_hex(g_sessions[slot].token, EPMS_TOKEN_LEN);
    str_copy(g_sessions[slot].username, username, EPMS_ID_LEN);
    random_hex(g_sessions[slot].challenge_id, EPMS_ID_LEN);
    g_sessions[slot].created_at = now;
    g_sessions[slot].expires_at = now + g_config.session_ttl_minutes * 60;
    pthread_mutex_unlock(&g_session_lock);

    return &g_sessions[slot];
}

session_t *auth_session_find(const char *token)
{
    int i;
    time_t now = time(NULL);

    if (!token || !*token) return NULL;
    for (i = 0; i < EPMS_MAX_SESSIONS; i++) {
        if (g_sessions[i].token[0] && strcmp(g_sessions[i].token, token) == 0) {
            if (g_sessions[i].expires_at < now) {
                auth_session_destroy(token);
                return NULL;
            }
            /* Sliding expiry, mirroring SESSION_IDLE_MINUTES in the browser. */
            g_sessions[i].expires_at = now + g_config.session_ttl_minutes * 60;
            return &g_sessions[i];
        }
    }
    return NULL;
}

void auth_session_destroy(const char *token)
{
    int i;
    pthread_mutex_lock(&g_session_lock);
    for (i = 0; i < EPMS_MAX_SESSIONS; i++) {
        if (g_sessions[i].token[0] && strcmp(g_sessions[i].token, token) == 0) {
            memset(&g_sessions[i], 0, sizeof(session_t));
            break;
        }
    }
    pthread_mutex_unlock(&g_session_lock);
}

void auth_session_sweep(void)
{
    time_t now = time(NULL);
    int i;

    pthread_mutex_lock(&g_session_lock);
    for (i = 0; i < EPMS_MAX_SESSIONS; i++) {
        if (g_sessions[i].token[0] && g_sessions[i].expires_at < now)
            memset(&g_sessions[i], 0, sizeof(session_t));
    }
    pthread_mutex_unlock(&g_session_lock);
}

/* --------------------------------------------------- request -> session */

static void cookie_value(const char *cookie_header, const char *name,
                         char *out, size_t out_len)
{
    const char *p = cookie_header;
    size_t name_len = strlen(name);

    out[0] = '\0';
    while (p && *p) {
        while (*p == ' ' || *p == ';') p++;
        if (strncmp(p, name, name_len) == 0 && p[name_len] == '=') {
            const char *value = p + name_len + 1;
            const char *end = strchr(value, ';');
            size_t len = end ? (size_t)(end - value) : strlen(value);
            if (len >= out_len) len = out_len - 1;
            memcpy(out, value, len);
            out[len] = '\0';
            return;
        }
        p = strchr(p, ';');
    }
}

session_t *auth_current_session(const http_request_t *req)
{
    const char *authorization = http_header(req, "Authorization");
    const char *cookie = http_header(req, "Cookie");
    char token[EPMS_TOKEN_LEN];

    if (authorization && strncmp(authorization, "Bearer ", 7) == 0) {
        str_copy(token, authorization + 7, sizeof(token));
        return auth_session_find(token);
    }
    if (cookie) {
        cookie_value(cookie, "epms_session", token, sizeof(token));
        if (token[0]) return auth_session_find(token);
    }
    return NULL;
}

int auth_has_permission(const app_user_t *user, const char *permission)
{
    char haystack[288];
    char needle[64];

    if (!user || !permission) return 0;
    snprintf(haystack, sizeof(haystack), " %s ", user->permissions);
    snprintf(needle, sizeof(needle), " %s ", permission);
    return strstr(haystack, needle) != NULL;
}
