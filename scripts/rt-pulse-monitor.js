/**
 * RT Pulse Monitor v2 - Throughput-based Real-Time CT
 *
 * Calculates RT cycle times using throughput rate over last 30 pieces:
 *   CT Proceso RT = (timestamp_30th - timestamp_1st) / 29
 *   CT Equipo RT  = BCMP_ONLY: same as CT Proceso
 *                    BREQ_BCMP: average of last 30 BREQ->BCMP pairs
 *
 * Run: node scripts/rt-pulse-monitor.js
 * Stop: Ctrl+C
 */
require('dotenv').config();
const axios = require('axios');
const { pool } = require('../config/database');
const logger = require('../config/logger');

const API_URL = process.env.RT_PULSE_URL || 'http://localhost:3000/api/internal/rt-pulse';
const POLL_INTERVAL = 5000;
const CSV_TIMEOUT = 4000;
const TAIL_LINES = 50;
const BUFFER_SIZE = 30;

class RTPulseMonitor {
    constructor() {
        this.state = new Map();
        this.equipments = [];
        this.isRunning = false;
        this.pollCount = 0;
        this.pulseCount = 0;
    }

    async start() {
        logger.info('=== RT PULSE MONITOR v2 STARTING ===');

        try {
            const result = await pool.query(
                'SELECT equipment_id, csv_url, COALESCE(equipment_type, \'BREQ_BCMP\') as equipment_type FROM equipment_design WHERE is_active = true AND csv_url IS NOT NULL'
            );
            this.equipments = result.rows;
            logger.info('Loaded ' + this.equipments.length + ' active equipments');
        } catch (error) {
            logger.error('Failed to load equipments: ' + error.message);
            process.exit(1);
        }

        for (const eq of this.equipments) {
            this.state.set(eq.equipment_id, {
                lastBCMPSerial: null,
                lastBCMPTime: null,
                completionTimes: [],
                breqBcmpValues: [],
                breqCache: new Map()
            });
        }

        this.isRunning = true;
        logger.info('Polling every ' + (POLL_INTERVAL / 1000) + 's | Buffer: ' + BUFFER_SIZE + ' pieces | Tail: ' + TAIL_LINES + ' lines');
        logger.info('Press Ctrl+C to stop');

        this.poll();
        this.interval = setInterval(() => this.poll(), POLL_INTERVAL);

        this.statusInterval = setInterval(() => {
            logger.info('[RT Status] Polls: ' + this.pollCount + ' | Pulses detected: ' + this.pulseCount);
        }, 5 * 60 * 1000);
    }

    async poll() {
        if (!this.isRunning) return;
        this.pollCount++;

        const promises = this.equipments.map(eq =>
            this.checkEquipment(eq).catch(err => {
                logger.debug('[' + eq.equipment_id + '] Poll error: ' + err.message);
            })
        );
        await Promise.all(promises);
    }

