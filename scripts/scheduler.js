/**
 * VSM Scheduler - Orquestador de tareas automaticas
 * 
 * TAREAS:
 *   - CSV Extractor: cada 30 segundos
 *   - CT Calculator: cada 60 segundos
 * 
 * Ejecutar: node scripts/scheduler.js
 * Detener: Ctrl+C
 */
require('dotenv').config();
const cron = require('node-cron');
const { pool } = require('../config/database');
const logger = require('../config/logger');

// Importar clases de los scripts
const CSVFetcher = require('../src/infrastructure/external/CSVFetcher');
const CSVParser = require('../src/infrastructure/external/CSVParser');
const RawScanRepositoryClass = require('../src/infrastructure/repositories/RawScanRepository');
const EquipmentDesignRepositoryClass = require('../src/infrastructure/repositories/EquipmentDesignRepository');

// Crear instancias
const RawScanRepository = new RawScanRepositoryClass();
const EquipmentDesignRepository = new EquipmentDesignRepositoryClass();
const csvFetcher = new CSVFetcher();

class Scheduler {
    constructor() {
        this.isExtractorRunning = false;
        this.isCalculatorRunning = false;
        this.SIGMA_THRESHOLD = 2;
        
        this.SHIFTS = [
            { name: '1st Shift', startHour: 7, startMin: 0, endHour: 16, endMin: 30 },
            { name: '7th Shift', startHour: 16, startMin: 30, endHour: 22, endMin: 16 },
            { name: '9th Shift', startHour: 22, startMin: 16, endHour: 6, endMin: 40, crossesMidnight: true }
        ];

        this.stats = {
            extractorRuns: 0,
            calculatorRuns: 0,
            totalInserted: 0,
            lastExtractorRun: null,
            lastCalculatorRun: null,
            startedAt: new Date()
        };
    }

    async start() {
        logger.info('=== VSM SCHEDULER STARTING ===');
        
        // Test database connection
        try {
            await pool.query('SELECT NOW()');
            logger.info('Database connection OK');
        } catch (error) {
            logger.error('Database connection failed:', error.message);
            process.exit(1);
        }

        // Ejecutar inmediatamente al iniciar
        await this.runExtractor();
        await this.runCalculator();

        // Programar tareas
        // CSV Extractor cada 30 segundos
        cron.schedule('*/30 * * * * *', async () => {
            await this.runExtractor();
        });

        // CT Calculator cada 60 segundos
        cron.schedule('*/60 * * * * *', async () => {
            await this.runCalculator();
        });

        // Status cada 5 minutos
        cron.schedule('*/5 * * * *', () => {
            this.printStatus();
        });

        logger.info('Scheduler running - CSV every 30s, Calculator every 60s');
        logger.info('Press Ctrl+C to stop');
    }

