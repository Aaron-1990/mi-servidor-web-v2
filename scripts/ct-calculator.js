/**
 * CT Calculator - Calcula Cycle Times desde raw_scans
 * 
 * TRES VENTANAS DE CALCULO:
 *   1. Tiempo Real: Ultimo BCMP->BCMP (pulso de linea)
 *   2. Ultima Hora: Promedio con filtro +/-2 sigma
 *   3. Turno Actual: Promedio con filtro +/-2 sigma
 * 
 * TURNOS:
 *   - 1st Shift: 07:00 - 16:30
 *   - 7th Shift: 16:30 - 22:16
 *   - 9th Shift: 22:16 - 06:40 (cruza medianoche)
 */
require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('../config/logger');

class CTCalculator {
    constructor() {
        this.SIGMA_THRESHOLD = 2;
        
        this.SHIFTS = [
            { name: '1st Shift', startHour: 7, startMin: 0, endHour: 16, endMin: 30 },
            { name: '7th Shift', startHour: 16, startMin: 30, endHour: 22, endMin: 16 },
            { name: '9th Shift', startHour: 22, startMin: 16, endHour: 6, endMin: 40, crossesMidnight: true }
        ];
    }

    /**
     * Detecta si el status indica pieza completada
     * Soporta: BCMP OK, BCMP NG, Processed OK, etc.
     */
    isCompletionStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.startsWith('BCMP') || s.includes('PROCESSED') || s.includes('COMPLETE');
    }

    /**
     * Detecta si es pieza OK
     */
    isOKStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.includes('OK') || (s.includes('PROCESSED') && !s.includes('FAIL') && !s.includes('NG'));
    }

    /**
     * Detecta si es pieza NG
     */
    isNGStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.includes('NG') || s.includes('FAIL');
    }

    getCurrentShift() {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        
        for (const shift of this.SHIFTS) {
            const startMinutes = shift.startHour * 60 + shift.startMin;
            const endMinutes = shift.endHour * 60 + shift.endMin;
            
            if (shift.crossesMidnight) {
                if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
                    return this.calculateShiftStart(now, shift);
                }
            } else {
                if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
                    return this.calculateShiftStart(now, shift);
                }
            }
        }
        
        return this.calculateShiftStart(now, this.SHIFTS[0]);
    }

    calculateShiftStart(now, shift) {
        const shiftStart = new Date(now);
        shiftStart.setHours(shift.startHour, shift.startMin, 0, 0);
        
        if (shift.crossesMidnight) {
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            if (currentMinutes < shift.endHour * 60 + shift.endMin) {
                shiftStart.setDate(shiftStart.getDate() - 1);
            }
        }
        
        return { name: shift.name, start: shiftStart, shift: shift };
    }

    async run() {
        const startTime = Date.now();
        logger.info('=== CT CALCULATOR STARTED ===');

        try {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const currentShift = this.getCurrentShift();
            
            logger.info(`Current shift: ${currentShift.name} (started: ${currentShift.start.toLocaleTimeString()})`);

            const equipments = await this.getEquipmentsWithData();
            logger.info(`Found ${equipments.length} equipments with data`);

            let processed = 0;
            let errors = 0;

            for (const equipment of equipments) {
                try {
                    await this.calculateForEquipment(equipment, oneHourAgo, currentShift);
                    processed++;
                } catch (error) {
                    logger.error(`[${equipment.equipment_id}] Calculation error: ${error.message}`);
                    errors++;
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info('=== CT CALCULATOR COMPLETED ===');
            logger.info(`Duration: ${duration}s | Processed: ${processed} | Errors: ${errors}`);

            return { success: true, duration, processed, errors };

        } catch (error) {
            logger.error(`CT Calculator failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async getEquipmentsWithData() {
        const query = `
            SELECT DISTINCT rs.equipment_id, 
                   COALESCE(ed.equipment_type, 'BREQ_BCMP') as equipment_type,
                   COALESCE(ed.design_ct, 30) as design_ct
            FROM raw_scans rs
            LEFT JOIN equipment_design ed ON rs.equipment_id = ed.equipment_id
            ORDER BY rs.equipment_id
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    async calculateForEquipment(equipment, oneHourAgo, currentShift) {
        const { equipment_id, equipment_type } = equipment;
        
        const shiftScans = await this.getScansInWindow(equipment_id, currentShift.start);
        const hourScans = await this.getScansInWindow(equipment_id, oneHourAgo);
        
        const realTimeMetrics = this.calculateRealTime(shiftScans, equipment_type, equipment_id);
        const hourMetrics = this.calculateWindowMetrics(hourScans, equipment_type, equipment_id, 'HOUR');
        const shiftMetrics = this.calculateWindowMetrics(shiftScans, equipment_type, equipment_id, 'SHIFT');

        await this.saveMetrics({
            equipment_id,
            ct_equipo_realtime: realTimeMetrics.ctEquipo,
            ct_proceso_realtime: realTimeMetrics.ctProceso,
            last_serial: realTimeMetrics.lastSerial,
            last_scan_at: realTimeMetrics.lastScanAt,
            ct_equipo_hour: hourMetrics.ctEquipo,
            ct_proceso_hour: hourMetrics.ctProceso,
            pieces_ok_hour: hourMetrics.piecesOK,
            pieces_ng_hour: hourMetrics.piecesNG,
            samples_hour: hourMetrics.validSamples,
            stddev_hour: hourMetrics.stdDev,
            ct_equipo_shift: shiftMetrics.ctEquipo,
            ct_proceso_shift: shiftMetrics.ctProceso,
            pieces_ok_shift: shiftMetrics.piecesOK,
            pieces_ng_shift: shiftMetrics.piecesNG,
            samples_shift: shiftMetrics.validSamples,
            stddev_shift: shiftMetrics.stdDev,
            shift_name: currentShift.name,
            shift_start: currentShift.start
        });

        logger.info(`[${equipment_id}] RT: ${realTimeMetrics.ctProceso?.toFixed(1) || '-'}s | HOUR: ${hourMetrics.ctEquipo?.toFixed(1) || '-'}s (n=${hourMetrics.validSamples}) | SHIFT: ${shiftMetrics.ctEquipo?.toFixed(1) || '-'}s (n=${shiftMetrics.validSamples})`);
    }

    async getScansInWindow(equipmentId, windowStart) {
        const query = `
            SELECT serial_number, status, scanned_at
            FROM raw_scans
            WHERE equipment_id = $1 AND scanned_at >= $2
            ORDER BY scanned_at ASC
        `;
        const result = await pool.query(query, [equipmentId, windowStart]);
        return result.rows;
    }

    calculateRealTime(scans, equipmentType, equipmentId) {
        const result = { ctEquipo: null, ctProceso: null, lastSerial: null, lastScanAt: null };

        const completionScans = scans.filter(s => this.isCompletionStatus(s.status));
        
        if (completionScans.length < 2) return result;

        const lastScan = completionScans[completionScans.length - 1];
        const prevScan = completionScans[completionScans.length - 2];
        
        const lastTime = new Date(lastScan.scanned_at).getTime();
        const prevTime = new Date(prevScan.scanned_at).getTime();
        const ctProceso = (lastTime - prevTime) / 1000;
        
        if (ctProceso > 0 && ctProceso < 300) {
            result.ctProceso = ctProceso;
        }
        
        result.lastSerial = lastScan.serial_number;
        result.lastScanAt = lastScan.scanned_at;

        if (equipmentType === 'BCMP_ONLY') {
            result.ctEquipo = result.ctProceso;
        } else {
            result.ctEquipo = this.getLastBREQtoBCMP(scans);
        }

        return result;
    }

    getLastBREQtoBCMP(scans) {
        const breqMap = new Map();
        let lastCT = null;

        for (const scan of scans) {
            const { serial_number, status, scanned_at } = scan;
            const timestamp = new Date(scanned_at).getTime();

            if (status === 'BREQ') {
                breqMap.set(serial_number, timestamp);
            } else if (this.isCompletionStatus(status)) {
                const breqTime = breqMap.get(serial_number);
                if (breqTime) {
                    const ct = (timestamp - breqTime) / 1000;
                    if (ct > 0 && ct < 300) {
                        lastCT = ct;
                    }
                    breqMap.delete(serial_number);
                }
            }
        }

        return lastCT;
    }

    calculateWindowMetrics(scans, equipmentType, equipmentId, windowName) {
        const result = {
            ctEquipo: null, ctProceso: null,
            piecesOK: 0, piecesNG: 0, piecesTotal: 0,
            totalSamples: scans.length, validSamples: 0, outliers: 0, stdDev: 0
        };

        if (scans.length < 2) return result;

        let ctEquipoValues;
        if (equipmentType === 'BCMP_ONLY') {
            ctEquipoValues = this.calculateBCMPConsecutive(scans);
        } else {
            ctEquipoValues = this.calculateBREQtoBCMP(scans);
            if (ctEquipoValues.length === 0) {
                ctEquipoValues = this.calculateBCMPConsecutive(scans);
            }
        }

        const ctProcesoValues = this.calculateBCMPConsecutive(scans);

        const ctEquipoResult = this.filterOutliersAndAverage(ctEquipoValues);
        const ctProcesoResult = this.filterOutliersAndAverage(ctProcesoValues);

        result.ctEquipo = ctEquipoResult.average;
        result.ctProceso = ctProcesoResult.average;
        result.validSamples = ctEquipoResult.validCount;
        result.outliers = ctEquipoResult.outliersRemoved;
        result.stdDev = ctEquipoResult.stdDev;

        result.piecesOK = scans.filter(s => this.isOKStatus(s.status)).length;
        result.piecesNG = scans.filter(s => this.isNGStatus(s.status)).length;
        result.piecesTotal = result.piecesOK + result.piecesNG;

        return result;
    }

    calculateBREQtoBCMP(scans) {
        const ctValues = [];
        const breqMap = new Map();

        for (const scan of scans) {
            const { serial_number, status, scanned_at } = scan;
            const timestamp = new Date(scanned_at).getTime();

            if (status === 'BREQ') {
                breqMap.set(serial_number, timestamp);
            } else if (this.isCompletionStatus(status)) {
                const breqTime = breqMap.get(serial_number);
                if (breqTime) {
                    const ct = (timestamp - breqTime) / 1000;
                    if (ct > 0 && ct < 300) {
                        ctValues.push(ct);
                    }
                    breqMap.delete(serial_number);
                }
            }
        }

        return ctValues;
    }

    calculateBCMPConsecutive(scans) {
        const ctValues = [];
        let lastTime = null;

        for (const scan of scans) {
            if (!this.isCompletionStatus(scan.status)) continue;

            const timestamp = new Date(scan.scanned_at).getTime();
            
            if (lastTime !== null) {
                const ct = (timestamp - lastTime) / 1000;
                if (ct > 0 && ct < 300) {
                    ctValues.push(ct);
                }
            }
            lastTime = timestamp;
        }

        return ctValues;
    }

    filterOutliersAndAverage(values) {
        const result = { average: null, validCount: 0, outliersRemoved: 0, stdDev: 0 };

        if (values.length === 0) return result;

        if (values.length < 3) {
            result.average = values.reduce((a, b) => a + b, 0) / values.length;
            result.validCount = values.length;
            return result;
        }

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        result.stdDev = stdDev;

        const lowerBound = mean - (this.SIGMA_THRESHOLD * stdDev);
        const upperBound = mean + (this.SIGMA_THRESHOLD * stdDev);
        
        const validValues = values.filter(v => v >= lowerBound && v <= upperBound);
        result.outliersRemoved = values.length - validValues.length;
        result.validCount = validValues.length;

        if (validValues.length === 0) {
            result.average = mean;
            result.validCount = values.length;
            return result;
        }

        result.average = validValues.reduce((a, b) => a + b, 0) / validValues.length;
        return result;
    }

    async saveMetrics(metrics) {
        const query = `
            INSERT INTO equipment_metrics (
                equipment_id,
                ct_equipo_realtime, ct_proceso_realtime, last_serial, last_scan_at,
                ct_equipo_hour, ct_proceso_hour, pieces_ok_hour, pieces_ng_hour, samples_hour, stddev_hour,
                ct_equipo_shift, ct_proceso_shift, pieces_ok_shift, pieces_ng_shift, samples_shift, stddev_shift,
                shift_name, shift_start, calculated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
            ON CONFLICT (equipment_id) 
            DO UPDATE SET
                ct_equipo_realtime = EXCLUDED.ct_equipo_realtime,
                ct_proceso_realtime = EXCLUDED.ct_proceso_realtime,
                last_serial = EXCLUDED.last_serial,
                last_scan_at = EXCLUDED.last_scan_at,
                ct_equipo_hour = EXCLUDED.ct_equipo_hour,
                ct_proceso_hour = EXCLUDED.ct_proceso_hour,
                pieces_ok_hour = EXCLUDED.pieces_ok_hour,
                pieces_ng_hour = EXCLUDED.pieces_ng_hour,
                samples_hour = EXCLUDED.samples_hour,
                stddev_hour = EXCLUDED.stddev_hour,
                ct_equipo_shift = EXCLUDED.ct_equipo_shift,
                ct_proceso_shift = EXCLUDED.ct_proceso_shift,
                pieces_ok_shift = EXCLUDED.pieces_ok_shift,
                pieces_ng_shift = EXCLUDED.pieces_ng_shift,
                samples_shift = EXCLUDED.samples_shift,
                stddev_shift = EXCLUDED.stddev_shift,
                shift_name = EXCLUDED.shift_name,
                shift_start = EXCLUDED.shift_start,
                calculated_at = NOW()
        `;

        await pool.query(query, [
            metrics.equipment_id,
            metrics.ct_equipo_realtime, metrics.ct_proceso_realtime, metrics.last_serial, metrics.last_scan_at,
            metrics.ct_equipo_hour, metrics.ct_proceso_hour, metrics.pieces_ok_hour, metrics.pieces_ng_hour, metrics.samples_hour, metrics.stddev_hour,
            metrics.ct_equipo_shift, metrics.ct_proceso_shift, metrics.pieces_ok_shift, metrics.pieces_ng_shift, metrics.samples_shift, metrics.stddev_shift,
            metrics.shift_name, metrics.shift_start
        ]);
    }
}

const calculator = new CTCalculator();
calculator.run()
    .then(result => {
        console.log('Result:', JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });