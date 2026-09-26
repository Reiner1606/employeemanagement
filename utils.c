/*
 * utils.c — configuration loading, logging, small string helpers and the
 * SHA-256 primitive used for development password hashing.
 *
 * PRODUCTION NOTE: the iterated SHA-256 below is deliberately simple so the
 * project builds with no external dependency. Before this system holds real
 * staff data, replace auth_hash_password/auth_verify_password with Argon2id
 * (libsodium: crypto_pwhash_str / crypto_pwhash_str_verify). The rest of the
 * codebase only talks to those two functions, so the swap is local.
 */
#include "epms.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <strings.h>
#include <stdint.h>
#include <time.h>

epms_config_t g_config;

/* ---------------------------------------------------------------- strings */

void str_copy(char *dst, const char *src, size_t dst_len)
{
    if (!dst || dst_len == 0) return;
    if (!src) { dst[0] = '\0'; return; }
    strncpy(dst, src, dst_len - 1);
    dst[dst_len - 1] = '\0';
}

char *str_dup_safe(const char *src)
{
    size_t n;
    char *copy;
    if (!src) src = "";
    n = strlen(src) + 1;
    copy = (char *)malloc(n);
    if (copy) memcpy(copy, src, n);
    return copy;
}

int str_ieq(const char *a, const char *b)
{
    if (!a || !b) return 0;
    return strcasecmp(a, b) == 0;
}

