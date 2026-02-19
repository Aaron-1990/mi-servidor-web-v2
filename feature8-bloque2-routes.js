// ============================================================================
// Feature 8 - Bloque 2: API Routes for Equipment CRUD
// Run: node feature8-bloque2-routes.js
// Location: Run from C:\Aplicaciones\mi-servidor-web-v2
// ============================================================================
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.join(__dirname, 'src', 'presentation', 'api', 'server.js');

// --- Read current file ---
let content = fs.readFileSync(SERVER_PATH, 'utf8');
console.log('[INFO] Read server.js (' + content.length + ' chars)');

// --- Check if already patched ---
if (content.includes('POST /api/equipment - Create')) {
  console.log('[SKIP] Equipment CRUD routes already exist');
  process.exit(0);
}

// --- STEP 1: Add EquipmentDesignRepository import ---
var importAnchor = 'const productionLineRepo = new ProductionLineRepository();';
if (!content.includes(importAnchor)) {
  console.error('[ERROR] Cannot find productionLineRepo import anchor');
  process.exit(1);
}

var importBlock = importAnchor + '\n'
  + '\n'
  + 'const EquipmentDesignRepository = require(\'../../infrastructure/repositories/EquipmentDesignRepository\');\n'
  + 'const equipmentRepo = new EquipmentDesignRepository();';

content = content.replace(importAnchor, importBlock);
console.log('[OK] Added EquipmentDesignRepository import');

