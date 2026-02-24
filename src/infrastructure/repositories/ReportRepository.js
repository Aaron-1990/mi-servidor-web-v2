const { pool } = require('../../../config/database');
const logger = require('../../../config/logger');

class ReportRepository {

    // Get shift definitions for a production line
    async getShiftDefinitions(lineCode) {
        const query = `
            SELECT sd.shift_number, sd.shift_name, sd.start_time, sd.end_time, sd.crosses_midnight
            FROM shift_definitions sd
            JOIN production_lines pl ON sd.line_id = pl.id
            WHERE pl.line_code = $1 AND sd.is_active = true
            ORDER BY sd.shift_number
        `;
        const result = await pool.query(query, [lineCode]);
        return result.rows;
    }

    // Get production day start hour from first shift
    async getProductionDayStart(lineCode) {
        const shifts = await this.getShiftDefinitions(lineCode);
        if (shifts.length === 0) return '07:00:00';
        return shifts[0].start_time;
    }

    // Hourly output for a production day (7am-7am) with optional time range
    // options: { startTime: 'HH:MM', endTime: 'HH:MM' }
    async getHourlyOutput(lineCode, date, options = {}) {
        const dayStart = await this.getProductionDayStart(lineCode);
        const dayStartHour = dayStart.split(':')[0];

        let rangeStart, rangeEnd;

        if (options.startTime && options.endTime) {
            // Custom range mode
            const startHH = parseInt(options.startTime.split(':')[0]);
            const endHH = parseInt(options.endTime.split(':')[0]);
            const endMM = parseInt(options.endTime.split(':')[1] || '0');
            const dayStartInt = parseInt(dayStartHour);

            // Determine if start is on the base date or next day
            rangeStart = startHH >= dayStartInt
                ? `${date} ${options.startTime}:00`
                : `${date}::date + INTERVAL '1 day' + INTERVAL '${startHH} hours' + INTERVAL '${parseInt(options.startTime.split(':')[1] || 0)} minutes'`;

            // Simple: both relative to production day
            if (startHH >= dayStartInt) {
                rangeStart = `${date} ${options.startTime}:00`;
            } else {
                // Early morning hours belong to next calendar day
                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);
                const nextDateStr = nextDate.toISOString().split('T')[0];
                rangeStart = `${nextDateStr} ${options.startTime}:00`;
            }

            if (endHH >= dayStartInt) {
                rangeEnd = `${date} ${options.endTime}:00`;
            } else {
                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);
                const nextDateStr = nextDate.toISOString().split('T')[0];
                rangeEnd = `${nextDateStr} ${options.endTime}:00`;
            }
        } else {
            // Full production day mode: 7am to 7am next day
            rangeStart = `${date} ${dayStart}`;
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            const nextDateStr = nextDate.toISOString().split('T')[0];
            rangeEnd = `${nextDateStr} ${dayStart}`;
        }

        const query = `
            SELECT
                rs.equipment_id,
                ed.equipment_name,
                ed.process_name,
                lp.process_order,
                EXTRACT(HOUR FROM rs.scanned_at) AS hour,
                EXTRACT(MINUTE FROM rs.scanned_at) AS minute_bucket,
                COUNT(*) FILTER (WHERE rs.status IN ('BCMP OK', 'Processed OK', 'BCMP')) AS pieces_ok,
                COUNT(*) FILTER (WHERE rs.status = 'BCMP NG') AS pieces_ng
            FROM raw_scans rs
            JOIN line_processes lp ON rs.equipment_id = lp.equipment_id
            JOIN production_lines pl ON lp.line_id = pl.id
            JOIN equipment_design ed ON rs.equipment_id = ed.equipment_id
            WHERE pl.line_code = $1
              AND rs.scanned_at >= $2::timestamp
              AND rs.scanned_at < $3::timestamp
              AND rs.status IN ('BCMP OK', 'Processed OK', 'BCMP', 'BCMP NG')
            GROUP BY rs.equipment_id, ed.equipment_name, ed.process_name, lp.process_order,
                     EXTRACT(HOUR FROM rs.scanned_at), EXTRACT(MINUTE FROM rs.scanned_at)
            ORDER BY lp.process_order, rs.equipment_id, hour, minute_bucket
        `;

        logger.info(`Report query: ${lineCode}, range: ${rangeStart} to ${rangeEnd}`);
        const result = await pool.query(query, [lineCode, rangeStart, rangeEnd]);
        return result.rows;
    }

    // Monthly output: equipment x day totals
    async getMonthlyOutput(lineCode, year, month) {
        const dayStart = await this.getProductionDayStart(lineCode);
        const dayStartHour = parseInt(dayStart.split(':')[0]);

        // Production month: day 1 at 7am to last day+1 at 7am
        const startDate = `${year}-${String(month).padStart(2, '0')}-01 ${dayStart}`;
        const lastDay = new Date(year, month, 0).getDate();
        const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endDate = `${nextMonth} ${dayStart}`;

        const query = `
            SELECT
                rs.equipment_id,
                ed.equipment_name,
                ed.process_name,
                lp.process_order,
                (CASE
                    WHEN EXTRACT(HOUR FROM rs.scanned_at) >= $4
                    THEN rs.scanned_at::date
                    ELSE rs.scanned_at::date - INTERVAL '1 day'
                END)::date AS production_date,
                COUNT(*) FILTER (WHERE rs.status IN ('BCMP OK', 'Processed OK', 'BCMP')) AS pieces_ok,
                COUNT(*) FILTER (WHERE rs.status = 'BCMP NG') AS pieces_ng
            FROM raw_scans rs
            JOIN line_processes lp ON rs.equipment_id = lp.equipment_id
            JOIN production_lines pl ON lp.line_id = pl.id
            JOIN equipment_design ed ON rs.equipment_id = ed.equipment_id
            WHERE pl.line_code = $1
              AND rs.scanned_at >= $2::timestamp
              AND rs.scanned_at < $3::timestamp
              AND rs.status IN ('BCMP OK', 'Processed OK', 'BCMP', 'BCMP NG')
            GROUP BY rs.equipment_id, ed.equipment_name, ed.process_name, lp.process_order, production_date
            ORDER BY lp.process_order, rs.equipment_id, production_date
        `;

        logger.info(`Monthly report: ${lineCode}, ${year}-${month}`);
        const result = await pool.query(query, [lineCode, startDate, endDate, dayStartHour]);
        return result.rows;
    }

    // Available dates that have data (for date picker)
    async getAvailableDates(lineCode) {
        const dayStart = await this.getProductionDayStart(lineCode);
        const dayStartHour = parseInt(dayStart.split(':')[0]);

        const query = `
            SELECT DISTINCT
                (CASE
                    WHEN EXTRACT(HOUR FROM rs.scanned_at) >= $2
                    THEN rs.scanned_at::date
                    ELSE rs.scanned_at::date - INTERVAL '1 day'
                END)::date AS production_date
            FROM raw_scans rs
            JOIN line_processes lp ON rs.equipment_id = lp.equipment_id
            JOIN production_lines pl ON lp.line_id = pl.id
            WHERE pl.line_code = $1
              AND rs.status IN ('BCMP OK', 'Processed OK', 'BCMP', 'BCMP NG')
            ORDER BY production_date DESC
            LIMIT 90
        `;

        const result = await pool.query(query, [lineCode, dayStartHour]);
        return result.rows.map(r => r.production_date);
    }

    // Line info for report header
    async getLineInfo(lineCode) {
        const query = `SELECT line_code, line_name FROM production_lines WHERE line_code = $1`;
        const result = await pool.query(query, [lineCode]);
        return result.rows[0] || null;
    }
}

module.exports = ReportRepository;
