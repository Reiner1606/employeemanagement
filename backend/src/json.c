/*
 * json.c — a small, dependency-free JSON writer plus a reader for the flat
 * objects this API receives. Swap in a full parser (cJSON, jansson) later if
 * nested request bodies are ever needed; only this file would change.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void json_reserve(json_writer_t *w, size_t extra)
{
    if (w->len + extra + 1 <= w->cap) return;
    while (w->len + extra + 1 > w->cap) w->cap = w->cap ? w->cap * 2 : 512;
    w->buf = (char *)realloc(w->buf, w->cap);
}

static void json_raw(json_writer_t *w, const char *text)
{
    size_t n = strlen(text);
    json_reserve(w, n);
    if (!w->buf) return;
    memcpy(w->buf + w->len, text, n);
    w->len += n;
    w->buf[w->len] = '\0';
}

static void json_escaped(json_writer_t *w, const char *value)
{
    const char *p;
    char unicode[8];

    json_raw(w, "\"");
    for (p = value ? value : ""; *p; p++) {
        switch (*p) {
            case '"':  json_raw(w, "\\\""); break;
            case '\\': json_raw(w, "\\\\"); break;
            case '\n': json_raw(w, "\\n");  break;
            case '\r': json_raw(w, "\\r");  break;
            case '\t': json_raw(w, "\\t");  break;
            default:
                if ((unsigned char)*p < 0x20) {
                    snprintf(unicode, sizeof(unicode), "\\u%04x", (unsigned char)*p);
                    json_raw(w, unicode);
                } else {
                    char ch[2];
                    ch[0] = *p; ch[1] = '\0';
                    json_raw(w, ch);
                }
        }
    }
    json_raw(w, "\"");
}

static void json_prefix(json_writer_t *w, const char *key)
{
    if (w->needs_comma) json_raw(w, ",");
    if (key) {
        json_escaped(w, key);
        json_raw(w, ":");
    }
    w->needs_comma = 1;
}

void json_init(json_writer_t *w)
{
    w->buf = NULL;
    w->len = 0;
    w->cap = 0;
    w->needs_comma = 0;
    json_reserve(w, 64);
    if (w->buf) w->buf[0] = '\0';
}

void json_object_start(json_writer_t *w, const char *key)
{
    json_prefix(w, key);
    json_raw(w, "{");
    w->needs_comma = 0;
}

void json_object_end(json_writer_t *w)
{
    json_raw(w, "}");
    w->needs_comma = 1;
}

void json_array_start(json_writer_t *w, const char *key)
{
    json_prefix(w, key);
    json_raw(w, "[");
    w->needs_comma = 0;
}

void json_array_end(json_writer_t *w)
{
    json_raw(w, "]");
    w->needs_comma = 1;
}

void json_string(json_writer_t *w, const char *key, const char *value)
{
    json_prefix(w, key);
    json_escaped(w, value ? value : "");
}

void json_number(json_writer_t *w, const char *key, long value)
{
    char number[32];
    json_prefix(w, key);
    snprintf(number, sizeof(number), "%ld", value);
    json_raw(w, number);
}

void json_bool(json_writer_t *w, const char *key, int value)
{
    json_prefix(w, key);
    json_raw(w, value ? "true" : "false");
}

void json_null(json_writer_t *w, const char *key)
{
    json_prefix(w, key);
    json_raw(w, "null");
}

char *json_finish(json_writer_t *w)
{
    char *out = w->buf;
    w->buf = NULL;
    w->len = w->cap = 0;
    return out ? out : str_dup_safe("{}");
}

/* --------------------------------------------------------------- reading */

static const char *find_key(const char *json, const char *key)
{
    char needle[128];
    const char *found;

    snprintf(needle, sizeof(needle), "\"%s\"", key);
    found = strstr(json ? json : "", needle);
    if (!found) return NULL;

    found += strlen(needle);
    while (*found == ' ' || *found == '\t' || *found == '\n' || *found == '\r') found++;
    if (*found != ':') return NULL;
    found++;
    while (*found == ' ' || *found == '\t' || *found == '\n' || *found == '\r') found++;
    return found;
}

int json_get_string(const char *json, const char *key, char *out, size_t out_len)
{
    const char *p = find_key(json, key);
    size_t i = 0;

    if (!p || out_len == 0) { if (out_len) out[0] = '\0'; return -1; }
    out[0] = '\0';

    if (*p == '"') {
        p++;
        while (*p && *p != '"' && i + 1 < out_len) {
            if (*p == '\\' && p[1]) {
                p++;
                switch (*p) {
                    case 'n': out[i++] = '\n'; break;
                    case 't': out[i++] = '\t'; break;
                    case 'r': out[i++] = '\r'; break;
                    default:  out[i++] = *p;   break;
                }
            } else {
                out[i++] = *p;
            }
            p++;
        }
        out[i] = '\0';
        return 0;
    }

    /* numbers, true/false and null are copied verbatim */
    while (*p && *p != ',' && *p != '}' && *p != ']' && i + 1 < out_len) out[i++] = *p++;
    out[i] = '\0';
    return (i > 0) ? 0 : -1;
}

int json_get_bool(const char *json, const char *key, int fallback)
{
    char value[16];
    if (json_get_string(json, key, value, sizeof(value)) != 0) return fallback;
    if (strncmp(value, "true", 4) == 0) return 1;
    if (strncmp(value, "false", 5) == 0) return 0;
    return fallback;
}
