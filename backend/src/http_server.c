/*
 * http_server.c — transport only. Accepts connections, parses one request per
 * connection, hands it to the router, writes the response.
 *
 * The server binds to SERVER_HOST:SERVER_PORT. With SERVER_HOST=0.0.0.0 the
 * same process is reachable on localhost, on the LAN, and over the Tailscale
 * interface; put a reverse proxy in front of it for TLS on a public domain.
 *
 * TLS is intentionally not implemented here. Terminate HTTPS at nginx/Caddy,
 * or at Tailscale Serve, and forward plain HTTP on the private interface.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <pthread.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>

static volatile int g_running = 1;

static void handle_signal(int signal_number)
{
    (void)signal_number;
    g_running = 0;
}

const char *http_header(const http_request_t *req, const char *name)
{
    int i;
    for (i = 0; i < req->header_count; i++) {
        if (str_ieq(req->headers[i].name, name)) return req->headers[i].value;
    }
    return NULL;
}

static void url_decode(char *text)
{
    char *read = text, *write = text;
    while (*read) {
        if (*read == '%' && read[1] && read[2]) {
            char hex[3] = { read[1], read[2], '\0' };
            *write++ = (char)strtol(hex, NULL, 16);
            read += 3;
        } else if (*read == '+') {
            *write++ = ' ';
            read++;
        } else {
            *write++ = *read++;
        }
    }
    *write = '\0';
}

const char *http_query_param(const http_request_t *req, const char *name,
                             char *out, size_t out_len)
{
    const char *p = req->query;
    size_t name_len = strlen(name);

    out[0] = '\0';
    while (p && *p) {
        const char *amp = strchr(p, '&');
        size_t pair_len = amp ? (size_t)(amp - p) : strlen(p);
        if (pair_len > name_len && strncmp(p, name, name_len) == 0 && p[name_len] == '=') {
            size_t value_len = pair_len - name_len - 1;
            if (value_len >= out_len) value_len = out_len - 1;
            memcpy(out, p + name_len + 1, value_len);
            out[value_len] = '\0';
            url_decode(out);
            return out;
        }
        if (!amp) break;
        p = amp + 1;
    }
    return out;
}

void http_set_json(http_response_t *res, int status, char *json_body)
{
    res->status = status;
    str_copy(res->content_type, "application/json; charset=utf-8", sizeof(res->content_type));
    free(res->body);
    res->body = json_body;
}

void http_error(http_response_t *res, int status, const char *code, const char *message)
{
    json_writer_t w;
    json_init(&w);
    json_object_start(&w, NULL);
    json_object_start(&w, "error");
    json_string(&w, "code", code);
    json_string(&w, "message", message);
    json_object_end(&w);
    json_object_end(&w);
    http_set_json(res, status, json_finish(&w));
}

static const char *status_text(int status)
{
    switch (status) {
        case 200: return "OK";
        case 201: return "Created";
        case 204: return "No Content";
        case 400: return "Bad Request";
        case 401: return "Unauthorized";
        case 403: return "Forbidden";
        case 404: return "Not Found";
        case 405: return "Method Not Allowed";
        case 409: return "Conflict";
        case 413: return "Payload Too Large";
        case 429: return "Too Many Requests";
        case 500: return "Internal Server Error";
        default:  return "OK";
    }
}

static int read_request(int client_fd, http_request_t *req)
{
    char buffer[8192];
    size_t total = 0;
    ssize_t received;
    char *header_end = NULL;
    char *line, *saveptr = NULL;
    const char *content_length_header;
    long content_length = 0;
    size_t header_len, body_present;

    memset(req, 0, sizeof(*req));

    while (total < sizeof(buffer) - 1) {
        received = recv(client_fd, buffer + total, sizeof(buffer) - 1 - total, 0);
        if (received <= 0) return -1;
        total += (size_t)received;
        buffer[total] = '\0';
        header_end = strstr(buffer, "\r\n\r\n");
        if (header_end) break;
    }
    if (!header_end) return -1;

    header_len = (size_t)(header_end - buffer) + 4;

    /* Tokenise a copy of the header block: strtok_r would otherwise chew into
       the body bytes that follow it in the same buffer. */
    {
        char headers[8192];
        size_t copy_len = header_len < sizeof(headers) ? header_len : sizeof(headers) - 1;
        memcpy(headers, buffer, copy_len);
        headers[copy_len] = '\0';

        line = strtok_r(headers, "\r\n", &saveptr);
        if (!line) return -1;
        {
            char method[16], target[1024], version[16];
            char *question;
            if (sscanf(line, "%15s %1023s %15s", method, target, version) != 3) return -1;
            str_copy(req->method, method, sizeof(req->method));
            question = strchr(target, '?');
            if (question) {
                *question = '\0';
                str_copy(req->query, question + 1, sizeof(req->query));
            }
            str_copy(req->path, target, sizeof(req->path));
        }

        while ((line = strtok_r(NULL, "\r\n", &saveptr)) != NULL) {
            char *colon = strchr(line, ':');
            if (!colon) continue;
            if (req->header_count >= EPMS_MAX_HEADERS) break;
            *colon = '\0';
            colon++;
            while (*colon == ' ') colon++;
            str_copy(req->headers[req->header_count].name, line,
                     sizeof(req->headers[req->header_count].name));
            str_copy(req->headers[req->header_count].value, colon,
                     sizeof(req->headers[req->header_count].value));
            req->header_count++;
        }
    }

    content_length_header = http_header(req, "Content-Length");
    if (content_length_header) content_length = atol(content_length_header);
    if (content_length < 0 || content_length > EPMS_MAX_BODY) return -2;

    if (content_length > 0) {
        req->body = (char *)calloc((size_t)content_length + 1, 1);
        if (!req->body) return -1;

        body_present = total > header_len ? total - header_len : 0;
        if (body_present > (size_t)content_length) body_present = (size_t)content_length;
        /* the request line and headers were chopped up by strtok_r, but the
           body bytes after header_len are untouched */
        memcpy(req->body, buffer + header_len, body_present);
        req->body_len = body_present;

        while (req->body_len < (size_t)content_length) {
            received = recv(client_fd, req->body + req->body_len,
                            (size_t)content_length - req->body_len, 0);
            if (received <= 0) break;
            req->body_len += (size_t)received;
        }
        req->body[req->body_len] = '\0';
    }

    return 0;
}

