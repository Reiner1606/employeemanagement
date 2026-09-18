/*
 * epms.h — shared declarations for the Employee Profile Management System
 * backend. The layers are kept apart on purpose:
 *
 *   http_server.c  transport only (sockets, parsing, writing responses)
 *   router.c       maps method + path to a handler
 *   *_routes.c     request handling, validation, status codes
 *   auth.c         credentials, sessions, permissions
 *   db.c           the only file that knows how records are stored
 *   json.c         JSON reading and writing
 */
#ifndef EPMS_H
#define EPMS_H

#include <stddef.h>
#include <time.h>

#define EPMS_MAX_HEADERS      32
#define EPMS_MAX_BODY         (256 * 1024)
#define EPMS_ID_LEN           32
#define EPMS_FIELD_LEN        192
#define EPMS_TOKEN_LEN        65
#define EPMS_MAX_SESSIONS     256
#define EPMS_MAX_EMPLOYEES    1024
#define EPMS_MAX_USERS        64
#define EPMS_MAX_AUDIT        512

/* ------------------------------------------------------------ configuration */

typedef struct {
    char  server_host[64];      /* SERVER_HOST  — 0.0.0.0 binds every interface,
                                   which is what Tailscale deployments need   */
    int   server_port;          /* SERVER_PORT                                 */
    char  allowed_origin[256];  /* ALLOWED_ORIGIN — CORS for split deployments */
    char  db_host[128];         /* DATABASE_HOST                               */
    int   db_port;              /* DATABASE_PORT                               */
    char  db_name[64];          /* DATABASE_NAME                               */
    char  db_user[64];          /* DATABASE_USER                               */
    char  db_password[128];     /* DATABASE_PASSWORD — env only, never a file  */
    int   session_ttl_minutes;  /* SESSION_TTL_MINUTES                         */
    int   login_max_attempts;   /* LOGIN_MAX_ATTEMPTS                          */
    int   require_secure_cookie;/* COOKIE_SECURE                               */
    int   log_level;            /* LOG_LEVEL 0=error 1=warn 2=info 3=debug     */
} epms_config_t;

extern epms_config_t g_config;

void config_load(epms_config_t *config);

/* ------------------------------------------------------------------ logging */

void log_message(int level, const char *fmt, ...);
#define LOG_ERROR(...) log_message(0, __VA_ARGS__)
#define LOG_WARN(...)  log_message(1, __VA_ARGS__)
#define LOG_INFO(...)  log_message(2, __VA_ARGS__)
#define LOG_DEBUG(...) log_message(3, __VA_ARGS__)

/* --------------------------------------------------------------------- HTTP */

typedef struct {
    char name[64];
    char value[1024];
} http_header_t;

typedef struct {
    char           method[8];
    char           path[256];
    char           query[512];
    http_header_t  headers[EPMS_MAX_HEADERS];
    int            header_count;
    char          *body;
    size_t         body_len;
    char           client_ip[64];
} http_request_t;

typedef struct {
    int    status;
    char   content_type[64];
    char   extra_headers[1024];
    char  *body;          /* heap allocated, freed by the server */
} http_response_t;

const char *http_header(const http_request_t *req, const char *name);
const char *http_query_param(const http_request_t *req, const char *name,
                             char *out, size_t out_len);
void http_set_json(http_response_t *res, int status, char *json_body);
void http_error(http_response_t *res, int status, const char *code, const char *message);
int  http_server_run(const epms_config_t *config);

/* ------------------------------------------------------------------- router */

void router_dispatch(const http_request_t *req, http_response_t *res);
void auth_routes(const http_request_t *req, http_response_t *res, const char *tail);
void employee_routes(const http_request_t *req, http_response_t *res, const char *tail);
void dashboard_routes(const http_request_t *req, http_response_t *res, const char *tail);

/* --------------------------------------------------------------------- JSON */

typedef struct {
    char  *buf;
    size_t len;
    size_t cap;
    int    needs_comma;
} json_writer_t;

