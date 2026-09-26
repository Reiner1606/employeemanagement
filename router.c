/*
 * router.c — maps an incoming method + path to a handler group.
 * Every public path is prefixed with /api so a reverse proxy can forward one
 * location block to this process and serve the frontend from another.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int path_starts_with(const char *path, const char *prefix, const char **tail)
{
    size_t len = strlen(prefix);
    if (strncmp(path, prefix, len) != 0) return 0;
    if (path[len] != '\0' && path[len] != '/') return 0;
    *tail = path + len;
    return 1;
}

void router_dispatch(const http_request_t *req, http_response_t *res)
{
    const char *path = req->path;
    const char *tail = NULL;

    if (strcmp(path, "/api/health") == 0 || strcmp(path, "/health") == 0) {
        json_writer_t w;
        json_init(&w);
        json_object_start(&w, NULL);
        json_string(&w, "status", "ok");
        json_number(&w, "employees", (long)db_employee_count());
        json_object_end(&w);
        http_set_json(res, 200, json_finish(&w));
        return;
    }

    if (strncmp(path, "/api", 4) != 0) {
        http_error(res, 404, "route_not_found",
                   "Unknown endpoint. API paths start with /api.");
        return;
    }
    path += 4;

    if (path_starts_with(path, "/auth", &tail))       { auth_routes(req, res, tail); return; }
    if (path_starts_with(path, "/employees", &tail))  { employee_routes(req, res, tail); return; }
    if (path_starts_with(path, "/departments", &tail)) { dashboard_routes(req, res, "/departments"); return; }
    if (path_starts_with(path, "/dashboard", &tail))  { dashboard_routes(req, res, tail); return; }
    if (path_starts_with(path, "/audit-logs", &tail)) { dashboard_routes(req, res, "/audit-logs"); return; }

    http_error(res, 404, "route_not_found", "Unknown endpoint.");
}
