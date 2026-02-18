/**
 * VSM Server con API REST + WebSocket
 * 
 * REST Endpoints:
 *   GET /api/health, /api/metrics, /api/summary, /api/vsm
 *   GET /api/metrics/:equipmentId/hourly          - Hourly piece count breakdown
 *   GET /api/metrics/:equipmentId/hourly/:hour     - Raw scan detail for specific hour
 * 
 * WebSocket Events:
 *   'metrics-update' - Push cada vez que se recalculan metricas
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { pool } = require('../../../config/database');
const logger = require('../../../config/logger');

// Hourly Metrics - Repository + Service (Dependency Injection)
const HourlyMetricsRepository = require('../../infrastructure/repositories/HourlyMetricsRepository');
const HourlyMetricsService = require('../../application/services/HourlyMetricsService');

const hourlyMetricsRepo = new HourlyMetricsRepository(pool);
const hourlyMetricsService = new HourlyMetricsService(hourlyMetricsRepo);

// Ensure DB index exists on startup (non-blocking)
hourlyMetricsRepo.ensureIndex().catch(function(err) {
    logger.warn('Could not verify hourly index: ' + err.message);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// ==================== REST ENDPOINTS ====================

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'ok', 
            timestamp: new Date().toISOString(),
            database: 'connected',
            websocket_clients: io.engine.clientsCount
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.get('/api/metrics', async (req, res) => {
    try {
        const data = await getMetrics();
        res.json({ success: true, count: data.length, timestamp: new Date().toISOString(), data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/metrics/:equipmentId', async (req, res) => {
    try {
        const query = `
            SELECT em.*, ed.equipment_name, ed.process_name, ed.design_ct, ed.target_oee, ed.is_parallel
            FROM equipment_metrics em
            LEFT JOIN equipment_design ed ON em.equipment_id = ed.equipment_id
            WHERE em.equipment_id = $1
        `;
        const result = await pool.query(query, [req.params.equipmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Equipment not found' });
        }
        res.json({ success: true, timestamp: new Date().toISOString(), data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== HOURLY BREAKDOWN ENDPOINTS ====================

/**
 * GET /api/metrics/:equipmentId/hourly
 * Returns 24-hour piece count breakdown for today (or specified date).
 * Query params: ?date=YYYY-MM-DD (optional)
 */