// --- STEP 2: Build 6 new routes ---
var L = [];
L.push('');
L.push('// ==================== EQUIPMENT CRUD ENDPOINTS (Feature 8) ====================');
L.push('');
L.push('// POST /api/equipment - Create new equipment (atomic 3-table transaction)');
L.push('app.post(\'/api/equipment\', async (req, res) => {');
L.push('    try {');
L.push('        const data = req.body;');
L.push('');
L.push('        // Validation');
L.push('        var errors = [];');
L.push('        if (!data.equipment_id || !/^[A-Z0-9_]+$/.test(data.equipment_id)) {');
L.push('            errors.push("equipment_id required, uppercase alphanumeric + underscore only");');
L.push('        }');
L.push('        if (!data.equipment_name || data.equipment_name.length > 100) {');
L.push('            errors.push("equipment_name required, max 100 chars");');
L.push('        }');
L.push('        if (!data.process_name || !/^[A-Za-z0-9_ ]+$/.test(data.process_name)) {');
L.push('            errors.push("process_name required");');
L.push('        }');
L.push('        if (data.design_ct === undefined || parseFloat(data.design_ct) <= 0) {');
L.push('            errors.push("design_ct must be a positive number");');
L.push('        }');
L.push('        if (!data.equipment_type || !["BREQ_BCMP", "BCMP_ONLY"].includes(data.equipment_type)) {');
L.push('            errors.push("equipment_type must be BREQ_BCMP or BCMP_ONLY");');
L.push('        }');
L.push('        if (!data.line_id) {');
L.push('            errors.push("line_id is required");');
L.push('        }');
L.push('        if (!data.process_order || parseInt(data.process_order) < 1) {');
L.push('            errors.push("process_order must be a positive integer");');
L.push('        }');
L.push('        if (data.is_parallel && (data.parallel_group === undefined || data.parallel_group === null)) {');
L.push('            errors.push("parallel_group required for parallel equipment");');
L.push('        }');
L.push('        if (data.target_oee !== undefined && (data.target_oee < 0 || data.target_oee > 100)) {');
L.push('            errors.push("target_oee must be 0-100");');
L.push('        }');
L.push('');
L.push('        if (errors.length > 0) {');
L.push('            return res.status(400).json({ success: false, error: "Validation failed", details: errors });');
L.push('        }');
L.push('');
L.push('        // Check uniqueness');
L.push('        var existing = await equipmentRepo.validateEquipmentId(data.equipment_id);');
L.push('        if (existing.exists) {');
L.push('            return res.status(409).json({ success: false, error: "Equipment ID already exists: " + data.equipment_id });');
L.push('        }');
L.push('');
L.push('        // Normalize numeric fields');
L.push('        data.design_ct = parseFloat(data.design_ct);');
L.push('        data.line_id = parseInt(data.line_id);');
L.push('        data.process_order = parseInt(data.process_order);');
L.push('        data.is_parallel = !!data.is_parallel;');
L.push('        if (data.parallel_group !== undefined && data.parallel_group !== null) {');
L.push('            data.parallel_group = parseInt(data.parallel_group);');
L.push('        }');
L.push('');
L.push('        var result = await equipmentRepo.createEquipment(data);');
L.push('        logger.info("Equipment created via API: " + data.equipment_id);');
L.push('        res.status(201).json(result);');
L.push('');
L.push('    } catch (error) {');
L.push('        logger.error("Error creating equipment: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');
L.push('');
L.push('// PUT /api/equipment/:equipmentId - Update equipment');
L.push('app.put(\'/api/equipment/:equipmentId\', async (req, res) => {');
L.push('    try {');
L.push('        var equipmentId = req.params.equipmentId;');
L.push('        var data = req.body;');
L.push('');
L.push('        // Verify equipment exists');
L.push('        var check = await equipmentRepo.validateEquipmentId(equipmentId);');
L.push('        if (!check.exists) {');
L.push('            return res.status(404).json({ success: false, error: "Equipment not found: " + equipmentId });');
L.push('        }');
L.push('');
L.push('        // Normalize if present');
L.push('        if (data.design_ct !== undefined) data.design_ct = parseFloat(data.design_ct);');
L.push('        if (data.process_order !== undefined) data.process_order = parseInt(data.process_order);');
L.push('        if (data.parallel_group !== undefined && data.parallel_group !== null) {');
L.push('            data.parallel_group = parseInt(data.parallel_group);');
L.push('        }');
L.push('');
L.push('        var result = await equipmentRepo.updateEquipment(equipmentId, data);');
L.push('        logger.info("Equipment updated via API: " + equipmentId);');
L.push('        res.json(result);');
L.push('');
L.push('    } catch (error) {');
L.push('        logger.error("Error updating equipment: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');
L.push('');
L.push('// PUT /api/equipment/:equipmentId/status - Toggle active/inactive');
L.push('app.put(\'/api/equipment/:equipmentId/status\', async (req, res) => {');
L.push('    try {');
L.push('        var equipmentId = req.params.equipmentId;');
L.push('        var isActive = req.body.is_active;');
L.push('');
L.push('        if (typeof isActive !== "boolean") {');
L.push('            return res.status(400).json({ success: false, error: "is_active must be a boolean" });');
L.push('        }');
L.push('');
L.push('        var result = await equipmentRepo.setEquipmentStatus(equipmentId, isActive);');
L.push('        logger.info("Equipment status changed: " + equipmentId + " -> " + isActive);');
L.push('        res.json(result);');
L.push('');
L.push('    } catch (error) {');
L.push('        if (error.message.includes("not found")) {');
L.push('            return res.status(404).json({ success: false, error: error.message });');
L.push('        }');
L.push('        logger.error("Error toggling equipment status: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');
L.push('');
L.push('// GET /api/equipment - List all equipment (optional filter by line_id)');
L.push('app.get(\'/api/equipment\', async (req, res) => {');
L.push('    try {');
L.push('        var lineId = req.query.line_id ? parseInt(req.query.line_id) : null;');
L.push('        var rows = await equipmentRepo.getAllEquipment(lineId);');
L.push('        res.json({ success: true, equipment: rows, count: rows.length });');
L.push('    } catch (error) {');
L.push('        logger.error("Error listing equipment: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');
L.push('');
L.push('// GET /api/processes - Distinct process names (optional filter by line_code)');
L.push('app.get(\'/api/processes\', async (req, res) => {');
L.push('    try {');
L.push('        var lineCode = req.query.line_code || null;');
L.push('        var processes = await equipmentRepo.getProcesses(lineCode);');
L.push('        res.json({ success: true, processes: processes });');
L.push('    } catch (error) {');
L.push('        logger.error("Error listing processes: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');
L.push('');
L.push('// POST /api/equipment/test-url - Test CSV URL connectivity');
L.push('app.post(\'/api/equipment/test-url\', async (req, res) => {');
L.push('    try {');
L.push('        var url = req.body.url;');
L.push('        if (!url || typeof url !== "string") {');
L.push('            return res.status(400).json({ success: false, error: "url is required" });');
L.push('        }');
L.push('        if (!url.startsWith("http://") && !url.startsWith("https://")) {');
L.push('            return res.status(400).json({ success: false, error: "url must start with http:// or https://" });');
L.push('        }');
L.push('        var result = await equipmentRepo.testCsvUrl(url);');
L.push('        res.json({ success: true, ...result });');
L.push('    } catch (error) {');
L.push('        logger.error("Error testing CSV URL: " + error.message);');
L.push('        res.status(500).json({ success: false, error: error.message });');
L.push('    }');
L.push('});');

var newRoutes = L.join('\n');

// --- STEP 3: Insert routes before DATA FUNCTIONS section ---
var insertAnchor = '// ==================== DATA FUNCTIONS ====================';
if (!content.includes(insertAnchor)) {
  console.error('[ERROR] Cannot find DATA FUNCTIONS anchor');
  process.exit(1);
}

content = content.replace(insertAnchor, newRoutes + '\n\n' + insertAnchor);
console.log('[OK] Inserted 6 new routes before DATA FUNCTIONS');

// --- Write patched file ---
fs.writeFileSync(SERVER_PATH, content, 'utf8');
console.log('[OK] server.js patched (' + content.length + ' chars)');
console.log('');
console.log('Routes added:');
console.log('  POST   /api/equipment');
console.log('  PUT    /api/equipment/:equipmentId');
console.log('  PUT    /api/equipment/:equipmentId/status');
console.log('  GET    /api/equipment');
console.log('  GET    /api/processes');
console.log('  POST   /api/equipment/test-url');
console.log('');
console.log('[IMPORTANT] Restart VSM-API service to load changes:');
console.log('  nssm restart VSM-API');
