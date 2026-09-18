/*
 * db.c — the only file that knows how records are stored.
 *
 * The shipped adapter keeps everything in memory so the API runs with no
 * database installed. To move to PostgreSQL, implement the same functions with
 * libpq and parameterised statements ($1, $2 ...), which is also what keeps SQL
 * injection out of the system. Nothing above this file changes:
 *
 *   PGconn *conn = PQsetdbLogin(cfg->db_host, port, NULL, NULL,
 *                               cfg->db_name, cfg->db_user, cfg->db_password);
 *   PQexecParams(conn, "SELECT ... FROM employees WHERE employee_id = $1",
 *                1, NULL, values, NULL, NULL, 0);
 *
 * database/schema.sql holds the matching relational schema.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <pthread.h>
#include <time.h>

typedef struct {
    char actor[EPMS_ID_LEN];
    char action[64];
    char target[EPMS_ID_LEN];
    time_t at;
} audit_entry_t;

static employee_t    g_employees[EPMS_MAX_EMPLOYEES];
static int           g_employee_count = 0;
static app_user_t    g_users[EPMS_MAX_USERS];
static int           g_user_count = 0;
static audit_entry_t g_audit[EPMS_MAX_AUDIT];
static int           g_audit_count = 0;
static int           g_next_employee_number = 1001;
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;

/* ------------------------------------------------------------------- seed */

static void seed_employee(const char *first, const char *middle, const char *last,
                          const char *dob, const char *gender, const char *department,
                          const char *position, const char *status, const char *hired,
                          const char *email)
{
    employee_t *e;
    if (g_employee_count >= EPMS_MAX_EMPLOYEES) return;

    e = &g_employees[g_employee_count++];
    memset(e, 0, sizeof(*e));
    snprintf(e->employee_id, sizeof(e->employee_id), "EMP-%d", g_next_employee_number++);
    str_copy(e->first_name, first, sizeof(e->first_name));
    str_copy(e->middle_name, middle, sizeof(e->middle_name));
    str_copy(e->last_name, last, sizeof(e->last_name));
    str_copy(e->date_of_birth, dob, sizeof(e->date_of_birth));
    str_copy(e->gender, gender, sizeof(e->gender));
    str_copy(e->department, department, sizeof(e->department));
    str_copy(e->position, position, sizeof(e->position));
    str_copy(e->employment_status, status, sizeof(e->employment_status));
    str_copy(e->date_hired, hired, sizeof(e->date_hired));
    str_copy(e->email, email, sizeof(e->email));
    str_copy(e->contact_number, "+63 917 000 0000", sizeof(e->contact_number));
    str_copy(e->address, "Quezon City, Metro Manila", sizeof(e->address));
    str_copy(e->emergency_contact_name, "On file with HR", sizeof(e->emergency_contact_name));
    str_copy(e->emergency_contact_relationship, "Family", sizeof(e->emergency_contact_relationship));
    str_copy(e->emergency_contact_number, "+63 918 000 0000", sizeof(e->emergency_contact_number));
    e->created_at = time(NULL) - 86400 * (30 + g_employee_count);
    e->updated_at = time(NULL) - 3600 * g_employee_count;
    e->active = 1;
}

static void seed_user(const char *username, const char *display, const char *employee_id,
                      const char *role, const char *permissions, const char *password)
{
    app_user_t user;
    memset(&user, 0, sizeof(user));
    str_copy(user.username, username, sizeof(user.username));
    str_copy(user.display_name, display, sizeof(user.display_name));
    str_copy(user.employee_id, employee_id, sizeof(user.employee_id));
    str_copy(user.role, role, sizeof(user.role));
    str_copy(user.permissions, permissions, sizeof(user.permissions));
    user.active = 1;

    if (password && *password) {
        auth_hash_password(password, user.password_hash, sizeof(user.password_hash));
    } else {
        /* No usable password: every login attempt for this account fails. */
        user.password_hash[0] = '\0';
    }
    db_user_upsert(&user);
}

/* ---------------------------------------------------------------- lifecycle */

