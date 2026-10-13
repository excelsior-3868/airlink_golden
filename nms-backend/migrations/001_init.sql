-- MariaDB 11 migration for NMS. Applied at boot by internal/db.Migrate.

CREATE TABLE IF NOT EXISTS pops (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL UNIQUE,
    location    VARCHAR(255) NOT NULL DEFAULT '',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(191) NOT NULL UNIQUE,
    ip              VARCHAR(64) NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'access',
    vendor          VARCHAR(64) NOT NULL DEFAULT '',
    pop_id          BIGINT UNSIGNED NULL,
    parent_id       BIGINT UNSIGNED NULL,
    poll_method     VARCHAR(16) NOT NULL DEFAULT 'snmp',
    snmp_version    VARCHAR(8) NOT NULL DEFAULT '2c',
    snmp_port       INT NOT NULL DEFAULT 161,
    tcp_port        INT NOT NULL DEFAULT 22,
    credential_ref  VARCHAR(128) NOT NULL DEFAULT '',
    poller_id       VARCHAR(64) NOT NULL DEFAULT 'central',
    enabled         TINYINT(1) NOT NULL DEFAULT 1,
    status          VARCHAR(16) NOT NULL DEFAULT 'unknown',
    status_since    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_polled_at  DATETIME NULL,
    sys_descr       TEXT NOT NULL,
    uptime_seconds  BIGINT NULL,
    cpu_pct         DOUBLE NULL,
    mem_pct         DOUBLE NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX devices_pop_idx (pop_id),
    INDEX devices_parent_idx (parent_id),
    FOREIGN KEY (pop_id) REFERENCES pops(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES devices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interfaces (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    device_id       BIGINT UNSIGNED NOT NULL,
    if_index        INT NOT NULL,
    name            VARCHAR(191) NOT NULL,
    alias           VARCHAR(255) NOT NULL DEFAULT '',
    speed_bps       BIGINT NOT NULL DEFAULT 0,
    monitored       TINYINT(1) NOT NULL DEFAULT 0,
    oper_status     VARCHAR(32) NOT NULL DEFAULT 'unknown',
    in_bps          DOUBLE NULL,
    out_bps         DOUBLE NULL,
    util_pct        DOUBLE NULL,
    in_errors       BIGINT NOT NULL DEFAULT 0,
    out_errors      BIGINT NOT NULL DEFAULT 0,
    last_in_octets  DECIMAL(38,0) NULL,
    last_out_octets DECIMAL(38,0) NULL,
    last_sample_at  DATETIME NULL,
    UNIQUE KEY uq_dev_if (device_id, if_index),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS metrics (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    device_id    BIGINT UNSIGNED NOT NULL,
    interface_id BIGINT UNSIGNED NULL,
    name         VARCHAR(64) NOT NULL,
    value        DOUBLE NOT NULL,
    INDEX metrics_lookup_idx (device_id, name, ts DESC),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (interface_id) REFERENCES interfaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contacts (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL UNIQUE,
    phone       VARCHAR(64) NOT NULL DEFAULT '',
    email       VARCHAR(191) NOT NULL DEFAULT '',
    push_token  VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_groups (
    id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name    VARCHAR(191) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id   BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (group_id, contact_id),
    FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS escalation_policies (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL UNIQUE,
    severity    VARCHAR(8) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS escalation_steps (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    policy_id     BIGINT UNSIGNED NOT NULL,
    after_minutes INT NOT NULL,
    channel       VARCHAR(32) NOT NULL,
    group_id      BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY uq_esc_step (policy_id, after_minutes, channel, group_id),
    FOREIGN KEY (policy_id) REFERENCES escalation_policies(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_rules (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL UNIQUE,
    metric      VARCHAR(64) NOT NULL,
    severity    VARCHAR(8) NOT NULL,
    op          VARCHAR(4) NOT NULL DEFAULT '>',
    threshold   DOUBLE NOT NULL DEFAULT 0,
    for_samples INT NOT NULL DEFAULT 3,
    role_filter VARCHAR(32) NOT NULL DEFAULT '',
    enabled     TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerts (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dedup_key        VARCHAR(191) NOT NULL,
    active_dedup_key VARCHAR(191) AS (IF(state <> 'resolved', dedup_key, NULL)) PERSISTENT,
    rule_id          BIGINT UNSIGNED NULL,
    device_id        BIGINT UNSIGNED NULL,
    severity         VARCHAR(8) NOT NULL,
    title            VARCHAR(255) NOT NULL,
    detail           TEXT NOT NULL,
    state            VARCHAR(16) NOT NULL DEFAULT 'open',
    suppressed_by    BIGINT UNSIGNED NULL,
    breach_count     INT NOT NULL DEFAULT 0,
    opened_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    escalation_base  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at  DATETIME NULL,
    acknowledged_by  VARCHAR(128) NULL,
    resolved_at      DATETIME NULL,
    resolution_note  TEXT NOT NULL,
    UNIQUE KEY alerts_live_dedup_idx (active_dedup_key),
    INDEX alerts_state_idx (state, severity),
    FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (suppressed_by) REFERENCES alerts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    alert_id    BIGINT UNSIGNED NOT NULL,
    step_id     BIGINT UNSIGNED NULL,
    channel     VARCHAR(32) NOT NULL,
    recipient   VARCHAR(191) NOT NULL,
    status      VARCHAR(16) NOT NULL,
    error       TEXT NOT NULL,
    sent_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_notif (alert_id, step_id, recipient),
    FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id) REFERENCES escalation_steps(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olts (
    device_id        BIGINT UNSIGNED PRIMARY KEY,
    software_version VARCHAR(128) NOT NULL DEFAULT '',
    ssh_port         INT NOT NULL DEFAULT 22,
    ssh_host_key     TEXT NOT NULL,
    pon_ports        TEXT NOT NULL,
    detected_version VARCHAR(128) NOT NULL DEFAULT '',
    detected_patch   VARCHAR(128) NOT NULL DEFAULT '',
    last_sync_at     DATETIME NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_profiles (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    olt_id          BIGINT UNSIGNED NOT NULL,
    profile_type    VARCHAR(16) NOT NULL,
    profile_id      INT NOT NULL,
    profile_name    VARCHAR(128) NOT NULL DEFAULT '',
    config_hash     VARCHAR(64) NOT NULL DEFAULT '',
    verified_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    binding_times   INT NULL,
    detail          TEXT NOT NULL,
    UNIQUE KEY uq_olt_prof (olt_id, profile_type, profile_id),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_templates (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(191) NOT NULL UNIQUE,
    service_vlan    INT NOT NULL,
    user_vlan       INT NOT NULL,
    gem_index       INT NOT NULL,
    tag_transform   VARCHAR(32) NOT NULL DEFAULT 'translate',
    line_profile_id INT NOT NULL,
    srv_profile_id  INT NOT NULL,
    enabled         TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ont_inventory (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    serial_number   VARCHAR(191) NOT NULL UNIQUE,
    olt_id          BIGINT UNSIGNED NOT NULL,
    frame           INT NOT NULL DEFAULT 0,
    slot            INT NOT NULL,
    pon_port        INT NOT NULL,
    ont_id          INT NOT NULL,
    description     VARCHAR(255) NOT NULL DEFAULT '',
    line_profile_id INT NULL,
    srv_profile_id  INT NULL,
    run_state       VARCHAR(32) NOT NULL DEFAULT 'unknown',
    config_state    VARCHAR(32) NOT NULL DEFAULT 'unknown',
    match_state     VARCHAR(32) NOT NULL DEFAULT 'unknown',
    rx_power_dbm    DOUBLE NULL,
    last_seen_at    DATETIME NULL,
    UNIQUE KEY uq_olt_ont_loc (olt_id, frame, slot, pon_port, ont_id),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ont_observed_state (
    ont_inventory_id BIGINT UNSIGNED PRIMARY KEY,
    observed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observed_config LONGTEXT NOT NULL,
    config_hash     VARCHAR(64) NOT NULL DEFAULT '',
    drift_status    VARCHAR(32) NOT NULL DEFAULT 'unknown',
    FOREIGN KEY (ont_inventory_id) REFERENCES ont_inventory(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provisioning_jobs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    olt_id          BIGINT UNSIGNED NOT NULL,
    operation       VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(191) NOT NULL UNIQUE,
    params          LONGTEXT NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'planned',
    requested_by    VARCHAR(128) NOT NULL,
    approved_by     VARCHAR(128) NULL,
    before_state    TEXT NOT NULL,
    error_summary   TEXT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME NULL,
    completed_at    DATETIME NULL,
    saved_at        DATETIME NULL,
    saved_by        VARCHAR(128) NULL,
    save_output     TEXT NOT NULL,
    FOREIGN KEY (olt_id) REFERENCES olts(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provisioning_job_steps (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id           BIGINT UNSIGNED NOT NULL,
    seq              INT NOT NULL,
    name             VARCHAR(64) NOT NULL DEFAULT '',
    kind             VARCHAR(32) NOT NULL,
    expect           TEXT NOT NULL,
    command          TEXT NOT NULL,
    rollback_command TEXT NOT NULL,
    result           VARCHAR(32) NOT NULL DEFAULT 'pending',
    output           LONGTEXT NOT NULL,
    executed_at      DATETIME NULL,
    plan_result      VARCHAR(32) NOT NULL DEFAULT '',
    plan_output      LONGTEXT NOT NULL,
    UNIQUE KEY uq_job_step (job_id, seq),
    FOREIGN KEY (job_id) REFERENCES provisioning_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor       VARCHAR(128) NOT NULL,
    action      VARCHAR(64) NOT NULL,
    target      VARCHAR(255) NOT NULL DEFAULT '',
    detail      TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_snapshots (
    olt_id       BIGINT UNSIGNED NOT NULL,
    command      VARCHAR(255) NOT NULL,
    output       LONGTEXT NOT NULL,
    error        TEXT NOT NULL,
    collected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (olt_id, command),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_boards (
    olt_id      BIGINT UNSIGNED NOT NULL,
    slot        INT NOT NULL,
    board_name  VARCHAR(64) NOT NULL,
    status      VARCHAR(32) NOT NULL DEFAULT '',
    PRIMARY KEY (olt_id, slot),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_vlans (
    olt_id      BIGINT UNSIGNED NOT NULL,
    vlan_id     INT NOT NULL,
    vlan_type   VARCHAR(32) NOT NULL DEFAULT '',
    attribute   VARCHAR(32) NOT NULL DEFAULT '',
    std_ports   INT NOT NULL DEFAULT 0,
    serv_ports  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (olt_id, vlan_id),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_service_ports (
    olt_id      BIGINT UNSIGNED NOT NULL,
    sp_index    INT NOT NULL,
    vlan        INT NOT NULL,
    attribute   VARCHAR(32) NOT NULL DEFAULT '',
    frame       INT NOT NULL,
    slot        INT NOT NULL,
    port        INT NOT NULL,
    ont_id      INT NOT NULL,
    gem         INT NOT NULL,
    flow_type   VARCHAR(32) NOT NULL DEFAULT '',
    flow_para   VARCHAR(32) NOT NULL DEFAULT '',
    state       VARCHAR(32) NOT NULL DEFAULT '',
    PRIMARY KEY (olt_id, sp_index),
    INDEX olt_service_ports_ont_idx (olt_id, frame, slot, port, ont_id),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS olt_sync_runs (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    olt_id       BIGINT UNSIGNED NOT NULL,
    started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at  DATETIME NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'running',
    triggered_by VARCHAR(128) NOT NULL,
    counts       LONGTEXT NOT NULL,
    error        TEXT NOT NULL,
    INDEX olt_sync_runs_idx (olt_id, id DESC),
    FOREIGN KEY (olt_id) REFERENCES olts(device_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seeds
INSERT IGNORE INTO alert_rules (name, metric, severity, op, threshold, for_samples, role_filter) VALUES
 ('Core device down',        'device_down', 'P1', '>', 0,  2, 'core'),
 ('Aggregation device down', 'device_down', 'P2', '>', 0,  2, 'aggregation'),
 ('Access device down',      'device_down', 'P3', '>', 0,  4, 'access'),
 ('OLT down',                'device_down', 'P1', '>', 0,  2, 'olt'),
 ('Radio down',              'device_down', 'P3', '>', 0,  3, 'radio'),
 ('Interface util warning',  'if_util',     'P3', '>', 80, 3, ''),
 ('Interface util major',    'if_util',     'P2', '>', 90, 3, ''),
 ('Interface util critical', 'if_util',     'P1', '>', 95, 3, ''),
 ('CPU high',                'cpu',         'P3', '>', 90, 3, ''),
 ('Memory high',             'mem',         'P3', '>', 90, 3, ''),
 ('Uplink interface down',   'if_down',     'P2', '>', 0,  2, ''),
 ('ONT offline',             'ont_offline', 'P3', '>', 0,  2, 'olt'),
 ('ONT Rx power low',        'ont_rx_low',  'P3', '<', -27, 2, 'olt');

INSERT IGNORE INTO contact_groups (name) VALUES ('NOC Primary'), ('NOC Backup'), ('NOC Manager');
INSERT IGNORE INTO escalation_policies (name, severity) VALUES ('P1 default','P1'), ('P2 default','P2'), ('P3 default','P3');

INSERT IGNORE INTO escalation_steps (policy_id, after_minutes, channel, group_id)
SELECT p.id, s.m, s.ch, g.id FROM escalation_policies p
 JOIN (
    SELECT 'P1' AS sev, 0 AS m, 'push' AS ch, 'NOC Primary' AS grp UNION ALL
    SELECT 'P1', 0, 'sms', 'NOC Primary' UNION ALL
    SELECT 'P1', 2, 'push', 'NOC Primary' UNION ALL
    SELECT 'P1', 5, 'voice', 'NOC Primary' UNION ALL
    SELECT 'P1', 10, 'voice', 'NOC Backup' UNION ALL
    SELECT 'P1', 15, 'sms', 'NOC Manager' UNION ALL
    SELECT 'P2', 0, 'push', 'NOC Primary' UNION ALL
    SELECT 'P2', 0, 'sms', 'NOC Primary' UNION ALL
    SELECT 'P2', 15, 'voice', 'NOC Primary' UNION ALL
    SELECT 'P3', 0, 'push', 'NOC Primary'
 ) s ON s.sev = p.severity
 JOIN contact_groups g ON g.name = s.grp;
