-- 010_device_default_profiles_untagged.sql: untagged-mode line / service profile IDs on an OLT device.
-- line_profile_id / srv_profile_id (009) are the tagged-mode pair.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS line_profile_id_untagged INT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS srv_profile_id_untagged INT NULL;