app.get('/api/metrics/:equipmentId/hourly', async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const { date } = req.query;

        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        const data = await hourlyMetricsService.getHourlyBreakdown(equipmentId, date || null);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            ...data
        });

    } catch (error) {
        logger.error('Hourly breakdown error: ' + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/metrics/:equipmentId/hourly/:hour
 * Returns raw scan records for a specific hour - the evidence behind the bar.
 * Query params: ?date=YYYY-MM-DD (optional)
 */
app.get('/api/metrics/:equipmentId/hourly/:hour', async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const hour = parseInt(req.params.hour);
        const { date } = req.query;

        if (isNaN(hour) || hour < 0 || hour > 23) {
            return res.status(400).json({
                success: false,
                error: 'Hour must be 0-23'
            });
        }

        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        const data = await hourlyMetricsService.getHourlyDetails(equipmentId, hour, date || null);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            ...data
        });

    } catch (error) {
        logger.error('Hourly detail error: ' + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== EXISTING ENDPOINTS ====================

app.get('/api/summary', async (req, res) => {
    try {
        const data = await getSummary();
        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/vsm', async (req, res) => {
    try {
        const data = await getVSMData();
        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/equipment/:equipmentId/design-ct
app.put('/api/equipment/:equipmentId/design-ct', async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const { design_ct } = req.body;

        if (design_ct === undefined || design_ct === null) {
            return res.status(400).json({ success: false, error: 'design_ct is required' });
        }
        const value = parseFloat(design_ct);
        if (isNaN(value) || value <= 0) {
            return res.status(400).json({ success: false, error: 'design_ct must be a positive number' });
        }

        const result = await pool.query(
            'UPDATE equipment_design SET design_ct = $1 WHERE equipment_id = $2 RETURNING equipment_id, design_ct',
            [Math.round(value * 100) / 100, equipmentId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Equipment not found' });
        }

        logger.info('Design CT updated: ' + equipmentId + ' = ' + result.rows[0].design_ct + 's');
        res.json({ success: true, ...result.rows[0] });
    } catch (error) {
        logger.error('Error updating design CT:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/equipment/:equipmentId/csv-url
app.put('/api/equipment/:equipmentId/csv-url', async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const { csv_url } = req.body;

        if (!csv_url || typeof csv_url !== 'string' || csv_url.trim() === '') {
            return res.status(400).json({ success: false, error: 'csv_url is required' });
        }
        if (!csv_url.startsWith('http://') && !csv_url.startsWith('https://')) {
            return res.status(400).json({ success: false, error: 'csv_url must start with http:// or https://' });
        }

        const result = await pool.query(
            'UPDATE equipment_design SET csv_url = $1 WHERE equipment_id = $2 RETURNING equipment_id, csv_url',
            [csv_url.trim(), equipmentId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Equipment not found' });
        }

        logger.info('CSV URL updated: ' + equipmentId + ' = ' + result.rows[0].csv_url);
        res.json({ success: true, ...result.rows[0] });
    } catch (error) {
        logger.error('Error updating CSV URL:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ==================== DATA FUNCTIONS ====================

async function getMetrics() {
    const query = `
        SELECT em.*, ed.equipment_name, ed.process_name, ed.design_ct, ed.target_oee, ed.is_parallel
        FROM equipment_metrics em
        LEFT JOIN equipment_design ed ON em.equipment_id = ed.equipment_id
        ORDER BY ed.process_name, em.equipment_id
    `;
    const result = await pool.query(query);
    return result.rows;
}

async function getSummary() {
    const query = `
        SELECT 
            COALESCE(ed.process_name, 'Unknown') as process_name,
            COUNT(em.equipment_id) as equipment_count,
            ROUND(AVG(em.ct_equipo_realtime)::numeric, 1) as avg_ct_realtime,
            ROUND(AVG(em.ct_equipo_hour)::numeric, 1) as avg_ct_hour,
            ROUND(AVG(em.ct_equipo_shift)::numeric, 1) as avg_ct_shift,
            SUM(em.pieces_ok_shift) as total_pieces_ok,
            SUM(em.pieces_ng_shift) as total_pieces_ng,
            ROUND(AVG(ed.design_ct)::numeric, 1) as design_ct
        FROM equipment_metrics em
        LEFT JOIN equipment_design ed ON em.equipment_id = ed.equipment_id
        GROUP BY ed.process_name
        ORDER BY ed.process_name
    `;
    const result = await pool.query(query);
    
    const totals = {
        total_equipment: result.rows.reduce((sum, r) => sum + parseInt(r.equipment_count), 0),
        total_pieces_ok: result.rows.reduce((sum, r) => sum + parseInt(r.total_pieces_ok || 0), 0),
        total_pieces_ng: result.rows.reduce((sum, r) => sum + parseInt(r.total_pieces_ng || 0), 0)
    };
    
    return { totals, processes: result.rows };
}

async function getVSMData() {
    const query = `
        SELECT 
            em.equipment_id, em.ct_equipo_realtime, em.ct_proceso_realtime,
            em.ct_equipo_hour, em.ct_proceso_hour, em.ct_equipo_shift, em.ct_proceso_shift, em.pieces_ok_shift, em.pieces_ng_shift,
            em.samples_shift, em.stddev_shift, em.shift_name, em.last_serial, 
            em.last_scan_at, em.calculated_at,
            ed.equipment_name, ed.process_name, ed.design_ct, ed.target_oee, ed.is_parallel, ed.csv_url,
            lp.process_order, lp.is_bottleneck, lp.parallel_group, lp.is_parallel as lp_is_parallel, lp.sub_line_group
        FROM equipment_metrics em
        LEFT JOIN equipment_design ed ON em.equipment_id = ed.equipment_id
        LEFT JOIN line_processes lp ON em.equipment_id = lp.equipment_id
        ORDER BY lp.process_order, lp.parallel_group NULLS FIRST, em.equipment_id
    `;
    const result = await pool.query(query);
    
    const processes = {};
    for (const row of result.rows) {
        const processName = row.process_name || 'Unknown';
        if (!processes[processName]) {
            processes[processName] = {
                process_name: processName,
                process_order: row.process_order,
                design_ct: row.design_ct,
                has_parallel_lines: false,
                sub_line_group: row.sub_line_group,
                equipments: []
            };
        }
        if (row.lp_is_parallel) {
            processes[processName].has_parallel_lines = true;
        }
        processes[processName].equipments.push(row);
    }
    
    return { shift: result.rows[0]?.shift_name || 'Unknown', processes: Object.values(processes) };
}

// ==================== WEBSOCKET ====================

io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);
    
    getVSMData().then(data => {
        socket.emit('vsm-data', { timestamp: new Date().toISOString(), ...data });
    });
    
    socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
    
    socket.on('request-update', async () => {
        const data = await getVSMData();
        socket.emit('vsm-data', { timestamp: new Date().toISOString(), ...data });
    });
});

setInterval(async () => {
    if (io.engine.clientsCount > 0) {
        try {
            const data = await getVSMData();
            io.emit('vsm-data', { timestamp: new Date().toISOString(), ...data });
        } catch (error) {
            logger.error('WebSocket broadcast error:', error.message);
        }
    }
}, 5000);

// ==================== RT PULSE ENDPOINT ====================

app.post('/api/internal/rt-pulse', async (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIP)) {
            logger.warn('RT pulse rejected from ' + clientIP);
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { equipment_id, ct_equipo, ct_proceso, last_serial, last_scan_at } = req.body;

        if (!equipment_id) {
            return res.status(400).json({ error: 'equipment_id required' });
        }

        await pool.query(
            'UPDATE equipment_metrics SET ct_equipo_realtime = $2, ct_proceso_realtime = $3, last_serial = $4, last_scan_at = $5 WHERE equipment_id = $1',
            [equipment_id, ct_equipo, ct_proceso, last_serial, last_scan_at]
        );

        io.emit('rt-pulse', {
            equipment_id,
            ct_equipo,
            ct_proceso,
            last_serial,
            last_scan_at,
            timestamp: new Date().toISOString()
        });

        res.json({ ok: true });

    } catch (error) {
        logger.error('RT pulse error: ' + error.message);
        res.status(500).json({ error: error.message });
    }
});

// ==================== START SERVER ====================

server.listen(PORT, () => {
    logger.info(`VSM Server running on http://localhost:${PORT}`);
    logger.info('REST: /api/health, /api/metrics, /api/metrics/:id/hourly, /api/metrics/:id/hourly/:hour, /api/summary, /api/vsm');
    logger.info('WebSocket: ws://localhost:' + PORT);
});

module.exports = { app, io };