void iso_time(time_t t, char *out, size_t out_len)
{
    struct tm tm_utc;
    gmtime_r(&t, &tm_utc);
    strftime(out, out_len, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

/* ------------------------------------------------------------------ config */

static const char *env_or(const char *name, const char *fallback)
{
    const char *value = getenv(name);
    return (value && *value) ? value : fallback;
}

static int env_int(const char *name, int fallback)
{
    const char *value = getenv(name);
    if (!value || !*value) return fallback;
    return atoi(value);
}

void config_load(epms_config_t *config)
{
    memset(config, 0, sizeof(*config));

    /* 0.0.0.0 means "every interface", including the Tailscale one. Set
       SERVER_HOST=127.0.0.1 when a reverse proxy runs on the same machine. */
    str_copy(config->server_host, env_or("SERVER_HOST", "0.0.0.0"), sizeof(config->server_host));
    config->server_port = env_int("SERVER_PORT", 8080);

    str_copy(config->allowed_origin, env_or("ALLOWED_ORIGIN", ""), sizeof(config->allowed_origin));

    str_copy(config->db_host, env_or("DATABASE_HOST", "127.0.0.1"), sizeof(config->db_host));
    config->db_port = env_int("DATABASE_PORT", 5432);
    str_copy(config->db_name, env_or("DATABASE_NAME", "employee_system"), sizeof(config->db_name));
    str_copy(config->db_user, env_or("DATABASE_USER", "app_user"), sizeof(config->db_user));
    str_copy(config->db_password, env_or("DATABASE_PASSWORD", ""), sizeof(config->db_password));

    config->session_ttl_minutes  = env_int("SESSION_TTL_MINUTES", 30);
    config->login_max_attempts   = env_int("LOGIN_MAX_ATTEMPTS", 5);
    config->require_secure_cookie = env_int("COOKIE_SECURE", 1);
    config->log_level            = env_int("LOG_LEVEL", 2);
}

/* ----------------------------------------------------------------- logging */

void log_message(int level, const char *fmt, ...)
{
    static const char *names[] = { "ERROR", "WARN ", "INFO ", "DEBUG" };
    char stamp[32];
    va_list args;

    if (level > g_config.log_level) return;
    iso_time(time(NULL), stamp, sizeof(stamp));

    fprintf(stderr, "%s [%s] ", stamp, names[level < 0 ? 0 : (level > 3 ? 3 : level)]);
    va_start(args, fmt);
    vfprintf(stderr, fmt, args);
    va_end(args);
    fputc('\n', stderr);
    fflush(stderr);
}

/* ------------------------------------------------------------- randomness */

void random_hex(char *out, size_t out_len)
{
    static const char *hex = "0123456789abcdef";
    unsigned char raw[64];
    size_t need = (out_len - 1) / 2;
    size_t i;
    FILE *urandom;

    if (need > sizeof(raw)) need = sizeof(raw);

    urandom = fopen("/dev/urandom", "rb");
    if (urandom) {
        if (fread(raw, 1, need, urandom) != need) {
            for (i = 0; i < need; i++) raw[i] = (unsigned char)(rand() & 0xff);
        }
        fclose(urandom);
    } else {
        for (i = 0; i < need; i++) raw[i] = (unsigned char)(rand() & 0xff);
    }

    for (i = 0; i < need; i++) {
        out[i * 2]     = hex[(raw[i] >> 4) & 0x0f];
        out[i * 2 + 1] = hex[raw[i] & 0x0f];
    }
    out[need * 2] = '\0';
}

/* ------------------------------------------------------------------ SHA-256 */

typedef struct {
    uint32_t state[8];
    uint64_t bitlen;
    unsigned char data[64];
    size_t datalen;
} sha256_ctx;

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
#define CH(x,y,z)  (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x,y,z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0(x)     (ROTR(x,2) ^ ROTR(x,13) ^ ROTR(x,22))
#define EP1(x)     (ROTR(x,6) ^ ROTR(x,11) ^ ROTR(x,25))
#define SIG0(x)    (ROTR(x,7) ^ ROTR(x,18) ^ ((x) >> 3))
#define SIG1(x)    (ROTR(x,17) ^ ROTR(x,19) ^ ((x) >> 10))

static const uint32_t K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

static void sha256_transform(sha256_ctx *ctx, const unsigned char data[])
{
    uint32_t a, b, c, d, e, f, g, h, t1, t2, m[64];
    int i, j;

    for (i = 0, j = 0; i < 16; i++, j += 4)
        m[i] = (uint32_t)((data[j] << 24) | (data[j+1] << 16) | (data[j+2] << 8) | data[j+3]);
    for (; i < 64; i++)
        m[i] = SIG1(m[i-2]) + m[i-7] + SIG0(m[i-15]) + m[i-16];

    a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
    e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];

    for (i = 0; i < 64; i++) {
        t1 = h + EP1(e) + CH(e,f,g) + K[i] + m[i];
        t2 = EP0(a) + MAJ(a,b,c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void sha256_init(sha256_ctx *ctx)
{
    ctx->datalen = 0;
    ctx->bitlen = 0;
    ctx->state[0] = 0x6a09e667; ctx->state[1] = 0xbb67ae85;
    ctx->state[2] = 0x3c6ef372; ctx->state[3] = 0xa54ff53a;
    ctx->state[4] = 0x510e527f; ctx->state[5] = 0x9b05688c;
    ctx->state[6] = 0x1f83d9ab; ctx->state[7] = 0x5be0cd19;
}

static void sha256_update(sha256_ctx *ctx, const unsigned char *data, size_t len)
{
    size_t i;
    for (i = 0; i < len; i++) {
        ctx->data[ctx->datalen++] = data[i];
        if (ctx->datalen == 64) {
            sha256_transform(ctx, ctx->data);
            ctx->bitlen += 512;
            ctx->datalen = 0;
        }
    }
}

static void sha256_final(sha256_ctx *ctx, unsigned char hash[32])
{
    size_t i = ctx->datalen;

    if (ctx->datalen < 56) {
        ctx->data[i++] = 0x80;
        while (i < 56) ctx->data[i++] = 0x00;
    } else {
        ctx->data[i++] = 0x80;
        while (i < 64) ctx->data[i++] = 0x00;
        sha256_transform(ctx, ctx->data);
        memset(ctx->data, 0, 56);
    }

    ctx->bitlen += ctx->datalen * 8;
    for (i = 0; i < 8; i++)
        ctx->data[63 - i] = (unsigned char)(ctx->bitlen >> (i * 8));
    sha256_transform(ctx, ctx->data);

    for (i = 0; i < 4; i++) {
        int j;
        for (j = 0; j < 8; j++)
            hash[i + j * 4] = (unsigned char)((ctx->state[j] >> (24 - i * 8)) & 0xff);
    }
}

int sha256_iterated(const char *salt, const char *password, int iterations,
                    char *hex_out, size_t hex_len)
{
    static const char *hex = "0123456789abcdef";
    unsigned char digest[32];
    sha256_ctx ctx;
    int round, i;

    if (hex_len < 65) return -1;

    sha256_init(&ctx);
    sha256_update(&ctx, (const unsigned char *)salt, strlen(salt));
    sha256_update(&ctx, (const unsigned char *)password, strlen(password));
    sha256_final(&ctx, digest);

    for (round = 1; round < iterations; round++) {
        sha256_init(&ctx);
        sha256_update(&ctx, digest, sizeof(digest));
        sha256_update(&ctx, (const unsigned char *)salt, strlen(salt));
        sha256_final(&ctx, digest);
    }

    for (i = 0; i < 32; i++) {
        hex_out[i * 2]     = hex[(digest[i] >> 4) & 0x0f];
        hex_out[i * 2 + 1] = hex[digest[i] & 0x0f];
    }
    hex_out[64] = '\0';
    return 0;
}
