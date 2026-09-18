/*
 * employee_routes.c — employee CRUD, department list, dashboard summary and
 * audit history. Every handler re-checks the session and the permission it
 * needs: the browser's copy of the session decides nothing.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

typedef struct {
    session_t  *session;
    app_user_t *user;
} actor_t;

static int resolve_actor(const http_request_t *req, http_response_t *res, actor_t *actor)
{
    actor->session = auth_current_session(req);
    if (!actor->session || !actor->session->two_factor_passed) {
        http_error(res, 401, "unauthenticated", "Your session has ended. Sign in again.");
        return 0;
    }
    actor->user = db_user_find(actor->session->username);
    if (!actor->user) {
        http_error(res, 401, "unauthenticated", "This account is no longer active.");
        return 0;
    }
    return 1;
}

/* ------------------------------------------------------------ serialisation */

static void write_employee(json_writer_t *w, const char *key, const employee_t *e)
{
    char created[32], updated[32];
    iso_time(e->created_at, created, sizeof(created));
    iso_time(e->updated_at, updated, sizeof(updated));

    json_object_start(w, key);
    json_string(w, "employee_id", e->employee_id);
    json_string(w, "first_name", e->first_name);
    json_string(w, "middle_name", e->middle_name);
    json_string(w, "last_name", e->last_name);
    json_string(w, "date_of_birth", e->date_of_birth);
    json_string(w, "gender", e->gender);
    json_string(w, "email", e->email);
    json_string(w, "contact_number", e->contact_number);
    json_string(w, "address", e->address);
    json_string(w, "position", e->position);
    json_string(w, "department", e->department);
    json_string(w, "employment_status", e->employment_status);
    json_string(w, "date_hired", e->date_hired);
    json_string(w, "photo_url", e->photo_url);
    json_string(w, "emergency_contact_name", e->emergency_contact_name);
    json_string(w, "emergency_contact_relationship", e->emergency_contact_relationship);
    json_string(w, "emergency_contact_number", e->emergency_contact_number);
    json_string(w, "created_at", created);
    json_string(w, "updated_at", updated);
    json_object_end(w);
}

/* -------------------------------------------------------------- validation */

typedef struct {
    char field[64];
    char message[128];
} field_error_t;

static int validate(const employee_t *e, field_error_t *errors, int max_errors)
{
    int count = 0;
    struct { const char *name; const char *value; const char *label; } required[] = {
        { "first_name", e->first_name, "First name" },
        { "last_name", e->last_name, "Last name" },
        { "date_of_birth", e->date_of_birth, "Date of birth" },
        { "gender", e->gender, "Gender" },
        { "email", e->email, "Work email" },
        { "contact_number", e->contact_number, "Contact number" },
        { "address", e->address, "Home address" },
        { "position", e->position, "Position" },
        { "department", e->department, "Department" },
        { "employment_status", e->employment_status, "Employment status" },
        { "date_hired", e->date_hired, "Date hired" },
        { "emergency_contact_name", e->emergency_contact_name, "Emergency contact name" },
        { "emergency_contact_number", e->emergency_contact_number, "Emergency contact number" }
    };
    int i, total = (int)(sizeof(required) / sizeof(required[0]));

    for (i = 0; i < total && count < max_errors; i++) {
        if (!required[i].value[0]) {
            str_copy(errors[count].field, required[i].name, sizeof(errors[count].field));
            snprintf(errors[count].message, sizeof(errors[count].message),
                     "%s is required.", required[i].label);
            count++;
        }
    }

    if (count < max_errors && e->email[0] && !strchr(e->email, '@')) {
        str_copy(errors[count].field, "email", sizeof(errors[count].field));
        str_copy(errors[count].message, "Enter a valid email address.", sizeof(errors[count].message));
        count++;
    }

    if (count < max_errors && e->employment_status[0] &&
        strcmp(e->employment_status, "Active") != 0 &&
        strcmp(e->employment_status, "Inactive") != 0 &&
        strcmp(e->employment_status, "On Leave") != 0) {
        str_copy(errors[count].field, "employment_status", sizeof(errors[count].field));
        str_copy(errors[count].message, "Choose Active, On Leave or Inactive.",
                 sizeof(errors[count].message));
        count++;
    }

    return count;
}

static void send_validation_errors(http_response_t *res, field_error_t *errors, int count)
{
    json_writer_t w;
    int i;

    json_init(&w);
    json_object_start(&w, NULL);
    json_object_start(&w, "error");
    json_string(&w, "code", "validation_failed");
    json_string(&w, "message", "Some fields need attention.");
    json_object_start(&w, "details");
    for (i = 0; i < count; i++) json_string(&w, errors[i].field, errors[i].message);
    json_object_end(&w);
    json_object_end(&w);
    json_object_end(&w);
    http_set_json(res, 400, json_finish(&w));
}