    async runExtractor() {
        if (this.isExtractorRunning) {
            logger.debug('Extractor already running, skipping');
            return;
        }

        this.isExtractorRunning = true;
        const startTime = Date.now();

        try {
            const equipments = await EquipmentDesignRepository.getActiveEquipments();
            let totalInserted = 0;
            let totalDuplicates = 0;

            for (const equipment of equipments) {
                try {
                    const rawData = await csvFetcher.fetch(equipment.csv_url, equipment.equipment_id);
                    const records = CSVParser.parse(rawData, equipment.equipment_id);
                    
                    if (records.length > 0) {
                        const result = await RawScanRepository.insertBatch(records);
                        totalInserted += result.inserted;
                        totalDuplicates += result.duplicates;
                    }
                } catch (error) {
                    logger.debug(`[${equipment.equipment_id}] Fetch error: ${error.message}`);
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            this.stats.extractorRuns++;
            this.stats.totalInserted += totalInserted;
            this.stats.lastExtractorRun = new Date();

            if (totalInserted > 0) {
                logger.info(`[Extractor] +${totalInserted} records (${totalDuplicates} dups) in ${duration}s`);
            }

        } catch (error) {
            logger.error(`[Extractor] Error: ${error.message}`);
        } finally {
            this.isExtractorRunning = false;
        }
    }

    async runCalculator() {
        if (this.isCalculatorRunning) {
            logger.debug('Calculator already running, skipping');
            return;
        }

        this.isCalculatorRunning = true;
        const startTime = Date.now();

        try {
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const currentShift = this.getCurrentShift();

            const equipments = await this.getEquipmentsWithData();

            for (const equipment of equipments) {
                try {
                    await this.calculateForEquipment(equipment, oneHourAgo, currentShift);
                } catch (error) {
                    logger.debug(`[${equipment.equipment_id}] Calc error: ${error.message}`);
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            this.stats.calculatorRuns++;
            this.stats.lastCalculatorRun = new Date();

            logger.info(`[Calculator] ${equipments.length} equipments updated in ${duration}s`);

        } catch (error) {
            logger.error(`[Calculator] Error: ${error.message}`);
        } finally {
            this.isCalculatorRunning = false;
        }
    }

    // ==================== Calculator Methods ====================

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
        return { name: shift.name, start: shiftStart };
    }

    async getEquipmentsWithData() {
        const query = `
            SELECT DISTINCT rs.equipment_id, 
                   COALESCE(ed.equipment_type, 'BREQ_BCMP') as equipment_type
            FROM raw_scans rs
            LEFT JOIN equipment_design ed ON rs.equipment_id = ed.equipment_id
        `;
        const result = await pool.query(query);
        return result.rows;
    }

    async calculateForEquipment(equipment, oneHourAgo, currentShift) {
        const { equipment_id, equipment_type } = equipment;
        
        const shiftScans = await this.getScansInWindow(equipment_id, currentShift.start);
        const hourScans = await this.getScansInWindow(equipment_id, oneHourAgo);
        
        // RT metrics handled by rt-pulse-monitor.js
        const hourMetrics = this.calculateWindowMetrics(hourScans, equipment_type);
        const shiftMetrics = this.calculateWindowMetrics(shiftScans, equipment_type);

        await this.saveMetrics({
            equipment_id,




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
    }

    async getScansInWindow(equipmentId, windowStart) {
        const query = `
            SELECT serial_number, status, scanned_at
            FROM raw_scans WHERE equipment_id = $1 AND scanned_at >= $2
            ORDER BY scanned_at ASC
        `;
        const result = await pool.query(query, [equipmentId, windowStart]);
        return result.rows;
    }

    isCompletionStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.startsWith('BCMP') || s.includes('PROCESSED') || s.includes('COMPLETE');
    }

    isOKStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.includes('OK') || (s.includes('PROCESSED') && !s.includes('FAIL') && !s.includes('NG'));
    }

    isNGStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.includes('NG') || s.includes('FAIL');
    }

    calculateRealTime(scans, equipmentType) {
        const result = { ctEquipo: null, ctProceso: null, lastSerial: null, lastScanAt: null };
        const completionScans = scans.filter(s => this.isCompletionStatus(s.status));
        
        if (completionScans.length < 2) return result;

        const lastScan = completionScans[completionScans.length - 1];
        const prevScan = completionScans[completionScans.length - 2];
        
        const ctProceso = (new Date(lastScan.scanned_at) - new Date(prevScan.scanned_at)) / 1000;
        
        if (ctProceso > 0 && ctProceso < 300) result.ctProceso = ctProceso;
        
        result.lastSerial = lastScan.serial_number;
        result.lastScanAt = lastScan.scanned_at;
        result.ctEquipo = equipmentType === 'BCMP_ONLY' ? result.ctProceso : this.getLastBREQtoBCMP(scans);

        return result;
    }

    getLastBREQtoBCMP(scans) {
        const breqMap = new Map();
        let lastCT = null;

        for (const scan of scans) {
            const timestamp = new Date(scan.scanned_at).getTime();
            if (scan.status === 'BREQ') {
                breqMap.set(scan.serial_number, timestamp);
            } else if (this.isCompletionStatus(scan.status)) {
                const breqTime = breqMap.get(scan.serial_number);
                if (breqTime) {
                    const ct = (timestamp - breqTime) / 1000;
                    if (ct > 0 && ct < 300) lastCT = ct;
                    breqMap.delete(scan.serial_number);
                }
            }
        }
        return lastCT;
    }

    calculateWindowMetrics(scans, equipmentType) {
        const result = { ctEquipo: null, ctProceso: null, piecesOK: 0, piecesNG: 0, validSamples: 0, stdDev: 0 };
        if (scans.length < 2) return result;

        let ctEquipoValues = equipmentType === 'BCMP_ONLY' 
            ? this.calculateBCMPConsecutive(scans)
            : this.calculateBREQtoBCMP(scans);
        
        if (ctEquipoValues.length === 0) ctEquipoValues = this.calculateBCMPConsecutive(scans);

        const ctProcesoValues = this.calculateBCMPConsecutive(scans);
        const ctEquipoResult = this.filterOutliersAndAverage(ctEquipoValues);
        const ctProcesoResult = this.filterOutliersAndAverage(ctProcesoValues);

        result.ctEquipo = ctEquipoResult.average;
        result.ctProceso = ctProcesoResult.average;
        result.validSamples = ctEquipoResult.validCount;
        result.stdDev = ctEquipoResult.stdDev;
        result.piecesOK = scans.filter(s => this.isOKStatus(s.status)).length;
        result.piecesNG = scans.filter(s => this.isNGStatus(s.status)).length;

        return result;
    }

    calculateBREQtoBCMP(scans) {
        const ctValues = [];
        const breqMap = new Map();

        for (const scan of scans) {
            const timestamp = new Date(scan.scanned_at).getTime();
            if (scan.status === 'BREQ') {
                breqMap.set(scan.serial_number, timestamp);
            } else if (this.isCompletionStatus(scan.status)) {
                const breqTime = breqMap.get(scan.serial_number);
                if (breqTime) {
                    const ct = (timestamp - breqTime) / 1000;
                    if (ct > 0 && ct < 300) ctValues.push(ct);
                    breqMap.delete(scan.serial_number);
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
                if (ct > 0 && ct < 300) ctValues.push(ct);
            }
            lastTime = timestamp;
        }
        return ctValues;
    }

    filterOutliersAndAverage(values) {
        const result = { average: null, validCount: 0, stdDev: 0 };
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
        result.validCount = validValues.length;

        result.average = validValues.length > 0 
            ? validValues.reduce((a, b) => a + b, 0) / validValues.length 
            : mean;
        return result;
    }

    async saveMetrics(m) {
        const query = `
            INSERT INTO equipment_metrics (
                equipment_id,
                ct_equipo_hour, ct_proceso_hour, pieces_ok_hour, pieces_ng_hour, samples_hour, stddev_hour,
                ct_equipo_shift, ct_proceso_shift, pieces_ok_shift, pieces_ng_shift, samples_shift, stddev_shift,
                shift_name, shift_start, calculated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
            ON CONFLICT (equipment_id) DO UPDATE SET


                ct_equipo_hour=EXCLUDED.ct_equipo_hour, ct_proceso_hour=EXCLUDED.ct_proceso_hour,
                pieces_ok_hour=EXCLUDED.pieces_ok_hour, pieces_ng_hour=EXCLUDED.pieces_ng_hour,
                samples_hour=EXCLUDED.samples_hour, stddev_hour=EXCLUDED.stddev_hour,
                ct_equipo_shift=EXCLUDED.ct_equipo_shift, ct_proceso_shift=EXCLUDED.ct_proceso_shift,
                pieces_ok_shift=EXCLUDED.pieces_ok_shift, pieces_ng_shift=EXCLUDED.pieces_ng_shift,
                samples_shift=EXCLUDED.samples_shift, stddev_shift=EXCLUDED.stddev_shift,
                shift_name=EXCLUDED.shift_name, shift_start=EXCLUDED.shift_start, calculated_at=NOW()
        `;
        await pool.query(query, [
            m.equipment_id,
            m.ct_equipo_hour, m.ct_proceso_hour, m.pieces_ok_hour, m.pieces_ng_hour, m.samples_hour, m.stddev_hour,
            m.ct_equipo_shift, m.ct_proceso_shift, m.pieces_ok_shift, m.pieces_ng_shift, m.samples_shift, m.stddev_shift,
            m.shift_name, m.shift_start
        ]);
    }

    printStatus() {
        const uptime = Math.round((Date.now() - this.stats.startedAt.getTime()) / 60000);
        logger.info(`[Status] Uptime: ${uptime}min | Extractor runs: ${this.stats.extractorRuns} | Calculator runs: ${this.stats.calculatorRuns} | Total inserted: ${this.stats.totalInserted}`);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down scheduler...');
    pool.end();
    process.exit(0);
});

// Start
const scheduler = new Scheduler();
scheduler.start();