void  json_init(json_writer_t *w);
void  json_object_start(json_writer_t *w, const char *key);
void  json_object_end(json_writer_t *w);
void  json_array_start(json_writer_t *w, const char *key);
void  json_array_end(json_writer_t *w);
void  json_string(json_writer_t *w, const char *key, const char *value);
void  json_number(json_writer_t *w, const char *key, long value);
void  json_bool(json_writer_t *w, const char *key, int value);
void  json_null(json_writer_t *w, const char *key);
char *json_finish(json_writer_t *w);          /* caller owns the buffer */

/* Flat-object reader: copies the string (or number) value of `key` into out. */
int json_get_string(const char *json, const char *key, char *out, size_t out_len);
int json_get_bool(const char *json, const char *key, int fallback);

/* ------------------------------------------------------------------ records */

typedef struct {
    char employee_id[EPMS_ID_LEN];
    char first_name[EPMS_FIELD_LEN];
    char middle_name[EPMS_FIELD_LEN];
    char last_name[EPMS_FIELD_LEN];
    char date_of_birth[16];
    char gender[32];
    char email[EPMS_FIELD_LEN];
    char contact_number[64];
    char address[EPMS_FIELD_LEN * 2];
    char position[EPMS_FIELD_LEN];
    char department[EPMS_FIELD_LEN];
    char employment_status[32];
    char date_hired[16];
    char photo_url[EPMS_FIELD_LEN];
    char emergency_contact_name[EPMS_FIELD_LEN];
    char emergency_contact_relationship[64];
    char emergency_contact_number[64];
    time_t created_at;
    time_t updated_at;
    int  active;                 /* 0 marks a soft-deleted row */
} employee_t;

typedef struct {
    char username[EPMS_ID_LEN];
    char display_name[EPMS_FIELD_LEN];
    char employee_id[EPMS_ID_LEN];
    char role[16];               /* "admin" | "employee" */
    char password_hash[160];     /* algo$iterations$salt$digest                */
    char permissions[256];       /* space separated permission list            */
    int  failed_attempts;
    time_t lockout_until;
    int  active;
} app_user_t;

typedef struct {
    char   token[EPMS_TOKEN_LEN];
    char   username[EPMS_ID_LEN];
    char   challenge_id[EPMS_ID_LEN];
    int    two_factor_passed;
    int    two_factor_attempts;
    int    permissions_checked;
    time_t created_at;
    time_t expires_at;
} session_t;

/* ---------------------------------------------------------------- database */

int  db_init(const epms_config_t *config);
void db_shutdown(void);

int  db_employee_count(void);
int  db_employee_list(const char *search, const char *department, const char *status,
                      const char *sort, const char *order,
                      int page, int page_size,
                      employee_t *out, int out_cap, int *total);
employee_t *db_employee_find(const char *employee_id);
int  db_employee_insert(employee_t *record);           /* assigns employee_id */
int  db_employee_update(const char *employee_id, const employee_t *record);
int  db_employee_delete(const char *employee_id);

app_user_t *db_user_find(const char *username);
int  db_user_upsert(const app_user_t *user);

void db_audit_write(const char *actor, const char *action, const char *target);
int  db_audit_list(int limit, char *out, size_t out_len);

/* -------------------------------------------------------------------- auth */

int  auth_hash_password(const char *password, char *out, size_t out_len);
int  auth_verify_password(const char *password, const char *stored_hash);

session_t *auth_session_create(const char *username);
session_t *auth_session_find(const char *token);
void       auth_session_destroy(const char *token);
void       auth_session_sweep(void);

/* Resolves the session from the Authorization header or the session cookie. */
session_t *auth_current_session(const http_request_t *req);
int        auth_has_permission(const app_user_t *user, const char *permission);

/* ------------------------------------------------------------------- utils */

void  str_copy(char *dst, const char *src, size_t dst_len);
void  random_hex(char *out, size_t out_len);
int   sha256_iterated(const char *salt, const char *password, int iterations,
                      char *hex_out, size_t hex_len);
char *str_dup_safe(const char *src);
int   str_ieq(const char *a, const char *b);
void  iso_time(time_t t, char *out, size_t out_len);

#endif /* EPMS_H */