static void read_employee_body(const char *body, employee_t *e)
{
    json_get_string(body, "first_name", e->first_name, sizeof(e->first_name));
    json_get_string(body, "middle_name", e->middle_name, sizeof(e->middle_name));
    json_get_string(body, "last_name", e->last_name, sizeof(e->last_name));
    json_get_string(body, "date_of_birth", e->date_of_birth, sizeof(e->date_of_birth));
    json_get_string(body, "gender", e->gender, sizeof(e->gender));
    json_get_string(body, "email", e->email, sizeof(e->email));
    json_get_string(body, "contact_number", e->contact_number, sizeof(e->contact_number));
    json_get_string(body, "address", e->address, sizeof(e->address));
    json_get_string(body, "position", e->position, sizeof(e->position));
    json_get_string(body, "department", e->department, sizeof(e->department));
    json_get_string(body, "employment_status", e->employment_status, sizeof(e->employment_status));
    json_get_string(body, "date_hired", e->date_hired, sizeof(e->date_hired));
    json_get_string(body, "photo_url", e->photo_url, sizeof(e->photo_url));
    json_get_string(body, "emergency_contact_name", e->emergency_contact_name,
                    sizeof(e->emergency_contact_name));
    json_get_string(body, "emergency_contact_relationship", e->emergency_contact_relationship,
                    sizeof(e->emergency_contact_relationship));
    json_get_string(body, "emergency_contact_number", e->emergency_contact_number,
                    sizeof(e->emergency_contact_number));
}

/* ------------------------------------------------------------------ handlers */