    async checkEquipment(equipment) {
        const { equipment_id, csv_url, equipment_type } = equipment;

        const response = await axios.get(csv_url, {
            timeout: CSV_TIMEOUT,
            responseType: 'text'
        });

        const match = response.data.match(/<xmp>([\s\S]*?)<\/xmp>/i);
        if (!match) return;

        const allLines = match[1].split('\n').filter(l => l.trim());
        const tailLines = allLines.slice(-TAIL_LINES);

        const records = [];
        for (const line of tailLines) {
            const parsed = this.parseLine(line);
            if (parsed) records.push(parsed);
        }

        if (records.length === 0) return;

        const state = this.state.get(equipment_id);
        let hasNewCompletion = false;

        for (const record of records) {
            if (record.status === 'BREQ') {
                state.breqCache.set(record.serial, record.timestamp);
                if (state.breqCache.size > 100) {
                    const firstKey = state.breqCache.keys().next().value;
                    state.breqCache.delete(firstKey);
                }
            } else if (this.isCompletionStatus(record.status)) {
                // Check if this completion is newer than last known
                if (!state.lastBCMPTime || record.timestamp.getTime() > state.lastBCMPTime.getTime()) {
                    hasNewCompletion = true;

                    // Add to completion times buffer
                    state.completionTimes.push(record.timestamp.getTime());
                    if (state.completionTimes.length > BUFFER_SIZE) {
                        state.completionTimes.shift();
                    }

                    // For BREQ_BCMP: check if we have a matching BREQ
                    if (equipment_type !== 'BCMP_ONLY') {
                        const breqTime = state.breqCache.get(record.serial);
                        if (breqTime) {
                            const ct = (record.timestamp.getTime() - breqTime) / 1000;
                            if (ct > 0 && ct < 600) {
                                state.breqBcmpValues.push(ct);
                                if (state.breqBcmpValues.length > BUFFER_SIZE) {
                                    state.breqBcmpValues.shift();
                                }
                            }
                            state.breqCache.delete(record.serial);
                        }
                    }

                    state.lastBCMPSerial = record.serial;
                    state.lastBCMPTime = record.timestamp;
                }
            }
        }

        if (!hasNewCompletion) return;

        // Calculate CT Proceso: throughput rate over buffer
        let ctProceso = null;
        if (state.completionTimes.length >= 2) {
            const oldest = state.completionTimes[0];
            const newest = state.completionTimes[state.completionTimes.length - 1];
            const span = (newest - oldest) / 1000;
            const intervals = state.completionTimes.length - 1;
            ctProceso = span / intervals;
            // Sanity check
            if (ctProceso <= 0 || ctProceso > 600) ctProceso = null;
        }

        // Calculate CT Equipo
        let ctEquipo = null;
        if (equipment_type === 'BCMP_ONLY') {
            ctEquipo = ctProceso;
        } else if (state.breqBcmpValues.length > 0) {
            // Average of BREQ->BCMP pairs in buffer
            const sum = state.breqBcmpValues.reduce((a, b) => a + b, 0);
            ctEquipo = sum / state.breqBcmpValues.length;
            if (ctEquipo <= 0 || ctEquipo > 600) ctEquipo = null;
        }

        // POST to server
        this.pulseCount++;
        const payload = {
            equipment_id,
            ct_equipo: ctEquipo !== null ? parseFloat(ctEquipo.toFixed(2)) : null,
            ct_proceso: ctProceso !== null ? parseFloat(ctProceso.toFixed(2)) : null,
            last_serial: state.lastBCMPSerial,
            last_scan_at: state.lastBCMPTime.toISOString()
        };

        try {
            await axios.post(API_URL, payload, { timeout: 2000 });
            const bufInfo = 'buf=' + state.completionTimes.length + '/' + BUFFER_SIZE;
            logger.debug('[' + equipment_id + '] Pulse: CT_eq=' + (ctEquipo ? ctEquipo.toFixed(1) : '-') + 's CT_pr=' + (ctProceso ? ctProceso.toFixed(1) : '-') + 's ' + bufInfo);
        } catch (error) {
            logger.warn('[' + equipment_id + '] Failed to POST pulse: ' + error.message);
        }
    }

    parseLine(line) {
        const parts = line.split(',');
        if (parts.length < 7) return null;

        const serial = parts[0].trim();
        const status = parts[5].trim();
        const dateStr = parts[6].trim();

        if (!serial || !status || !dateStr) return null;

        const timestamp = new Date(dateStr);
        if (isNaN(timestamp.getTime())) return null;

        return { serial, status, timestamp };
    }

    isCompletionStatus(status) {
        if (!status) return false;
        const s = status.toUpperCase();
        return s.startsWith('BCMP') || s.includes('PROCESSED') || s.includes('COMPLETE');
    }

    stop() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        if (this.statusInterval) clearInterval(this.statusInterval);
        logger.info('RT Pulse Monitor stopped. Total pulses detected: ' + this.pulseCount);
    }
}

const monitor = new RTPulseMonitor();

process.on('SIGINT', () => {
    monitor.stop();
    pool.end();
    process.exit(0);
});

monitor.start();
