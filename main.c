/*
 * main.c — process start-up: load configuration, open the data layer, run the
 * HTTP server until SIGINT/SIGTERM.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

/*
 * Reads a password from the terminal without echoing it, so it never appears
 * on screen or in shell history, and prints the hash to paste into the
 * users.password_hash column.
 */
static int hash_password_command(void)
{
    struct termios original, muted;
    char password[128] = {0};
    char confirm[128] = {0};
    char hash[160];
    int interactive = isatty(STDIN_FILENO);

    if (interactive) {
        tcgetattr(STDIN_FILENO, &original);
        muted = original;
        muted.c_lflag &= ~(tcflag_t)ECHO;
        fprintf(stderr, "Password: ");
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &muted);
    }

    if (!fgets(password, sizeof(password), stdin)) {
        if (interactive) tcsetattr(STDIN_FILENO, TCSAFLUSH, &original);
        fprintf(stderr, "\nNo password read.\n");
        return 1;
    }
    password[strcspn(password, "\r\n")] = '\0';

    if (interactive) {
        fprintf(stderr, "\nConfirm:  ");
        if (fgets(confirm, sizeof(confirm), stdin)) confirm[strcspn(confirm, "\r\n")] = '\0';
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &original);
        fprintf(stderr, "\n");

        if (strcmp(password, confirm) != 0) {
            fprintf(stderr, "The two entries do not match.\n");
            return 1;
        }
    }

    if (strlen(password) < 12) {
        fprintf(stderr, "Use at least 12 characters for an account that holds staff data.\n");
        return 1;
    }
    if (auth_hash_password(password, hash, sizeof(hash)) != 0) {
        fprintf(stderr, "The password could not be hashed.\n");
        return 1;
    }

    memset(password, 0, sizeof(password));
    memset(confirm, 0, sizeof(confirm));

    printf("%s\n", hash);
    if (interactive) {
        fprintf(stderr,
                "\nPaste that into the users table, for example:\n"
                "  UPDATE users SET password_hash = '<the line above>'\n"
                "   WHERE username = 'admin';\n");
    }
    return 0;
}

int main(int argc, char **argv)
{
    int i, exit_code;

    config_load(&g_config);

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--hash-password") == 0) {
            return hash_password_command();
        }
        if (strcmp(argv[i], "--help") == 0) {
            printf("epms-server — Employee Profile Management System API\n\n"
                   "Usage:\n"
                   "  epms-server                 run the API\n"
                   "  epms-server --hash-password read a password and print its hash\n"
                   "  epms-server --version\n\n"
                   "Configuration comes from the environment (see config/.env.example):\n"
                   "  SERVER_HOST, SERVER_PORT, ALLOWED_ORIGIN,\n"
                   "  DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD,\n"
                   "  SESSION_TTL_MINUTES, LOGIN_MAX_ATTEMPTS, COOKIE_SECURE, LOG_LEVEL,\n"
                   "  BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME\n"
                   "    (development only: creates exactly one administrator at start-up so you\n"
                   "     have a way to sign in the first time; every other account is created\n"
                   "     from inside the app afterwards)\n");
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