int db_init(const epms_config_t *config)
{
    const char *seed_password = getenv("EPMS_SEED_PASSWORD");

    (void)config;   /* used by the PostgreSQL adapter */

    seed_employee("Alia", "Reyes", "Navarro", "1994-03-11", "Female", "Engineering",
                  "Backend Engineer", "Active", "2021-06-14", "alia.navarro@northline.example");
    seed_employee("Marcus", "T.", "Oyelaran", "1988-11-02", "Male", "Engineering",
                  "Engineering Manager", "Active", "2019-02-04", "marcus.oyelaran@northline.example");
    seed_employee("Marisol", "", "Ferrer", "1985-07-23", "Female", "Human Resources",
                  "HR Director", "Active", "2017-09-18", "marisol.ferrer@northline.example");
    seed_employee("Priya", "K.", "Raman", "1996-01-30", "Female", "Finance",
                  "Financial Analyst", "Active", "2022-03-07", "priya.raman@northline.example");
    seed_employee("Teodoro", "L.", "Vasquez", "1991-05-19", "Male", "Operations",
                  "Logistics Coordinator", "Active", "2020-08-24", "teodoro.vasquez@northline.example");
    seed_employee("Hana", "", "Sugimoto", "1993-09-08", "Female", "Sales",
                  "Account Executive", "On Leave", "2021-01-11", "hana.sugimoto@northline.example");

    if (seed_password && *seed_password) {
        LOG_WARN("EPMS_SEED_PASSWORD is set: seeding sample accounts. Never do this in production.");
        seed_user("ADM-0001", "Marisol Ferrer", "EMP-1003", "admin",
                  "employees:manage employees:read reports:read audit:read", seed_password);
        seed_user("EMP-1001", "Alia Navarro", "EMP-1001", "employee",
                  "self:read self:update", seed_password);
    } else {
        LOG_WARN("no accounts seeded. Set EPMS_SEED_PASSWORD for local development, "
                 "or point db_user_find() at the users table.");
        seed_user("ADM-0001", "Marisol Ferrer", "EMP-1003", "admin",
                  "employees:manage employees:read reports:read audit:read", NULL);
        seed_user("EMP-1001", "Alia Navarro", "EMP-1001", "employee",
                  "self:read self:update", NULL);
    }

    LOG_INFO("data layer ready: %d employees, %d users", g_employee_count, g_user_count);
    return 0;
}

void db_shutdown(void)
{
    /* The PostgreSQL adapter closes its connection pool here. */
    LOG_INFO("data layer closed");
}

/* ----------------------------------------------------------------- queries */

int db_employee_count(void)
{
    return g_employee_count;
}

static int matches(const employee_t *e, const char *search,
                   const char *department, const char *status)
{
    if (!e->active) return 0;

    if (department && *department && strcasecmp(e->department, department) != 0) return 0;
    if (status && *status && strcasecmp(e->employment_status, status) != 0) return 0;

    if (search && *search) {
        const char *fields[] = {
            e->first_name, e->middle_name, e->last_name,
            e->employee_id, e->email, e->position
        };
        int i, hit = 0;
        for (i = 0; i < (int)(sizeof(fields) / sizeof(fields[0])); i++) {
            if (strcasestr(fields[i], search)) { hit = 1; break; }
        }
        if (!hit) return 0;
    }
    return 1;
}

static int field_compare(const employee_t *a, const employee_t *b, const char *sort)
{
    if (strcmp(sort, "position") == 0)          return strcasecmp(a->position, b->position);
    if (strcmp(sort, "department") == 0)        return strcasecmp(a->department, b->department);
    if (strcmp(sort, "employment_status") == 0) return strcasecmp(a->employment_status, b->employment_status);
    if (strcmp(sort, "date_hired") == 0)        return strcmp(a->date_hired, b->date_hired);
    if (strcmp(sort, "employee_id") == 0)       return strcmp(a->employee_id, b->employee_id);
    return strcasecmp(a->last_name, b->last_name);
}

int db_employee_list(const char *search, const char *department, const char *status,
                     const char *sort, const char *order,
                     int page, int page_size,
                     employee_t *out, int out_cap, int *total)
{
    employee_t matched[EPMS_MAX_EMPLOYEES];
    int count = 0, i, j, start, copied = 0;
    int descending = (order && strcmp(order, "desc") == 0);

    pthread_mutex_lock(&g_lock);

    for (i = 0; i < g_employee_count; i++) {
        if (matches(&g_employees[i], search, department, status))
            matched[count++] = g_employees[i];
    }

    for (i = 1; i < count; i++) {          /* insertion sort: lists stay small */
        employee_t key = matched[i];
        j = i - 1;
        while (j >= 0) {
            int cmp = field_compare(&matched[j], &key, sort ? sort : "last_name");
            if (descending) cmp = -cmp;
            if (cmp <= 0) break;
            matched[j + 1] = matched[j];
            j--;
        }
        matched[j + 1] = key;
    }

    if (page < 1) page = 1;
    if (page_size < 1) page_size = 10;
    start = (page - 1) * page_size;

    for (i = start; i < count && copied < page_size && copied < out_cap; i++)
        out[copied++] = matched[i];

    *total = count;
    pthread_mutex_unlock(&g_lock);
    return copied;
}

