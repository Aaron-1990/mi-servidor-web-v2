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
const { ipFilterMiddleware } = require('../../../config/security');

// Hourly Metrics - Repository + Service (Dependency Injection)
const HourlyMetricsRepository = require('../../infrastructure/repositories/HourlyMetricsRepository');
const HourlyMetricsService = require('../../application/services/HourlyMetricsService');

const ProductionLineRepository = require('../../infrastructure/repositories/ProductionLineRepository');
const productionLineRepo = new ProductionLineRepository();

const EquipmentDesignRepository = require('../../infrastructure/repositories/EquipmentDesignRepository');
const equipmentRepo = new EquipmentDesignRepository();

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
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", "ws://localhost:3000", "http://localhost:3000", "ws://10.3.0.200:3000", "http://10.3.0.200:3000"]
        },
        useDefaults: false
    },
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false
}));
app.use(function(req, res, next) {
    res.removeHeader('Content-Security-Policy-Report-Only');
    next();
});
app.use(cors());
app.use(express.json());
app.use(ipFilterMiddleware);

// Serve static files (public folder)
var path = require('path');
app.use(express.static(path.join(__dirname, '..', '..', '..', 'public')));

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

// Serve monitor page for any line
app.get('/monitor/:lineCode', (req, res) => {
    const path = require('path');
    res.sendFile(path.join(__dirname, '..', '..', '..', 'public', 'monitor.html'));
});

    // Admin monitor - same page, admin mode detected by URL
    app.get('/admin/monitor/:lineCode', (req, res) => {
        const path = require('path');
        res.sendFile(path.join(__dirname, '..', '..', '..', 'public', 'monitor.html'));
    });

// Serve admin page
app.get('/admin', (req, res) => {
    const path = require('path');
    res.sendFile(path.join(__dirname, '..', '..', '..', 'public', 'admin.html'));
});

