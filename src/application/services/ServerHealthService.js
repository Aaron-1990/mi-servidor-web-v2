// src/application/services/ServerHealthService.js
// Collects server, resource, database, pipeline and WebSocket health metrics
var os = require('os');
var { exec } = require('child_process');
var { pool } = require('../../../config/database');

class ServerHealthService {
    constructor() {
        this.startedAt = new Date();
        this.thresholds = {
            memory: { warning: 80, critical: 95 },
            diskFreeGB: { warning: 10, critical: 2 },
            scanAgeMinutes: { warning: 5, critical: 15 },
            dbLatencyMs: { warning: 100, critical: 500 }
        };
    }

    async getFullHealth() {
        var results = await Promise.allSettled([
            this.getServerInfo(),
            this.getResources(),
            this.getDatabaseHealth(),
            this.getPipelineStatus(),
            this.getWebSocketStatus()
        ]);

        var server = results[0];
        var resources = results[1];
        var database = results[2];
        var pipeline = results[3];
        var websocket = results[4];

        var checks = this.buildHealthChecks(
            resources.status === 'fulfilled' ? resources.value : null,
            database.status === 'fulfilled' ? database.value : null,
            pipeline.status === 'fulfilled' ? pipeline.value : null
        );

        return {
            timestamp: new Date().toISOString(),
            server: server.status === 'fulfilled' ? server.value : { error: server.reason?.message },
            resources: resources.status === 'fulfilled' ? resources.value : { error: resources.reason?.message },
            database: database.status === 'fulfilled' ? database.value : { connected: false, error: database.reason?.message },
            pipeline: pipeline.status === 'fulfilled' ? pipeline.value : { error: pipeline.reason?.message },
            websocket: websocket.status === 'fulfilled' ? websocket.value : { error: websocket.reason?.message },
            health: {
                overall: this.getOverallStatus(checks),
                checks: checks
            }
        };
    }

