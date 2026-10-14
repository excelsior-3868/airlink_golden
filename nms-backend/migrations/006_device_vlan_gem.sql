-- 006_device_vlan_gem.sql: default VLAN and GEM port configured on network devices (OLT) for ONT provisioning
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vlan INT NULL;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS gem_port INT NULL;
UPDATE devices SET vlan = 100, gem_port = 1 WHERE role = 'olt' AND vlan IS NULL;
