-- =============================================================================
-- Development seed data.
--
--   psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -f seed.sql
--
-- Employee rows are sample data and safe to load anywhere. Login accounts are
-- deliberately left WITHOUT a usable password: this file contains no password
-- hash, so no account here can sign in until someone sets one. Create the
-- first real account with the backend helper instead:
--
--   ./backend/build/epms-server --help        # shows the environment it reads
--   EPMS_SEED_PASSWORD='choose-a-long-one' ./backend/build/epms-server
--
-- which hashes the value at start-up and never writes it to disk.
-- =============================================================================

BEGIN;

INSERT INTO departments (code, name) VALUES
    ('ENG', 'Engineering'),
    ('HR',  'Human Resources'),
    ('FIN', 'Finance'),
    ('OPS', 'Operations'),
    ('SAL', 'Sales')
ON CONFLICT (code) DO NOTHING;

INSERT INTO employees (
    employee_id, first_name, middle_name, last_name, date_of_birth, gender,
    email, contact_number, address, position, department_id, employment_status,
    date_hired, emergency_contact_name, emergency_contact_relationship,
    emergency_contact_number
) VALUES
    ('EMP-1001', 'Alia', 'Reyes', 'Navarro', '1994-03-11', 'Female',
     'alia.navarro@northline.example', '+63 917 555 0101', '120 Katipunan Ave, Quezon City',
     'Backend Engineer', (SELECT id FROM departments WHERE code = 'ENG'), 'Active',
     '2021-06-14', 'Elena Navarro', 'Mother', '+63 918 555 0201'),

    ('EMP-1002', 'Marcus', 'T.', 'Oyelaran', '1988-11-02', 'Male',
     'marcus.oyelaran@northline.example', '+63 917 555 0102', '14 Scout Borromeo, Quezon City',
     'Engineering Manager', (SELECT id FROM departments WHERE code = 'ENG'), 'Active',
     '2019-02-04', 'Bisi Oyelaran', 'Sister', '+63 918 555 0202'),

    ('EMP-1003', 'Marisol', NULL, 'Ferrer', '1985-07-23', 'Female',
     'marisol.ferrer@northline.example', '+63 917 555 0103', '88 Maginhawa St, Quezon City',
     'HR Director', (SELECT id FROM departments WHERE code = 'HR'), 'Active',
     '2017-09-18', 'Paulo Ferrer', 'Spouse', '+63 918 555 0203'),

    ('EMP-1004', 'Priya', 'K.', 'Raman', '1996-01-30', 'Female',
     'priya.raman@northline.example', '+63 917 555 0104', '9 Sgt Esguerra Ave, Quezon City',
     'Financial Analyst', (SELECT id FROM departments WHERE code = 'FIN'), 'Active',
     '2022-03-07', 'Anil Raman', 'Father', '+63 918 555 0204'),

    ('EMP-1005', 'Teodoro', 'L.', 'Vasquez', '1991-05-19', 'Male',
     'teodoro.vasquez@northline.example', '+63 917 555 0105', '41 Mother Ignacia Ave, Quezon City',
     'Logistics Coordinator', (SELECT id FROM departments WHERE code = 'OPS'), 'Active',
     '2020-08-24', 'Mila Vasquez', 'Spouse', '+63 918 555 0205'),

    ('EMP-1006', 'Hana', NULL, 'Sugimoto', '1993-09-08', 'Female',
     'hana.sugimoto@northline.example', '+63 917 555 0106', '3 Timog Ave, Quezon City',
     'Account Executive', (SELECT id FROM departments WHERE code = 'SAL'), 'On Leave',
     '2021-01-11', 'Kenji Sugimoto', 'Brother', '+63 918 555 0206'),

    ('EMP-1010', 'Ines', 'B.', 'Delacroix', '1987-02-14', 'Female',
     'ines.delacroix@northline.example', '+63 917 555 0110', '77 West Ave, Quezon City',
     'Payroll Specialist', (SELECT id FROM departments WHERE code = 'FIN'), 'Inactive',
     '2015-07-01', 'Paul Delacroix', 'Spouse', '+63 918 555 0210')
ON CONFLICT (employee_id) DO NOTHING;

-- Login accounts with no usable password. '!' is not a valid hash for any
-- algorithm, so auth_verify_password() rejects every attempt until a real
-- hash replaces it.
INSERT INTO users (username, display_name, employee_id, role, password_hash, permissions) VALUES
    ('ADM-0001', 'Marisol Ferrer', 'EMP-1003', 'admin', '!',
     'employees:manage employees:read reports:read audit:read'),
    ('ADM-0002', 'Ruben Caltrider', NULL, 'admin', '!',
     'employees:read'),
    ('EMP-1001', 'Alia Navarro', 'EMP-1001', 'employee', '!',
     'self:read self:update')
ON CONFLICT (username) DO NOTHING;

COMMIT;
