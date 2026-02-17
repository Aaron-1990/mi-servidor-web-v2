/**
 * HourlyMetricsRepository
 * 
 * Encapsulates SQL queries for hourly piece count data from raw_scans.
 * Follows same pattern as RawScanRepository - class-based with injected pool.
 * 
 * WHY separate from RawScanRepository: Single Responsibility.
 * RawScan handles insert/read of raw data; this handles analytical aggregations.
 * When we add daily/weekly summaries or ML features, this class scales naturally.
 */
const logger = require('../../../config/logger');

class HourlyMetricsRepository {

    /**
     * @param {import('pg').Pool} dbPool - PostgreSQL connection pool
     */
    constructor(dbPool) {
        this.pool = dbPool;
    }

    /**
     * Get piece count grouped by hour for a specific equipment and date.
     * Only counts COMPLETION events (BCMP/Processed/COMPLETE) to avoid
     * double-counting BREQ (entry) events on BREQ_BCMP equipment.
     * 
     * @param {string} equipmentId - Equipment identifier
     * @param {string|null} targetDate - ISO date string "YYYY-MM-DD", null = today
     * @returns {Promise<Array<{hour: number, pieces_ok: number, pieces_ng: number}>>}
     */
    async getHourlyPieceCount(equipmentId, targetDate = null) {
        const query = `
            SELECT
                EXTRACT(HOUR FROM scanned_at)::integer AS hour,
                COUNT(*) FILTER (
                    WHERE status NOT ILIKE '%NG%' 
                      AND status NOT ILIKE '%FAIL%'
                ) AS pieces_ok,
                COUNT(*) FILTER (
                    WHERE status ILIKE '%NG%' 
                       OR status ILIKE '%FAIL%'
                ) AS pieces_ng
            FROM raw_scans
            WHERE equipment_id = $1
              AND scanned_at::date = COALESCE($2::date, CURRENT_DATE)
              AND (
                  status ILIKE 'BCMP%'
                  OR status ILIKE '%Processed%'
                  OR status ILIKE '%COMPLETE%'
              )
            GROUP BY EXTRACT(HOUR FROM scanned_at)
            ORDER BY hour
        `;

        const result = await this.pool.query(query, [equipmentId, targetDate]);
        return result.rows;
    }

    /**
     * Get individual raw scan records for a specific equipment, date, and hour.
     * Returns the actual evidence behind each hourly bar in the dashboard.
     * 
     * WHY this method: Full traceability - every KPI traces back to raw data.
     * Critical for manufacturing audits and root cause analysis.
     * 
     * @param {string} equipmentId
     * @param {number} hour - 0-23
     * @param {string|null} targetDate - "YYYY-MM-DD" or null for today
     * @returns {Promise<Array<{serial_number, status, scanned_at}>>}
     */
    async getScansForHour(equipmentId, hour, targetDate = null) {
        const query = `
            SELECT
                serial_number,
                status,
                scanned_at,
                TO_CHAR(scanned_at, 'HH24:MI:SS') as scan_time
            FROM raw_scans
            WHERE equipment_id = $1
              AND scanned_at::date = COALESCE($2::date, CURRENT_DATE)
              AND EXTRACT(HOUR FROM scanned_at) = $3
              AND (
                  status ILIKE 'BCMP%'
                  OR status ILIKE '%Processed%'
                  OR status ILIKE '%COMPLETE%'
              )
            ORDER BY scanned_at ASC
        `;

        const result = await this.pool.query(query, [equipmentId, targetDate, hour]);
        return result.rows;
    }

    /**
     * Verify and create performance index if it doesn't exist.
     * Critical for queries filtering by equipment_id + scanned_at range.
     * 
     * @returns {Promise<boolean>} true if index was created, false if already existed
     */
    async ensureIndex() {
        const checkQuery = `
            SELECT 1 FROM pg_indexes 
            WHERE indexname = 'idx_raw_scans_equip_time'
        `;
        const exists = await this.pool.query(checkQuery);

        if (exists.rows.length === 0) {
            logger.info('Creating index idx_raw_scans_equip_time on raw_scans...');
            await this.pool.query(`
                CREATE INDEX idx_raw_scans_equip_time 
                ON raw_scans (equipment_id, scanned_at)
            `);
            logger.info('Index idx_raw_scans_equip_time created successfully');
            return true;
        }

        logger.debug('Index idx_raw_scans_equip_time already exists');
        return false;
    }
}

module.exports = HourlyMetricsRepository;

