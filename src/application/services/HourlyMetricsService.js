/**
 * HourlyMetricsService
 * 
 * Business logic layer for hourly piece count breakdown.
 * Transforms raw DB rows into a complete 24-hour response with
 * totals, peak hour identification, and zero-filled gaps.
 */

class HourlyMetricsService {

    /**
     * @param {import('../infrastructure/repositories/HourlyMetricsRepository')} hourlyMetricsRepository
     */
    constructor(hourlyMetricsRepository) {
        this.repository = hourlyMetricsRepository;
    }

    /**
     * Get complete 24-hour breakdown for an equipment.
     * 
     * @param {string} equipmentId
     * @param {string|null} targetDate - "YYYY-MM-DD" or null for today
     * @returns {Promise<HourlyBreakdownResponse>}
     */
    async getHourlyBreakdown(equipmentId, targetDate = null) {
        const rawData = await this.repository.getHourlyPieceCount(equipmentId, targetDate);

        const hours = this._buildFullDayArray(rawData);
        const totals = this._calculateTotals(hours);

        return {
            equipment_id: equipmentId,
            date: targetDate || new Date().toISOString().split('T')[0],
            hours,
            totals
        };
    }

    /**
     * Get detailed raw scan records for a specific hour.
     * Provides the evidence trail behind each hourly bar.
     * 
     * @param {string} equipmentId
     * @param {number} hour - 0-23
     * @param {string|null} targetDate
     * @returns {Promise<HourlyDetailResponse>}
     */
    async getHourlyDetails(equipmentId, hour, targetDate = null) {
        const scans = await this.repository.getScansForHour(equipmentId, hour, targetDate);

        const summary = this._summarizeScans(scans);

        return {
            equipment_id: equipmentId,
            date: targetDate || new Date().toISOString().split('T')[0],
            hour: hour,
            label: hour.toString().padStart(2, '0') + ':00',
            record_count: scans.length,
            summary,
            records: scans.map(function(scan) {
                return {
                    serial_number: scan.serial_number,
                    status: scan.status,
                    scanned_at: scan.scanned_at,
                    scan_time: scan.scan_time,
                    is_ng: /NG|FAIL/i.test(scan.status)
                };
            })
        };
    }

    /**
     * Summarize scans into OK/NG counts and time range.
     * 
     * @param {Array} scans
     * @returns {Object}
     * @private
     */
    _summarizeScans(scans) {
        var okCount = 0;
        var ngCount = 0;
        var firstScan = null;
        var lastScan = null;
        var firstScanTime = null;
        var lastScanTime = null;

        for (var i = 0; i < scans.length; i++) {
            var s = scans[i];
            if (/NG|FAIL/i.test(s.status)) {
                ngCount++;
            } else {
                okCount++;
            }
            if (!firstScan || s.scanned_at < firstScan) { firstScan = s.scanned_at; firstScanTime = s.scan_time; }
            if (!lastScan || s.scanned_at > lastScan) { lastScan = s.scanned_at; lastScanTime = s.scan_time; }
        }

        return {
            pieces_ok: okCount,
            pieces_ng: ngCount,
            total: okCount + ngCount,
            first_scan_at: firstScan,
            last_scan_at: lastScan,
            first_scan_time: firstScanTime,
            last_scan_time: lastScanTime
        };
    }

    /**
     * Build a complete 24-element array from sparse DB results.
     * 
     * @param {Array<{hour: number, pieces_ok: string, pieces_ng: string}>} rawData
     * @returns {HourlyBucket[]}
     * @private
     */
    _buildFullDayArray(rawData) {
        var dataByHour = new Map();
        for (var i = 0; i < rawData.length; i++) {
            var row = rawData[i];
            dataByHour.set(parseInt(row.hour), {
                pieces_ok: parseInt(row.pieces_ok) || 0,
                pieces_ng: parseInt(row.pieces_ng) || 0
            });
        }

        var hours = [];
        for (var h = 0; h < 24; h++) {
            var data = dataByHour.get(h) || { pieces_ok: 0, pieces_ng: 0 };
            hours.push({
                hour: h,
                label: h.toString().padStart(2, '0') + ':00',
                pieces_ok: data.pieces_ok,
                pieces_ng: data.pieces_ng,
                total: data.pieces_ok + data.pieces_ng
            });
        }

        return hours;
    }

    /**
     * Calculate aggregate totals and identify peak production hour.
     * 
     * @param {HourlyBucket[]} hours
     * @returns {Object}
     * @private
     */
    _calculateTotals(hours) {
        var totalOk = 0;
        var totalNg = 0;
        var peakHour = null;
        var peakCount = 0;

        for (var i = 0; i < hours.length; i++) {
            var h = hours[i];
            totalOk += h.pieces_ok;
            totalNg += h.pieces_ng;

            if (h.total > peakCount) {
                peakCount = h.total;
                peakHour = { hour: h.hour, label: h.label, count: h.total };
            }
        }

        return {
            pieces_ok: totalOk,
            pieces_ng: totalNg,
            total: totalOk + totalNg,
            peak_hour: peakHour
        };
    }
}

module.exports = HourlyMetricsService;


