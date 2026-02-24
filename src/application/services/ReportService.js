const ReportRepository = require('../../infrastructure/repositories/ReportRepository');
const logger = require('../../../config/logger');
const XLSX = require('xlsx');

class ReportService {
    constructor() {
        this.repo = new ReportRepository();
        this.cache = new Map();
        this.CACHE_TTL = 5 * 60 * 1000;
    }

    _getCacheKey(type, lineCode, params) {
        return `${type}:${lineCode}:${JSON.stringify(params)}`;
    }

    _getFromCache(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.CACHE_TTL) {
            this.cache.delete(key);
            return null;
        }
        return entry.data;
    }

    _setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
        if (this.cache.size > 50) {
            const now = Date.now();
            for (const [k, v] of this.cache) {
                if (now - v.timestamp > this.CACHE_TTL) this.cache.delete(k);
            }
        }
    }

    // ==================== PROCESS GROUPING ====================

    _groupByProcess(equipment, columns, type) {
        const processMap = new Map();

        for (const eq of equipment) {
            const pName = eq.process_name;
            if (!processMap.has(pName)) {
                processMap.set(pName, {
                    process_name: pName,
                    process_order: eq.process_order,
                    equipment: [],
                    total: { ok: 0, ng: 0 }
                });
                if (type === 'hourly') processMap.get(pName).hours = {};
                if (type === 'monthly') processMap.get(pName).days = {};
            }

            const group = processMap.get(pName);
            group.equipment.push(eq);
            group.total.ok += eq.total.ok;
            group.total.ng += eq.total.ng;

            if (type === 'hourly') {
                for (const h of columns) {
                    if (!group.hours[h]) group.hours[h] = { ok: 0, ng: 0 };
                    if (eq.hours[h]) {
                        group.hours[h].ok += eq.hours[h].ok;
                        group.hours[h].ng += eq.hours[h].ng;
                    }
                }
            } else {
                for (const d of columns) {
                    if (!group.days[d]) group.days[d] = { ok: 0, ng: 0 };
                    if (eq.days[d]) {
                        group.days[d].ok += eq.days[d].ok;
                        group.days[d].ng += eq.days[d].ng;
                    }
                }
            }
        }

        const groups = Array.from(processMap.values()).sort((a, b) => a.process_order - b.process_order);

        // Calculate avg for red-cell threshold per process
        for (const pg of groups) {
            if (type === 'hourly') {
                const vals = columns.map(h => (pg.hours[h] || { ok: 0 }).ok).filter(v => v > 0);
                pg.avgOk = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            } else {
                const vals = columns.map(d => (pg.days[d] || { ok: 0 }).ok).filter(v => v > 0);
                pg.avgOk = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            }
        }

        return groups;
    }

    _getProcessSummary(processGroups) {
        // Line output = last process total
        const lastProcess = processGroups[processGroups.length - 1];
        const lineOutput = lastProcess ? lastProcess.total.ok : 0;

        // Bottleneck = process with lowest total OK
        let bottleneck = null;
        let bottleneckTotal = 0;
        let minOk = Infinity;
        for (const pg of processGroups) {
            if (pg.total.ok < minOk && pg.total.ok > 0) {
                minOk = pg.total.ok;
                bottleneck = pg.process_name;
                bottleneckTotal = pg.total.ok;
            }
        }

        // Total NG across all processes (not double-counted)
        const totalNg = processGroups.reduce((sum, pg) => sum + pg.total.ng, 0);

        return { lineOutput, bottleneck, bottleneckTotal, totalNg };
    }

    // ==================== HOURLY REPORT ====================

    async generateHourlyReport(lineCode, date, options = {}) {
        const cacheKey = this._getCacheKey('hourly', lineCode, { date, ...options });
        const cached = this._getFromCache(cacheKey);
        if (cached) {
            logger.info(`Cache hit: ${cacheKey}`);
            return cached;
        }

        const [lineInfo, shifts, rawData] = await Promise.all([
            this.repo.getLineInfo(lineCode),
            this.repo.getShiftDefinitions(lineCode),
            this.repo.getHourlyOutput(lineCode, date, options)
        ]);

        if (!lineInfo) throw new Error(`Line not found: ${lineCode}`);

        const dayStartHour = shifts.length > 0
            ? parseInt(shifts[0].start_time.split(':')[0])
            : 7;

        const hourColumns = [];
        for (let i = 0; i < 24; i++) {
            hourColumns.push((dayStartHour + i) % 24);
        }

        let visibleHours = hourColumns;
        let partialEnd = null;

        if (options.startTime && options.endTime) {
            const startHH = parseInt(options.startTime.split(':')[0]);
            const endHH = parseInt(options.endTime.split(':')[0]);
            const endMM = parseInt(options.endTime.split(':')[1] || '0');

            visibleHours = [];
            let inRange = false;
            for (const h of hourColumns) {
                if (h === startHH) inRange = true;
                if (inRange) visibleHours.push(h);
                if (h === endHH) { inRange = false; break; }
            }

            if (endMM > 0) {
                partialEnd = { hour: endHH, minutes: endMM };
            }
        }

        // Pivot raw data into equipment
        const equipmentMap = new Map();
        for (const row of rawData) {
            const eqId = row.equipment_id;
            if (!equipmentMap.has(eqId)) {
                equipmentMap.set(eqId, {
                    equipment_id: eqId,
                    equipment_name: row.equipment_name,
                    process_name: row.process_name,
                    process_order: row.process_order,
                    hours: {},
                    total: { ok: 0, ng: 0 }
                });
            }
            const eq = equipmentMap.get(eqId);
            const hour = parseInt(row.hour);
            if (!eq.hours[hour]) eq.hours[hour] = { ok: 0, ng: 0 };
            eq.hours[hour].ok += parseInt(row.pieces_ok);
            eq.hours[hour].ng += parseInt(row.pieces_ng);
            eq.total.ok += parseInt(row.pieces_ok);
            eq.total.ng += parseInt(row.pieces_ng);
        }

        const equipment = Array.from(equipmentMap.values())
            .sort((a, b) => a.process_order - b.process_order);

        // Per-equipment avg for red cells
        for (const eq of equipment) {
            const vals = visibleHours.map(h => (eq.hours[h] || { ok: 0 }).ok).filter(v => v > 0);
            eq.avgOk = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }

        // Process grouping
        const processGroups = this._groupByProcess(equipment, visibleHours, 'hourly');
        const processSummary = this._getProcessSummary(processGroups);

        // Hour totals (at process level - use last process for line throughput)
        const hourTotals = {};
        for (const h of visibleHours) {
            hourTotals[h] = { ok: 0, ng: 0 };
            for (const eq of equipment) {
                if (eq.hours[h]) {
                    hourTotals[h].ok += eq.hours[h].ok;
                    hourTotals[h].ng += eq.hours[h].ng;
                }
            }
        }

        const shiftMapping = shifts.map(s => ({
            shift_name: s.shift_name,
            shift_number: s.shift_number,
            startHour: parseInt(s.start_time.split(':')[0]),
            endHour: parseInt(s.end_time.split(':')[0])
        }));

        const report = {
            line: lineInfo,
            date,
            shifts: shiftMapping,
            hourColumns: visibleHours,
            partialEnd,
            equipment,
            processGroups,
            hourTotals,
            summary: {
                line_output: processSummary.lineOutput,
                total_ng: processSummary.totalNg,
                bottleneck: processSummary.bottleneck,
                bottleneck_total: processSummary.bottleneckTotal
            }
        };

        this._setCache(cacheKey, report);
        return report;
    }

    // ==================== MONTHLY REPORT ====================

    async generateMonthlyReport(lineCode, year, month) {
        const cacheKey = this._getCacheKey('monthly', lineCode, { year, month });
        const cached = this._getFromCache(cacheKey);
        if (cached) {
            logger.info(`Cache hit: ${cacheKey}`);
            return cached;
        }

        const [lineInfo, rawData] = await Promise.all([
            this.repo.getLineInfo(lineCode),
            this.repo.getMonthlyOutput(lineCode, year, month)
        ]);

        if (!lineInfo) throw new Error(`Line not found: ${lineCode}`);

        const lastDay = new Date(year, month, 0).getDate();
        const dayColumns = [];
        for (let d = 1; d <= lastDay; d++) {
            dayColumns.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }

        const equipmentMap = new Map();
        for (const row of rawData) {
            const eqId = row.equipment_id;
            if (!equipmentMap.has(eqId)) {
                equipmentMap.set(eqId, {
                    equipment_id: eqId,
                    equipment_name: row.equipment_name,
                    process_name: row.process_name,
                    process_order: row.process_order,
                    days: {},
                    total: { ok: 0, ng: 0 }
                });
            }
            const eq = equipmentMap.get(eqId);
            const dateStr = row.production_date instanceof Date
                ? row.production_date.toISOString().split('T')[0]
                : String(row.production_date);
            if (!eq.days[dateStr]) eq.days[dateStr] = { ok: 0, ng: 0 };
            eq.days[dateStr].ok += parseInt(row.pieces_ok);
            eq.days[dateStr].ng += parseInt(row.pieces_ng);
            eq.total.ok += parseInt(row.pieces_ok);
            eq.total.ng += parseInt(row.pieces_ng);
        }

        const equipment = Array.from(equipmentMap.values())
            .sort((a, b) => a.process_order - b.process_order);

        for (const eq of equipment) {
            const vals = dayColumns.map(d => (eq.days[d] || { ok: 0 }).ok).filter(v => v > 0);
            eq.avgOk = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }

        const processGroups = this._groupByProcess(equipment, dayColumns, 'monthly');
        const processSummary = this._getProcessSummary(processGroups);

        const dayTotals = {};
        for (const d of dayColumns) {
            dayTotals[d] = { ok: 0, ng: 0 };
            for (const eq of equipment) {
                if (eq.days[d]) {
                    dayTotals[d].ok += eq.days[d].ok;
                    dayTotals[d].ng += eq.days[d].ng;
                }
            }
        }

        const report = {
            line: lineInfo,
            year,
            month,
            dayColumns,
            equipment,
            processGroups,
            dayTotals,
            summary: {
                line_output: processSummary.lineOutput,
                total_ng: processSummary.totalNg,
                bottleneck: processSummary.bottleneck,
                bottleneck_total: processSummary.bottleneckTotal
            }
        };

        this._setCache(cacheKey, report);
        return report;
    }

    // ==================== EXCEL GENERATION ====================

    generateExcel(report, type = 'hourly') {
        const wb = XLSX.utils.book_new();
        if (type === 'hourly') {
            this._buildHourlySheet(wb, report);
        } else {
            this._buildMonthlySheet(wb, report);
        }
        this._buildSummarySheet(wb, report, type);
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    _buildHourlySheet(wb, report) {
        const rows = [];
        rows.push([`BorgWarner - ${report.line.line_name} - Hourly Production Report - ${report.date}`]);
        rows.push([]);

        const header = ['Equipment', 'Process'];
        for (const h of report.hourColumns) {
            const nextH = (h + 1) % 24;
            let label = `${String(h).padStart(2, '0')}-${String(nextH).padStart(2, '0')}`;
            if (report.partialEnd && h === report.partialEnd.hour) {
                label = `${String(h).padStart(2, '0')}-${String(h).padStart(2, '0')}:${String(report.partialEnd.minutes).padStart(2, '0')}*`;
            }
            header.push(label);
        }
        header.push('Total OK', 'Total NG');
        rows.push(header);

        // Process groups with equipment detail
        for (const pg of report.processGroups) {
            // Process summary row
            const pRow = [pg.process_name, `(${pg.equipment.length} eq)`];
            for (const h of report.hourColumns) {
                pRow.push(pg.hours[h] ? pg.hours[h].ok : 0);
            }
            pRow.push(pg.total.ok, pg.total.ng);
            rows.push(pRow);

            // Individual equipment rows (indented)
            if (pg.equipment.length > 1) {
                for (const eq of pg.equipment) {
                    const eRow = ['  ' + eq.equipment_name, eq.process_name];
                    for (const h of report.hourColumns) {
                        eRow.push(eq.hours[h] ? eq.hours[h].ok : 0);
                    }
                    eRow.push(eq.total.ok, eq.total.ng);
                    rows.push(eRow);
                }
            }
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 22 }, { wch: 18 }];
        for (let i = 0; i < report.hourColumns.length; i++) ws['!cols'].push({ wch: 8 });
        ws['!cols'].push({ wch: 10 }, { wch: 10 });
        XLSX.utils.book_append_sheet(wb, ws, 'Hourly Output');
    }

    _buildMonthlySheet(wb, report) {
        const rows = [];
        const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
        rows.push([`BorgWarner - ${report.line.line_name} - Monthly Report - ${monthNames[report.month]} ${report.year}`]);
        rows.push([]);

        const header = ['Equipment', 'Process'];
        for (const d of report.dayColumns) header.push(parseInt(d.split('-')[2]));
        header.push('Total OK', 'Total NG');
        rows.push(header);

        for (const pg of report.processGroups) {
            const pRow = [pg.process_name, `(${pg.equipment.length} eq)`];
            for (const d of report.dayColumns) pRow.push(pg.days[d] ? pg.days[d].ok : 0);
            pRow.push(pg.total.ok, pg.total.ng);
            rows.push(pRow);

            if (pg.equipment.length > 1) {
                for (const eq of pg.equipment) {
                    const eRow = ['  ' + eq.equipment_name, eq.process_name];
                    for (const d of report.dayColumns) eRow.push(eq.days[d] ? eq.days[d].ok : 0);
                    eRow.push(eq.total.ok, eq.total.ng);
                    rows.push(eRow);
                }
            }
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 22 }, { wch: 18 }];
        for (let i = 0; i < report.dayColumns.length; i++) ws['!cols'].push({ wch: 7 });
        ws['!cols'].push({ wch: 10 }, { wch: 10 });
        XLSX.utils.book_append_sheet(wb, ws, 'Monthly Output');
    }

    _buildSummarySheet(wb, report, type) {
        const rows = [];
        rows.push(['Report Summary']);
        rows.push([]);
        rows.push(['Line', report.line.line_name]);
        rows.push(['Line Code', report.line.line_code]);
        if (type === 'hourly') {
            rows.push(['Date', report.date]);
        } else {
            const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
            rows.push(['Period', `${monthNames[report.month]} ${report.year}`]);
        }
        rows.push(['Line Output (last process)', report.summary.line_output]);
        rows.push(['Total NG', report.summary.total_ng]);
        rows.push(['Yield %', report.summary.line_output > 0
            ? ((report.summary.line_output / (report.summary.line_output + report.summary.total_ng)) * 100).toFixed(2) + '%'
            : 'N/A']);
        rows.push(['Bottleneck Process', report.summary.bottleneck || 'N/A']);
        rows.push(['Bottleneck Total', report.summary.bottleneck_total || 'N/A']);
        rows.push([]);
        rows.push(['Process Ranking (by Total OK)']);
        rows.push(['Rank', 'Process', 'Equipment Count', 'Total OK', 'Total NG']);

        const sorted = [...report.processGroups].sort((a, b) => a.total.ok - b.total.ok);
        sorted.forEach((pg, i) => {
            rows.push([i + 1, pg.process_name, pg.equipment.length, pg.total.ok, pg.total.ng]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 8 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    }

    // ==================== CSV GENERATION ====================

    generateCSV(report, type = 'hourly') {
        const rows = [];

        if (type === 'hourly') {
            const header = ['Equipment', 'Process', 'Type'];
            for (const h of report.hourColumns) {
                const nextH = (h + 1) % 24;
                header.push(`"${String(h).padStart(2, '0')}:00-${String(nextH).padStart(2, '0')}:00"`);
            }
            header.push('Total OK', 'Total NG');
            rows.push(header.join(','));

            for (const pg of report.processGroups) {
                const pRow = [`"${pg.process_name}"`, '', 'PROCESS'];
                for (const h of report.hourColumns) pRow.push(pg.hours[h] ? pg.hours[h].ok : 0);
                pRow.push(pg.total.ok, pg.total.ng);
                rows.push(pRow.join(','));

                if (pg.equipment.length > 1) {
                    for (const eq of pg.equipment) {
                        const eRow = [`"  ${eq.equipment_name}"`, `"${eq.process_name}"`, 'EQUIPMENT'];
                        for (const h of report.hourColumns) eRow.push(eq.hours[h] ? eq.hours[h].ok : 0);
                        eRow.push(eq.total.ok, eq.total.ng);
                        rows.push(eRow.join(','));
                    }
                }
            }
        } else {
            const header = ['Equipment', 'Process', 'Type'];
            for (const d of report.dayColumns) header.push(d);
            header.push('Total OK', 'Total NG');
            rows.push(header.join(','));

            for (const pg of report.processGroups) {
                const pRow = [`"${pg.process_name}"`, '', 'PROCESS'];
                for (const d of report.dayColumns) pRow.push(pg.days[d] ? pg.days[d].ok : 0);
                pRow.push(pg.total.ok, pg.total.ng);
                rows.push(pRow.join(','));

                if (pg.equipment.length > 1) {
                    for (const eq of pg.equipment) {
                        const eRow = [`"  ${eq.equipment_name}"`, `"${eq.process_name}"`, 'EQUIPMENT'];
                        for (const d of report.dayColumns) eRow.push(eq.days[d] ? eq.days[d].ok : 0);
                        eRow.push(eq.total.ok, eq.total.ng);
                        rows.push(eRow.join(','));
                    }
                }
            }
        }

        return rows.join('\n');
    }
}

module.exports = ReportService;
