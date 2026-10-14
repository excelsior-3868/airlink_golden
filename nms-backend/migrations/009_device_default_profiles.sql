-- 009_device_default_profiles.sql: default line / service profile IDs configured on an OLT device for ONT provisioning
ALTER TABLE devices ADD COLUMN IF NOT EXISTS line_profile_id INT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS srv_profile_id INT NULL;
