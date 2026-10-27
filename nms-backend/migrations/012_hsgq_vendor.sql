-- Migration 012: OLT driver follows the device's Hardware Vendor field (Huawei or HSGQ).
-- OLTs added before the field was used for routing: tag the HSGQ ones so sync uses the HSGQ driver.
UPDATE devices SET vendor = 'HSGQ' WHERE role = 'olt' AND vendor = '' AND LOWER(name) LIKE '%hsgq%';
