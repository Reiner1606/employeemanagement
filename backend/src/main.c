/*
 * main.c — process start-up: load configuration, open the data layer, run the
 * HTTP server until SIGINT/SIGTERM.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv)
{
    int i, exit_code;

    config_load(&g_config);

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--help") == 0) {
            printf("epms-server — Employee Profile Management System API\n\n"
                   "Configuration comes from the environment (see config/.env.example):\n"
                   "  SERVER_HOST, SERVER_PORT, ALLOWED_ORIGIN,\n"
                   "  DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD,\n"
                   "  SESSION_TTL_MINUTES, LOGIN_MAX_ATTEMPTS, COOKIE_SECURE, LOG_LEVEL,\n"
                   "  EPMS_SEED_PASSWORD (development only: seeds the sample accounts)\n");
            return 0;
        }
        if (strcmp(argv[i], "--version") == 0) {
            printf("epms-server 1.0.0\n");
            return 0;
        }
    }

    LOG_INFO("starting epms-server");
    LOG_INFO("database target %s:%d/%s as %s",
             g_config.db_host, g_config.db_port, g_config.db_name, g_config.db_user);

    if (db_init(&g_config) != 0) {
        LOG_ERROR("the data layer could not be initialised");
        return 1;
    }

    exit_code = http_server_run(&g_config);

    db_shutdown();
    return exit_code;
}