    getServerInfo() {
        var uptimeSeconds = process.uptime();
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            uptimeSeconds: Math.floor(uptimeSeconds),
            uptimeFormatted: this.formatUptime(uptimeSeconds),
            startedAt: this.startedAt.toISOString()
        };
    }

    async getResources() {
        var totalMem = os.totalmem();
        var freeMem = os.freemem();
        var usedMem = totalMem - freeMem;
        var memInfo = process.memoryUsage();
        var cpus = os.cpus();
        var loadAvg = os.loadavg();
        var disk = await this.getDiskSpace();

        return {
            memory: {
                totalGB: +(totalMem / 1073741824).toFixed(1),
                usedGB: +(usedMem / 1073741824).toFixed(1),
                freeGB: +(freeMem / 1073741824).toFixed(1),
                usagePercent: +((usedMem / totalMem) * 100).toFixed(1),
                nodeRSS_MB: +(memInfo.rss / 1048576).toFixed(1),
                nodeHeap_MB: +(memInfo.heapUsed / 1048576).toFixed(1)
            },
            cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
                loadAvg1m: +loadAvg[0].toFixed(2),
                loadAvg5m: +loadAvg[1].toFixed(2),
                loadAvg15m: +loadAvg[2].toFixed(2)
            },
            disk: disk
        };
    }

    getDiskSpace() {
        return new Promise(function(resolve) {
            exec('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv',
                { timeout: 5000 }, function(error, stdout) {
                if (error) {
                    resolve({ drive: 'C:', totalGB: 0, freeGB: 0, usagePercent: 0, error: 'Unable to read disk info' });
                    return;
                }
                try {
                    var lines = stdout.trim().split('\n').filter(function(l) { return l.trim().length > 0; });
                    var dataLine = lines[lines.length - 1];
                    var parts = dataLine.split(',');
                    var freeSpace = parseInt(parts[1]);
                    var totalSize = parseInt(parts[2]);
                    if (isNaN(freeSpace) || isNaN(totalSize)) throw new Error('Parse error');
                    resolve({
                        drive: 'C:',
                        totalGB: +(totalSize / 1073741824).toFixed(1),
                        freeGB: +(freeSpace / 1073741824).toFixed(1),
                        usagePercent: +(((totalSize - freeSpace) / totalSize) * 100).toFixed(1)
                    });
                } catch (e) {
                    resolve({ drive: 'C:', totalGB: 0, freeGB: 0, usagePercent: 0, error: 'Parse error' });
                }
            });
        });
    }

    async getDatabaseHealth() {
        var start = Date.now();
        try {
            var versionResult = await pool.query('SELECT version()');
            var latency = Date.now() - start;

            var sizeResult = await pool.query(
                "SELECT pg_database_size(current_database()) as size_bytes"
            );

            var countsResult = await pool.query(
                "SELECT " +
                "(SELECT COUNT(*) FROM raw_scans) as raw_scans_count, " +
                "(SELECT COUNT(*) FROM equipment_metrics) as metrics_count, " +
                "(SELECT COUNT(*) FROM equipment_design) as design_count"
            );

            return {
                connected: true,
                latencyMs: latency,
                version: versionResult.rows[0].version.split(' ').slice(0, 2).join(' '),
                sizeMB: +(parseInt(sizeResult.rows[0].size_bytes) / 1048576).toFixed(1),
                tables: {
                    raw_scans: parseInt(countsResult.rows[0].raw_scans_count),
                    equipment_metrics: parseInt(countsResult.rows[0].metrics_count),
                    equipment_design: parseInt(countsResult.rows[0].design_count)
                }
            };
        } catch (error) {
            return { connected: false, error: error.message, latencyMs: Date.now() - start };
        }
    }

    async getPipelineStatus() {
        try {
            var result = await pool.query(
                "SELECT " +
                "(SELECT MAX(scanned_at) FROM raw_scans) as last_scan, " +
                "(SELECT MAX(calculated_at) FROM equipment_metrics) as last_calc, " +
                "(SELECT COUNT(*) FROM equipment_design WHERE is_active = true) as active_equipment, " +
                "(SELECT COUNT(DISTINCT equipment_id) FROM raw_scans " +
                " WHERE scanned_at > NOW() - INTERVAL '10 minutes') as recent_equipment"
            );

            var row = result.rows[0];
            var lastScan = row.last_scan ? new Date(row.last_scan) : null;
            var lastCalc = row.last_calc ? new Date(row.last_calc) : null;
            var now = new Date();

            return {
                lastRawScan: lastScan ? lastScan.toISOString() : null,
                lastRawScanAge: lastScan ? this.formatAge(now - lastScan) : 'No data',
                lastMetricsCalc: lastCalc ? lastCalc.toISOString() : null,
                lastMetricsCalcAge: lastCalc ? this.formatAge(now - lastCalc) : 'No data',
                schedulerActive: lastScan ? (now - lastScan) < 120000 : false,
                pulseActive: lastCalc ? (now - lastCalc) < 120000 : false,
                activeEquipment: parseInt(row.active_equipment),
                equipmentWithRecentData: parseInt(row.recent_equipment)
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    getWebSocketStatus() {
        var io = global.io || null;
        var wss = global.wss || null;
        var clients = 0;
        var rooms = [];

        if (io) {
            clients = io.engine?.clientsCount || 0;
            var roomMap = io.sockets?.adapter?.rooms;
            if (roomMap) {
                roomMap.forEach(function(value, key) {
                    if (key.startsWith('line:')) rooms.push(key);
                });
            }
        } else if (wss) {
            clients = wss.clients?.size || 0;
        }

        return { connectedClients: clients, rooms: rooms };
    }

    buildHealthChecks(resources, database, pipeline) {
        var checks = [];
        var self = this;

        // Database Connection
        if (database) {
            var dbStatus = 'critical';
            if (database.connected) {
                dbStatus = database.latencyMs < self.thresholds.dbLatencyMs.warning ? 'ok' :
                           database.latencyMs < self.thresholds.dbLatencyMs.critical ? 'warning' : 'critical';
            }
            checks.push({
                name: 'Database Connection',
                status: dbStatus,
                detail: database.connected ? database.latencyMs + 'ms latency' : 'Disconnected: ' + database.error
            });
        }

        // Data Freshness
        if (pipeline && pipeline.lastRawScan) {
            var scanAge = (new Date() - new Date(pipeline.lastRawScan)) / 60000;
            checks.push({
                name: 'Data Freshness',
                status: scanAge < self.thresholds.scanAgeMinutes.warning ? 'ok' :
                        scanAge < self.thresholds.scanAgeMinutes.critical ? 'warning' : 'critical',
                detail: pipeline.lastRawScanAge
            });
        } else {
            checks.push({ name: 'Data Freshness', status: 'critical', detail: 'No scan data available' });
        }

        // Memory Usage
        if (resources && resources.memory) {
            checks.push({
                name: 'Memory Usage',
                status: resources.memory.usagePercent < self.thresholds.memory.warning ? 'ok' :
                        resources.memory.usagePercent < self.thresholds.memory.critical ? 'warning' : 'critical',
                detail: resources.memory.usagePercent + '% used (' + resources.memory.freeGB + ' GB free)'
            });
        }

        // Disk Space
        if (resources && resources.disk && !resources.disk.error) {
            checks.push({
                name: 'Disk Space',
                status: resources.disk.freeGB > self.thresholds.diskFreeGB.warning ? 'ok' :
                        resources.disk.freeGB > self.thresholds.diskFreeGB.critical ? 'warning' : 'critical',
                detail: resources.disk.freeGB + ' GB free (' + resources.disk.usagePercent + '% used)'
            });
        }

        // Scheduler (inferred)
        if (pipeline) {
            checks.push({
                name: 'Scheduler Service',
                status: pipeline.schedulerActive ? 'ok' : 'critical',
                detail: pipeline.schedulerActive ? 'Active (data flowing)' : 'No recent data - may be stopped'
            });
        }

        // Pulse (inferred)
        if (pipeline) {
            checks.push({
                name: 'Pulse Service',
                status: pipeline.pulseActive ? 'ok' : 'critical',
                detail: pipeline.pulseActive ? 'Active (metrics updating)' : 'No recent updates - may be stopped'
            });
        }

        return checks;
    }

    getOverallStatus(checks) {
        if (checks.some(function(c) { return c.status === 'critical'; })) return 'critical';
        if (checks.some(function(c) { return c.status === 'warning'; })) return 'warning';
        return 'healthy';
    }

    formatUptime(seconds) {
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    formatAge(ms) {
        var seconds = Math.floor(ms / 1000);
        if (seconds < 60) return seconds + 's ago';
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm ago';
        var days = Math.floor(hours / 24);
        return days + 'd ' + (hours % 24) + 'h ago';
    }
}

module.exports = ServerHealthService;