static void handle_list(const http_request_t *req, http_response_t *res, const actor_t *actor)
{
    employee_t page_rows[100];
    char search[128], department[128], status[64], sort[64], order[8], buffer[16];
    int page, page_size, total = 0, returned, i;
    json_writer_t w;

    if (!auth_has_permission(actor->user, "employees:read")) {
        http_error(res, 403, "forbidden", "Employee records are limited to administrators.");
        return;
    }

    http_query_param(req, "q", search, sizeof(search));
    http_query_param(req, "department", department, sizeof(department));
    http_query_param(req, "status", status, sizeof(status));
    http_query_param(req, "sort", sort, sizeof(sort));
    http_query_param(req, "order", order, sizeof(order));

    http_query_param(req, "page", buffer, sizeof(buffer));
    page = buffer[0] ? atoi(buffer) : 1;
    http_query_param(req, "page_size", buffer, sizeof(buffer));
    page_size = buffer[0] ? atoi(buffer) : 10;
    if (page_size > 100) page_size = 100;

    returned = db_employee_list(search, department, status,
                                sort[0] ? sort : "last_name", order,
                                page, page_size, page_rows, 100, &total);

    json_init(&w);
    json_object_start(&w, NULL);
    json_array_start(&w, "data");
    for (i = 0; i < returned; i++) write_employee(&w, NULL, &page_rows[i]);
    json_array_end(&w);
    json_object_start(&w, "meta");
    json_number(&w, "page", page);
    json_number(&w, "page_size", page_size);
    json_number(&w, "total", total);
    json_number(&w, "total_pages", page_size ? (total + page_size - 1) / page_size : 1);
    json_object_end(&w);
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_get(http_response_t *res, const actor_t *actor, const char *employee_id)
{
    employee_t *record;
    json_writer_t w;
    int is_self = strcmp(actor->user->employee_id, employee_id) == 0;

    if (!is_self && !auth_has_permission(actor->user, "employees:read")) {
        http_error(res, 403, "forbidden", "You can only open your own profile.");
        return;
    }

    record = db_employee_find(employee_id);
    if (!record) {
        http_error(res, 404, "not_found", "That employee record no longer exists.");
        return;
    }

    json_init(&w);
    json_object_start(&w, NULL);
    write_employee(&w, "data", record);
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_create(const http_request_t *req, http_response_t *res, const actor_t *actor)
{
    employee_t record;
    field_error_t errors[16];
    int error_count;
    json_writer_t w;

    if (!auth_has_permission(actor->user, "employees:manage")) {
        http_error(res, 403, "forbidden", "You do not have permission to add employees.");
        return;
    }

    memset(&record, 0, sizeof(record));
    read_employee_body(req->body, &record);

    error_count = validate(&record, errors, 16);
    if (error_count) { send_validation_errors(res, errors, error_count); return; }

    if (db_employee_insert(&record) != 0) {
        http_error(res, 500, "storage_error", "The record could not be saved.");
        return;
    }
    db_audit_write(actor->user->username, "employee.create", record.employee_id);

    json_init(&w);
    json_object_start(&w, NULL);
    write_employee(&w, "data", &record);
    json_object_end(&w);
    http_set_json(res, 201, json_finish(&w));
}

static void handle_update(const http_request_t *req, http_response_t *res,
                          const actor_t *actor, const char *employee_id)
{
    employee_t *existing, updated;
    field_error_t errors[16];
    int error_count;
    int can_manage = auth_has_permission(actor->user, "employees:manage");
    int is_self = strcmp(actor->user->employee_id, employee_id) == 0;
    json_writer_t w;

    if (!can_manage && !is_self) {
        http_error(res, 403, "forbidden", "You can only update your own profile.");
        return;
    }

    existing = db_employee_find(employee_id);
    if (!existing) {
        http_error(res, 404, "not_found", "That employee record no longer exists.");
        return;
    }

    updated = *existing;
    if (can_manage) {
        read_employee_body(req->body, &updated);
    } else {
        /* Self-service is limited to contact and emergency details. */
        json_get_string(req->body, "email", updated.email, sizeof(updated.email));
        json_get_string(req->body, "contact_number", updated.contact_number, sizeof(updated.contact_number));
        json_get_string(req->body, "address", updated.address, sizeof(updated.address));
        json_get_string(req->body, "emergency_contact_name", updated.emergency_contact_name,
                        sizeof(updated.emergency_contact_name));
        json_get_string(req->body, "emergency_contact_relationship", updated.emergency_contact_relationship,
                        sizeof(updated.emergency_contact_relationship));
        json_get_string(req->body, "emergency_contact_number", updated.emergency_contact_number,
                        sizeof(updated.emergency_contact_number));
    }

    error_count = validate(&updated, errors, 16);
    if (error_count) { send_validation_errors(res, errors, error_count); return; }

    if (db_employee_update(employee_id, &updated) != 0) {
        http_error(res, 500, "storage_error", "The record could not be saved.");
        return;
    }
    db_audit_write(actor->user->username,
                   can_manage ? "employee.update" : "self.update", employee_id);

    json_init(&w);
    json_object_start(&w, NULL);
    write_employee(&w, "data", db_employee_find(employee_id));
    json_object_end(&w);
    http_set_json(res, 200, json_finish(&w));
}

static void handle_delete(http_response_t *res, const actor_t *actor, const char *employee_id)
{
    if (!auth_has_permission(actor->user, "employees:manage")) {
        http_error(res, 403, "forbidden", "You do not have permission to remove employees.");
        return;
    }
    if (db_employee_delete(employee_id) != 0) {
        http_error(res, 404, "not_found", "That employee record no longer exists.");
        return;
    }
    db_audit_write(actor->user->username, "employee.delete", employee_id);

    res->status = 204;
    free(res->body);
    res->body = str_dup_safe("");
}

void employee_routes(const http_request_t *req, http_response_t *res, const char *tail)
{
    actor_t actor;
    char employee_id[EPMS_ID_LEN] = {0};

    if (!resolve_actor(req, res, &actor)) return;

    if (tail[0] == '/') str_copy(employee_id, tail + 1, sizeof(employee_id));

    if (!employee_id[0]) {
        if (strcmp(req->method, "GET") == 0)  { handle_list(req, res, &actor); return; }
        if (strcmp(req->method, "POST") == 0) { handle_create(req, res, &actor); return; }
        http_error(res, 405, "method_not_allowed", "That method is not supported on this endpoint.");
        return;
    }

    if (strcmp(req->method, "GET") == 0)    { handle_get(res, &actor, employee_id); return; }
    if (strcmp(req->method, "PUT") == 0)    { handle_update(req, res, &actor, employee_id); return; }
    if (strcmp(req->method, "DELETE") == 0) { handle_delete(res, &actor, employee_id); return; }

    http_error(res, 405, "method_not_allowed", "That method is not supported on this endpoint.");
}

/* --------------------------------------------- departments and dashboard */

static const char *DEPARTMENTS[] = {
    "Engineering", "Human Resources", "Finance", "Operations", "Sales"
};
#define DEPARTMENT_COUNT ((int)(sizeof(DEPARTMENTS) / sizeof(DEPARTMENTS[0])))

static int count_in(const char *department, const char *status)
{
    employee_t rows[EPMS_MAX_EMPLOYEES];
    int total = 0;
    db_employee_list("", department, status, "last_name", "asc", 1, 1, rows, 1, &total);
    return total;
}

void dashboard_routes(const http_request_t *req, http_response_t *res, const char *tail)
{
    actor_t actor;
    json_writer_t w;
    int i;

    if (strcmp(req->method, "GET") != 0) {
        http_error(res, 405, "method_not_allowed", "That method is not supported on this endpoint.");
        return;
    }
    if (!resolve_actor(req, res, &actor)) return;

    if (strcmp(tail, "/departments") == 0) {
        json_init(&w);
        json_object_start(&w, NULL);
        json_array_start(&w, "data");
        for (i = 0; i < DEPARTMENT_COUNT; i++) {
            json_object_start(&w, NULL);
            json_number(&w, "id", i + 1);
            json_string(&w, "name", DEPARTMENTS[i]);
            json_number(&w, "employee_count", count_in(DEPARTMENTS[i], ""));
            json_object_end(&w);
        }
        json_array_end(&w);
        json_object_end(&w);
        http_set_json(res, 200, json_finish(&w));
        return;
    }

    if (strcmp(tail, "/summary") == 0) {
        employee_t recent[10];
        int total = 0, returned;

        if (!auth_has_permission(actor.user, "employees:read")) {
            http_error(res, 403, "forbidden", "The overview is limited to administrators.");
            return;
        }

        json_init(&w);
        json_object_start(&w, NULL);
        json_object_start(&w, "data");
        json_number(&w, "total_employees", count_in("", ""));
        json_number(&w, "active_employees", count_in("", "Active"));
        json_number(&w, "inactive_employees", count_in("", "Inactive"));
        json_number(&w, "on_leave_employees", count_in("", "On Leave"));
        json_number(&w, "department_count", DEPARTMENT_COUNT);

        json_array_start(&w, "headcount_by_department");
        for (i = 0; i < DEPARTMENT_COUNT; i++) {
            json_object_start(&w, NULL);
            json_string(&w, "department", DEPARTMENTS[i]);
            json_number(&w, "count", count_in(DEPARTMENTS[i], ""));
            json_object_end(&w);
        }
        json_array_end(&w);

        returned = db_employee_list("", "", "", "employee_id", "desc", 1, 5, recent, 10, &total);
        json_array_start(&w, "recently_added");
        for (i = 0; i < returned; i++) {
            char created[32], name[256];
            iso_time(recent[i].created_at, created, sizeof(created));
            snprintf(name, sizeof(name), "%s %s", recent[i].first_name, recent[i].last_name);
            json_object_start(&w, NULL);
            json_string(&w, "employee_id", recent[i].employee_id);
            json_string(&w, "name", name);
            json_string(&w, "department", recent[i].department);
            json_string(&w, "position", recent[i].position);
            json_string(&w, "employment_status", recent[i].employment_status);
            json_string(&w, "created_at", created);
            json_object_end(&w);
        }
        json_array_end(&w);

        json_array_start(&w, "recently_updated");
        for (i = 0; i < returned; i++) {
            char updated[32], name[256];
            iso_time(recent[i].updated_at, updated, sizeof(updated));
            snprintf(name, sizeof(name), "%s %s", recent[i].first_name, recent[i].last_name);
            json_object_start(&w, NULL);
            json_string(&w, "employee_id", recent[i].employee_id);
            json_string(&w, "name", name);
            json_string(&w, "department", recent[i].department);
            json_string(&w, "position", recent[i].position);
            json_string(&w, "employment_status", recent[i].employment_status);
            json_string(&w, "updated_at", updated);
            json_object_end(&w);
        }
        json_array_end(&w);

        json_object_end(&w);
        json_object_end(&w);
        http_set_json(res, 200, json_finish(&w));
        return;
    }

    if (strcmp(tail, "/audit-logs") == 0) {
        char limit_param[16];
        char entries[8192];
        char *body;
        int limit;

        if (!auth_has_permission(actor.user, "audit:read")) {
            http_error(res, 403, "forbidden", "Audit history is limited to administrators.");
            return;
        }
        http_query_param(req, "limit", limit_param, sizeof(limit_param));
        limit = limit_param[0] ? atoi(limit_param) : 10;
        if (limit < 1 || limit > 100) limit = 10;

        db_audit_list(limit, entries, sizeof(entries));
        body = (char *)malloc(strlen(entries) + 32);
        if (!body) {
            http_error(res, 500, "storage_error", "The audit history could not be read.");
            return;
        }
        sprintf(body, "{\"data\":%s}", entries);
        http_set_json(res, 200, body);
        return;
    }

    http_error(res, 404, "route_not_found", "Unknown endpoint.");
}
