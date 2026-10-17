-- Migration 011: Link Resellers to OLTs and assign Reseller ownership to registered ONTs

CREATE TABLE IF NOT EXISTS olt_resellers (
    olt_id      BIGINT UNSIGNED NOT NULL,
    reseller_id BIGINT UNSIGNED NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (olt_id, reseller_id),
    INDEX olt_resellers_reseller_idx (reseller_id),
    FOREIGN KEY (olt_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (reseller_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ont_inventory
    ADD COLUMN reseller_id BIGINT UNSIGNED NULL AFTER olt_id,
    ADD INDEX ont_inventory_reseller_idx (reseller_id),
    ADD FOREIGN KEY (reseller_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE provisioning_jobs
    ADD COLUMN reseller_id BIGINT UNSIGNED NULL AFTER olt_id,
    ADD INDEX prov_jobs_reseller_idx (reseller_id),
    ADD FOREIGN KEY (reseller_id) REFERENCES users(id) ON DELETE SET NULL;

-- Initial seeding: link known OLTs to their respective resellers
-- Bijule-OLT (1) -> chatra (5)
-- UdaypurNetwork-OLT-Simpson (2) -> udn (2)
-- HalesiNetwork-OLT-Rupendra (3) -> Halesicable (3)
INSERT IGNORE INTO olt_resellers (olt_id, reseller_id) VALUES
    (1, 5),
    (2, 2),
    (3, 3);

-- Backfill ONT ownership from matching PPPoE subscriber records
UPDATE ont_inventory oi
JOIN pppoe_customers pc ON pc.onu_serial_number = oi.serial_number
SET oi.reseller_id = pc.reseller_id
WHERE pc.reseller_id IS NOT NULL;

-- Backfill remaining existing ONTs based on designated OLT assignment
UPDATE ont_inventory SET reseller_id = 5 WHERE olt_id = 1 AND reseller_id IS NULL;
UPDATE ont_inventory SET reseller_id = 2 WHERE olt_id = 2 AND reseller_id IS NULL;
UPDATE ont_inventory SET reseller_id = 3 WHERE olt_id = 3 AND reseller_id IS NULL;