// GET /api/lines - List active production lines
app.get('/api/lines', async (req, res) => {
    try {
        const lines = await productionLineRepo.getActiveLines();
        const linesWithCount = await Promise.all(lines.map(async (line) => {
            const equipCount = await productionLineRepo.getEquipmentCount(line.id);
            return { ...line, equipment_count: equipCount };
        }));
        res.json({ success: true, lines: linesWithCount });
    } catch (error) {
        logger.error('Error fetching lines: ' + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/vsm/:lineCode - VSM data filtered by production line
app.get('/api/vsm/:lineCode', async (req, res) => {
    try {
        const data = await getVSMData(req.params.lineCode);
        res.json({ success: true, timestamp: new Date().toISOString(), ...data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/vsm - backward compatible (defaults to GPEC5_L1)
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



// ==================== EQUIPMENT CRUD ENDPOINTS (Feature 8) ====================

// POST /api/equipment - Create new equipment (atomic 3-table transaction)
app.post('/api/equipment', async (req, res) => {
    try {
        const data = req.body;

        // Validation
        var errors = [];
        if (!data.equipment_id || !/^[A-Z0-9_]+$/.test(data.equipment_id)) {
            errors.push("equipment_id required, uppercase alphanumeric + underscore only");
        }
        if (!data.equipment_name || data.equipment_name.length > 100) {
            errors.push("equipment_name required, max 100 chars");
        }
        if (!data.process_name || !/^[A-Za-z0-9_ ]+$/.test(data.process_name)) {
            errors.push("process_name required");
        }
        if (data.design_ct === undefined || parseFloat(data.design_ct) <= 0) {
            errors.push("design_ct must be a positive number");
        }
        if (!data.equipment_type || !["BREQ_BCMP", "BCMP_ONLY"].includes(data.equipment_type)) {
            errors.push("equipment_type must be BREQ_BCMP or BCMP_ONLY");
        }
        if (!data.line_id) {
            errors.push("line_id is required");
        }
        if (!data.process_order || parseInt(data.process_order) < 1) {
            errors.push("process_order must be a positive integer");
        }
        if (data.is_parallel && (data.parallel_group === undefined || data.parallel_group === null)) {
            errors.push("parallel_group required for parallel equipment");
        }
        if (data.target_oee !== undefined && (data.target_oee < 0 || data.target_oee > 100)) {
            errors.push("target_oee must be 0-100");
        }

        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: "Validation failed", details: errors });
        }

        // Check uniqueness
        var existing = await equipmentRepo.validateEquipmentId(data.equipment_id);
        if (existing.exists) {
            return res.status(409).json({ success: false, error: "Equipment ID already exists: " + data.equipment_id });
        }

        // Normalize numeric fields
        data.design_ct = parseFloat(data.design_ct);
        data.line_id = parseInt(data.line_id);
        data.process_order = parseInt(data.process_order);
        data.is_parallel = !!data.is_parallel;
        if (data.parallel_group !== undefined && data.parallel_group !== null) {
            data.parallel_group = parseInt(data.parallel_group);
        }

        var result = await equipmentRepo.createEquipment(data);
        logger.info("Equipment created via API: " + data.equipment_id);
        res.status(201).json(result);

    } catch (error) {
        logger.error("Error creating equipment: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/equipment/:equipmentId - Update equipment
app.put('/api/equipment/:equipmentId', async (req, res) => {
    try {
        var equipmentId = req.params.equipmentId;
        var data = req.body;

        // Verify equipment exists
        var check = await equipmentRepo.validateEquipmentId(equipmentId);
        if (!check.exists) {
            return res.status(404).json({ success: false, error: "Equipment not found: " + equipmentId });
        }

        // Normalize if present
        if (data.design_ct !== undefined) data.design_ct = parseFloat(data.design_ct);
        if (data.process_order !== undefined) data.process_order = parseInt(data.process_order);
        if (data.parallel_group !== undefined && data.parallel_group !== null) {
            data.parallel_group = parseInt(data.parallel_group);
        }

        var result = await equipmentRepo.updateEquipment(equipmentId, data);
        logger.info("Equipment updated via API: " + equipmentId);
        res.json(result);

    } catch (error) {
        logger.error("Error updating equipment: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/equipment/:equipmentId/status - Toggle active/inactive
app.put('/api/equipment/:equipmentId/status', async (req, res) => {
    try {
        var equipmentId = req.params.equipmentId;
        var isActive = req.body.is_active;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({ success: false, error: "is_active must be a boolean" });
        }

        var result = await equipmentRepo.setEquipmentStatus(equipmentId, isActive);
        logger.info("Equipment status changed: " + equipmentId + " -> " + isActive);
        res.json(result);

    } catch (error) {
        if (error.message.includes("not found")) {
            return res.status(404).json({ success: false, error: error.message });
        }
        logger.error("Error toggling equipment status: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/equipment - List all equipment (optional filter by line_id)
app.get('/api/equipment', async (req, res) => {
    try {
        var lineId = req.query.line_id ? parseInt(req.query.line_id) : null;
        var rows = await equipmentRepo.getAllEquipment(lineId);
        res.json({ success: true, equipment: rows, count: rows.length });
    } catch (error) {
        logger.error("Error listing equipment: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/processes - Distinct process names (optional filter by line_code)
app.get('/api/processes', async (req, res) => {
    try {
        var lineCode = req.query.line_code || null;
        var processes = await equipmentRepo.getProcesses(lineCode);
        res.json({ success: true, processes: processes });
    } catch (error) {
        logger.error("Error listing processes: " + error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/equipment/test-url - Test CSV URL connectivity
app.post('/api/equipment/test-url', async (req, res) => {
    try {
        var url = req.body.url;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ success: false, error: "url is required" });
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return res.status(400).json({ success: false, error: "url must start with http:// or https://" });
        }
        var result = await equipmentRepo.testCsvUrl(url);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error("Error testing CSV URL: " + error.message);
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
    const result = await pool.query(query, [lineCode || null]);
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

async function getVSMData(lineCode) {
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
    
    socket.on('join-line', function(lineCode) {
        socket.join('line:' + lineCode);
        logger.info('Socket ' + socket.id + ' joined room line:' + lineCode);
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



