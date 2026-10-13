-- 005_olt_login.sql: per-OLT management protocol and credentials entered from the frontend.
ALTER TABLE olts ADD COLUMN IF NOT EXISTS protocol VARCHAR(8) NOT NULL DEFAULT 'ssh';
ALTER TABLE olts ADD COLUMN IF NOT EXISTS login_user VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE olts ADD COLUMN IF NOT EXISTS login_pass_enc TEXT NULL;