employee_t *db_employee_find(const char *employee_id)
{
    int i;
    for (i = 0; i < g_employee_count; i++) {
        if (g_employees[i].active && strcmp(g_employees[i].employee_id, employee_id) == 0)
            return &g_employees[i];
    }
    return NULL;
}

int db_employee_insert(employee_t *record)
{
    pthread_mutex_lock(&g_lock);
    if (g_employee_count >= EPMS_MAX_EMPLOYEES) {
        pthread_mutex_unlock(&g_lock);
        return -1;
    }
    snprintf(record->employee_id, sizeof(record->employee_id), "EMP-%d", g_next_employee_number++);
    record->created_at = record->updated_at = time(NULL);
    record->active = 1;
    g_employees[g_employee_count++] = *record;
    pthread_mutex_unlock(&g_lock);
    return 0;
}

int db_employee_update(const char *employee_id, const employee_t *record)
{
    employee_t *existing;

    pthread_mutex_lock(&g_lock);
    existing = db_employee_find(employee_id);
    if (!existing) {
        pthread_mutex_unlock(&g_lock);
        return -1;
    }
    {
        time_t created = existing->created_at;
        *existing = *record;
        str_copy(existing->employee_id, employee_id, sizeof(existing->employee_id));
        existing->created_at = created;
        existing->updated_at = time(NULL);
        existing->active = 1;
    }
    pthread_mutex_unlock(&g_lock);
    return 0;
}

int db_employee_delete(const char *employee_id)
{
    employee_t *existing;

    pthread_mutex_lock(&g_lock);
    existing = db_employee_find(employee_id);
    if (!existing) {
        pthread_mutex_unlock(&g_lock);
        return -1;
    }
    /* Soft delete keeps the audit trail meaningful. */
    existing->active = 0;
    existing->updated_at = time(NULL);
    pthread_mutex_unlock(&g_lock);
    return 0;
}

/* ------------------------------------------------------------------- users */

app_user_t *db_user_find(const char *username)
{
    int i;
    for (i = 0; i < g_user_count; i++) {
        if (g_users[i].active && strcasecmp(g_users[i].username, username) == 0)
            return &g_users[i];
    }
    return NULL;
}

int db_user_upsert(const app_user_t *user)
{
    app_user_t *existing = db_user_find(user->username);

    pthread_mutex_lock(&g_lock);
    if (existing) {
        *existing = *user;
    } else if (g_user_count < EPMS_MAX_USERS) {
        g_users[g_user_count++] = *user;
    } else {
        pthread_mutex_unlock(&g_lock);
        return -1;
    }
    pthread_mutex_unlock(&g_lock);
    return 0;
}

/* ------------------------------------------------------------- audit trail */

void db_audit_write(const char *actor, const char *action, const char *target)
{
    pthread_mutex_lock(&g_lock);
    if (g_audit_count >= EPMS_MAX_AUDIT) {
        memmove(&g_audit[0], &g_audit[1], sizeof(audit_entry_t) * (EPMS_MAX_AUDIT - 1));
        g_audit_count = EPMS_MAX_AUDIT - 1;
    }
    str_copy(g_audit[g_audit_count].actor, actor, EPMS_ID_LEN);
    str_copy(g_audit[g_audit_count].action, action, 64);
    str_copy(g_audit[g_audit_count].target, target, EPMS_ID_LEN);
    g_audit[g_audit_count].at = time(NULL);
    g_audit_count++;
    pthread_mutex_unlock(&g_lock);

    LOG_INFO("audit %s %s %s", actor, action, target);
}

int db_audit_list(int limit, char *out, size_t out_len)
{
    json_writer_t w;
    char stamp[32];
    char *json;
    int i, written = 0;

    json_init(&w);
    json_array_start(&w, NULL);
    for (i = g_audit_count - 1; i >= 0 && written < limit; i--, written++) {
        iso_time(g_audit[i].at, stamp, sizeof(stamp));
        json_object_start(&w, NULL);
        json_number(&w, "id", (long)(i + 1));
        json_string(&w, "actor", g_audit[i].actor);
        json_string(&w, "action", g_audit[i].action);
        json_string(&w, "target", g_audit[i].target);
        json_string(&w, "at", stamp);
        json_object_end(&w);
    }
    json_array_end(&w);

    json = json_finish(&w);
    str_copy(out, json, out_len);
    free(json);
    return written;
}