static void write_response(int client_fd, const http_request_t *req, http_response_t *res)
{
    char head[2048];
    const char *body = res->body ? res->body : "";
    size_t body_len = strlen(body);
    int head_len;

    head_len = snprintf(head, sizeof(head),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "X-Frame-Options: DENY\r\n"
        "Referrer-Policy: no-referrer\r\n"
        "Cache-Control: no-store\r\n"
        "%s"
        "%s%s%s"
        "\r\n",
        res->status, status_text(res->status),
        res->content_type[0] ? res->content_type : "application/json; charset=utf-8",
        body_len,
        res->extra_headers,
        g_config.allowed_origin[0] ? "Access-Control-Allow-Origin: " : "",
        g_config.allowed_origin[0] ? g_config.allowed_origin : "",
        g_config.allowed_origin[0] ? "\r\nAccess-Control-Allow-Credentials: true\r\n" : "");

    if (head_len > 0) send(client_fd, head, (size_t)head_len, MSG_NOSIGNAL);
    if (body_len && strcmp(req->method, "HEAD") != 0)
        send(client_fd, body, body_len, MSG_NOSIGNAL);
}

static void *serve_connection(void *arg)
{
    int client_fd = *(int *)arg;
    http_request_t req;
    http_response_t res;
    int result;

    free(arg);
    memset(&res, 0, sizeof(res));

    result = read_request(client_fd, &req);
    if (result == 0) {
        if (strcmp(req.method, "OPTIONS") == 0) {
            /* CORS preflight for split frontend/backend deployments */
            res.status = 204;
            str_copy(res.extra_headers,
                     "Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\n"
                     "Access-Control-Allow-Headers: Content-Type,Authorization,X-CSRF-Token\r\n"
                     "Access-Control-Max-Age: 600\r\n",
                     sizeof(res.extra_headers));
            res.body = str_dup_safe("");
        } else {
            router_dispatch(&req, &res);
        }
        LOG_INFO("%s %s -> %d", req.method, req.path, res.status);
    } else if (result == -2) {
        http_error(&res, 413, "payload_too_large", "The request body is too large.");
    } else {
        http_error(&res, 400, "bad_request", "The request could not be understood.");
    }

    write_response(client_fd, &req, &res);

    free(req.body);
    free(res.body);
    close(client_fd);
    return NULL;
}

int http_server_run(const epms_config_t *config)
{
    int listen_fd, option = 1;
    struct sockaddr_in address;

    signal(SIGINT, handle_signal);
    signal(SIGTERM, handle_signal);
    signal(SIGPIPE, SIG_IGN);

    listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) {
        LOG_ERROR("socket() failed: %s", strerror(errno));
        return 1;
    }
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &option, sizeof(option));

    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons((uint16_t)config->server_port);
    if (inet_pton(AF_INET, config->server_host, &address.sin_addr) != 1) {
        LOG_ERROR("SERVER_HOST '%s' is not a valid IPv4 address", config->server_host);
        close(listen_fd);
        return 1;
    }

    if (bind(listen_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        LOG_ERROR("bind %s:%d failed: %s", config->server_host, config->server_port, strerror(errno));
        close(listen_fd);
        return 1;
    }
    if (listen(listen_fd, 64) < 0) {
        LOG_ERROR("listen() failed: %s", strerror(errno));
        close(listen_fd);
        return 1;
    }

    LOG_INFO("API listening on http://%s:%d/api", config->server_host, config->server_port);

    while (g_running) {
        struct sockaddr_in peer;
        socklen_t peer_len = sizeof(peer);
        pthread_t thread;
        int *client_fd;

        int accepted = accept(listen_fd, (struct sockaddr *)&peer, &peer_len);
        if (accepted < 0) {
            if (errno == EINTR) continue;
            LOG_WARN("accept() failed: %s", strerror(errno));
            continue;
        }

        auth_session_sweep();

        client_fd = (int *)malloc(sizeof(int));
        if (!client_fd) { close(accepted); continue; }
        *client_fd = accepted;

        if (pthread_create(&thread, NULL, serve_connection, client_fd) != 0) {
            LOG_WARN("could not start worker thread");
            close(accepted);
            free(client_fd);
            continue;
        }
        pthread_detach(thread);
    }

    LOG_INFO("shutting down");
    close(listen_fd);
    return 0;
}
