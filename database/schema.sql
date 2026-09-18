-- =============================================================================
-- Employee Profile Management System — relational schema (PostgreSQL)
--
--   psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -f schema.sql
--
-- The backend reaches these tables only through backend/database/db.c, so the
-- storage engine can change without touching route or authentication code.
-- Every statement the C code issues must use parameters ($1, $2 ...) rather
-- than string concatenation; that is what keeps SQL injection out.
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------- departments
CREATE TABLE IF NOT EXISTS departments (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(16)  NOT NULL UNIQUE,
    name        VARCHAR(128) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- employees
CREATE TABLE IF NOT EXISTS employees (
    id                              BIGSERIAL PRIMARY KEY,
    employee_id                     VARCHAR(32)  NOT NULL UNIQUE,
    first_name                      VARCHAR(128) NOT NULL,
    middle_name                     VARCHAR(128),
    last_name                       VARCHAR(128) NOT NULL,
    date_of_birth                   DATE         NOT NULL,
    gender                          VARCHAR(32)  NOT NULL,
    email                           VARCHAR(255) NOT NULL UNIQUE,
    contact_number                  VARCHAR(64)  NOT NULL,
    address                         TEXT         NOT NULL,
    position                        VARCHAR(128) NOT NULL,
    department_id                   INTEGER      NOT NULL REFERENCES departments(id),
    employment_status               VARCHAR(32)  NOT NULL
        CHECK (employment_status IN ('Active', 'On Leave', 'Inactive')),
    date_hired                      DATE         NOT NULL,
    photo_url                       VARCHAR(512),
    emergency_contact_name          VARCHAR(128) NOT NULL,
    emergency_contact_relationship  VARCHAR(64),
    emergency_contact_number        VARCHAR(64)  NOT NULL,
    is_deleted                      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT employees_hired_after_birth CHECK (date_hired > date_of_birth)
);

CREATE INDEX IF NOT EXISTS employees_last_name_idx  ON employees (lower(last_name));
CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department_id);
CREATE INDEX IF NOT EXISTS employees_status_idx     ON employees (employment_status);
CREATE INDEX IF NOT EXISTS employees_active_idx     ON employees (is_deleted) WHERE is_deleted = FALSE;

-- --------------------------------------------------------------------- users
-- Login accounts. An administrator account does not have to be linked to an
-- employee record, which is why employee_id is nullable.
CREATE TABLE IF NOT EXISTS users (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(64)  NOT NULL UNIQUE,
    display_name        VARCHAR(128) NOT NULL,
    employee_id         VARCHAR(32)  REFERENCES employees(employee_id) ON DELETE SET NULL,
    role                VARCHAR(16)  NOT NULL CHECK (role IN ('admin', 'employee')),
    -- Format: algorithm$iterations$salt$digest. Never a clear-text password.
    password_hash       VARCHAR(255) NOT NULL,
    -- Base32 TOTP secret, encrypted at rest by the application key.
    totp_secret         VARCHAR(255),
    permissions         TEXT         NOT NULL DEFAULT '',
    failed_attempts     INTEGER      NOT NULL DEFAULT 0,
    lockout_until       TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role) WHERE is_active;

-- ------------------------------------------------------------------ sessions
-- One row per signed-in browser. two_factor_passed stays FALSE between the
-- credential check and the verification code, so a half-finished login can
-- open nothing.
CREATE TABLE IF NOT EXISTS sessions (
    token               CHAR(64)    PRIMARY KEY,
    user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    two_factor_passed   BOOLEAN     NOT NULL DEFAULT FALSE,
    two_factor_attempts INTEGER     NOT NULL DEFAULT 0,
    permissions_checked BOOLEAN     NOT NULL DEFAULT FALSE,
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx  ON sessions (expires_at);

-- --------------------------------------------------------------- audit_logs
-- Append only. Nothing in the application updates or deletes these rows.
CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL   PRIMARY KEY,
    actor       VARCHAR(64) NOT NULL,
    action      VARCHAR(64) NOT NULL,
    target      VARCHAR(64),
    detail      TEXT,
    ip_address  INET,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_time_idx  ON audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor);

-- ------------------------------------------------------- updated_at trigger
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS employees_touch ON employees;
CREATE TRIGGER employees_touch BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -------------------------------------------------------------- least access
-- The application role can read and write rows but cannot alter the schema,
-- and it is never the database owner.
--   CREATE ROLE app_user LOGIN PASSWORD 'set-in-the-environment';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
--   REVOKE UPDATE, DELETE ON audit_logs FROM app_user;

COMMIT;
