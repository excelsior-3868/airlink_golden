-- 008_device_gem_untagged_mode.sql
ALTER TABLE devices ADD COLUMN IF NOT EXISTS gem_port_untagged INT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS default_tag_mode VARCHAR(16) NOT NULL DEFAULT 'tagged';
