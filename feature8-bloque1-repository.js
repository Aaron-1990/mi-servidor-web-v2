// ============================================================================
// Feature 8 - Bloque 1: Extend EquipmentDesignRepository (class-based)
// Run: node feature8-bloque1-repository.js
// Location: Run from C:\Aplicaciones\mi-servidor-web-v2
// ============================================================================
const fs = require('fs');
const path = require('path');

const REPO_PATH = path.join(__dirname, 'src', 'infrastructure', 'repositories', 'EquipmentDesignRepository.js');

// --- Read current file ---
let content = fs.readFileSync(REPO_PATH, 'utf8');
console.log('[INFO] Read EquipmentDesignRepository.js (' + content.length + ' chars)');

// --- Verify it is the class-based pattern ---
if (!content.includes('class EquipmentDesignRepository')) {
  console.error('[ERROR] class EquipmentDesignRepository not found');
  process.exit(1);
}
if (!content.includes('getActiveEquipments')) {
  console.error('[ERROR] getActiveEquipments not found');
  process.exit(1);
}
console.log('[OK] Class-based pattern confirmed');

// --- Check if already patched ---
if (content.includes('createEquipment')) {
  console.log('[SKIP] createEquipment already exists - already patched');
  process.exit(0);
}

// --- Build new methods (class methods with proper indentation) ---
var D = 'String.fromCharCode(36)';
var L = [];
L.push('');
L.push('    // ================================================================');
L.push('    // Feature 8: Equipment CRUD Operations (added 2026-02-19)');
L.push('    // ================================================================');
L.push('');
L.push('    // --- CREATE: Atomic transaction (3 INSERTs) ---');
L.push('    async createEquipment(data) {');
L.push('        const client = await pool.connect();');
L.push('        try {');
L.push('            await client.query("BEGIN");');
L.push('            const D = ' + D + ';');
L.push('');
L.push('            // 1. INSERT equipment_design');
L.push('            const insertDesign = "INSERT INTO equipment_design"');
L.push('                + " (equipment_id, equipment_name, process_name, csv_url, design_ct,"');
L.push('                + " target_oee, equipment_type, is_parallel, is_active)"');
L.push('                + " VALUES (" + D + "1, " + D + "2, " + D + "3, " + D + "4, " + D + "5,"');
L.push('                + " " + D + "6, " + D + "7, " + D + "8, true) RETURNING id";');
L.push('            const designResult = await client.query(insertDesign, [');
L.push('                data.equipment_id,');
L.push('                data.equipment_name,');
L.push('                data.process_name,');
L.push('                data.csv_url || null,');
L.push('                data.design_ct,');
L.push('                data.target_oee || 85,');
L.push('                data.equipment_type,');
L.push('                data.is_parallel || false');
L.push('            ]);');
L.push('');
L.push('            // 2. INSERT line_processes');
L.push('            const insertLP = "INSERT INTO line_processes"');
L.push('                + " (line_id, equipment_id, process_order, is_parallel, parallel_group, sub_line_group)"');
L.push('                + " VALUES (" + D + "1, " + D + "2, " + D + "3, " + D + "4, " + D + "5, " + D + "6)";');
L.push('            await client.query(insertLP, [');
L.push('                data.line_id,');
L.push('                data.equipment_id,');
L.push('                data.process_order,');
L.push('                data.is_parallel || false,');
L.push('                data.parallel_group || null,');
L.push('                data.sub_line_group || null');
L.push('            ]);');
L.push('');
L.push('            // 3. INSERT equipment_metrics (initialized with nulls)');
L.push('            const insertMetrics = "INSERT INTO equipment_metrics (equipment_id) VALUES (" + D + "1)";');
L.push('            await client.query(insertMetrics, [data.equipment_id]);');
L.push('');
L.push('            await client.query("COMMIT");');
L.push('            logger.info("[REPO] Equipment created: " + data.equipment_id);');
L.push('            return { success: true, equipment_id: data.equipment_id, design_id: designResult.rows[0].id };');
L.push('');
L.push('        } catch (err) {');
L.push('            await client.query("ROLLBACK");');
L.push('            logger.error("[REPO] createEquipment ROLLBACK: " + err.message);');
L.push('            throw err;');
L.push('        } finally {');
L.push('            client.release();');
L.push('        }');
L.push('    }');
L.push('');
L.push('    // --- UPDATE: equipment_design + line_processes in transaction ---');
L.push('    async updateEquipment(equipmentId, data) {');
L.push('        const client = await pool.connect();');
L.push('        try {');
L.push('            await client.query("BEGIN");');
L.push('            const D = ' + D + ';');
L.push('');
L.push('            // Dynamic SET for equipment_design');
L.push('            var designFields = [];');
L.push('            var designValues = [];');
L.push('            var pIdx = 1;');
L.push('            ["equipment_name", "process_name", "csv_url", "design_ct",');
L.push('             "target_oee", "equipment_type", "is_parallel"].forEach(function(col) {');
L.push('                if (data[col] !== undefined) {');
L.push('                    designFields.push(col + " = " + D + pIdx);');
L.push('                    designValues.push(data[col]);');
L.push('                    pIdx++;');
L.push('                }');
L.push('            });');
L.push('');
L.push('            if (designFields.length > 0) {');
L.push('                designFields.push("updated_at = NOW()");');
L.push('                designValues.push(equipmentId);');
L.push('                var dq = "UPDATE equipment_design SET " + designFields.join(", ")');
L.push('                    + " WHERE equipment_id = " + D + pIdx;');
L.push('                await client.query(dq, designValues);');
L.push('            }');
L.push('');
L.push('            // Dynamic SET for line_processes');
L.push('            var lpFields = [];');
L.push('            var lpValues = [];');
L.push('            var lpIdx = 1;');
L.push('            ["process_order", "is_parallel", "parallel_group", "sub_line_group"].forEach(function(col) {');
L.push('                if (data[col] !== undefined) {');
L.push('                    lpFields.push(col + " = " + D + lpIdx);');
L.push('                    lpValues.push(data[col]);');
L.push('                    lpIdx++;');
L.push('                }');
L.push('            });');
L.push('');
L.push('            if (lpFields.length > 0) {');
L.push('                lpValues.push(equipmentId);');
L.push('                var lq = "UPDATE line_processes SET " + lpFields.join(", ")');
L.push('                    + " WHERE equipment_id = " + D + lpIdx;');
L.push('                await client.query(lq, lpValues);');
L.push('            }');
L.push('');
L.push('            await client.query("COMMIT");');
L.push('            logger.info("[REPO] Equipment updated: " + equipmentId);');
L.push('            return { success: true, updated: true };');
L.push('');
L.push('        } catch (err) {');
L.push('            await client.query("ROLLBACK");');
L.push('            logger.error("[REPO] updateEquipment ROLLBACK: " + err.message);');
L.push('            throw err;');
L.push('        } finally {');
L.push('            client.release();');
L.push('        }');
L.push('    }');
L.push('');
L.push('    // --- STATUS TOGGLE ---');
L.push('    async setEquipmentStatus(equipmentId, isActive) {');
L.push('        const D = ' + D + ';');
L.push('        const query = "UPDATE equipment_design SET is_active = " + D + "1, updated_at = NOW()"');
L.push('            + " WHERE equipment_id = " + D + "2 RETURNING equipment_id, is_active";');
L.push('        const result = await pool.query(query, [isActive, equipmentId]);');
L.push('        if (result.rows.length === 0) {');
L.push('            throw new Error("Equipment not found: " + equipmentId);');
L.push('        }');
L.push('        logger.info("[REPO] Equipment " + equipmentId + " status -> " + isActive);');
L.push('        return { success: true, is_active: result.rows[0].is_active };');
L.push('    }');
L.push('');
L.push('    // --- LIST: All equipment with line/process metadata ---');
L.push('    async getAllEquipment(lineId) {');
L.push('        const D = ' + D + ';');
L.push('        const query = "SELECT ed.id, ed.equipment_id, ed.equipment_name, ed.process_name,"');
L.push('            + " ed.csv_url, ed.design_ct, ed.target_oee, ed.equipment_type,"');
L.push('            + " ed.is_parallel, ed.is_active, ed.created_at, ed.updated_at,"');
L.push('            + " lp.process_order, lp.parallel_group, lp.sub_line_group, lp.line_id,"');
L.push('            + " pl.line_code, pl.line_name"');
L.push('            + " FROM equipment_design ed"');
L.push('            + " LEFT JOIN line_processes lp ON ed.equipment_id = lp.equipment_id"');
L.push('            + " LEFT JOIN production_lines pl ON lp.line_id = pl.id"');
L.push('            + " WHERE (" + D + "1::int IS NULL OR lp.line_id = " + D + "1::int)"');
L.push('            + " ORDER BY lp.process_order, ed.equipment_id";');
L.push('        const result = await pool.query(query, [lineId || null]);');
L.push('        return result.rows;');
L.push('    }');
L.push('');
L.push('    // --- PROCESSES: Distinct process names for dropdown ---');
L.push('    async getProcesses(lineCode) {');
L.push('        const D = ' + D + ';');
L.push('        const query = "SELECT DISTINCT ed.process_name"');
L.push('            + " FROM equipment_design ed"');
L.push('            + " JOIN line_processes lp ON ed.equipment_id = lp.equipment_id"');
L.push('            + " JOIN production_lines pl ON lp.line_id = pl.id"');
L.push('            + " WHERE (" + D + "1::text IS NULL OR pl.line_code = " + D + "1::text)"');
L.push('            + " AND ed.is_active = true"');
L.push('            + " ORDER BY ed.process_name";');
L.push('        const result = await pool.query(query, [lineCode || null]);');
L.push('        return result.rows.map(function(r) { return r.process_name; });');
L.push('    }');
L.push('');
L.push('    // --- VALIDATE: Check if equipment_id exists ---');
L.push('    async validateEquipmentId(equipmentId) {');
L.push('        const D = ' + D + ';');
L.push('        const query = "SELECT COUNT(*)::int AS cnt FROM equipment_design WHERE equipment_id = " + D + "1";');
L.push('        const result = await pool.query(query, [equipmentId]);');
L.push('        return { exists: result.rows[0].cnt > 0 };');
L.push('    }');
L.push('');
L.push('    // --- TEST CSV URL: HTTP GET with timeout ---');
L.push('    async testCsvUrl(url) {');
L.push('        const http = require("http");');
L.push('        return new Promise(function(resolve) {');
L.push('            try {');
L.push('                const parsed = new URL(url);');
L.push('                const options = {');
L.push('                    hostname: parsed.hostname,');
L.push('                    port: parsed.port || 80,');
L.push('                    path: parsed.pathname + parsed.search,');
L.push('                    method: "GET",');
L.push('                    timeout: 5000');
L.push('                };');
L.push('                const req = http.request(options, function(res) {');
L.push('                    let body = "";');
L.push('                    res.on("data", function(chunk) { body += chunk; });');
L.push('                    res.on("end", function() {');
L.push('                        const reachable = res.statusCode === 200;');
L.push('                        const hasData = body.indexOf("<xmp>") !== -1 || body.indexOf("<XMP>") !== -1;');
L.push('                        resolve({ reachable: reachable, hasData: hasData, statusCode: res.statusCode });');
L.push('                    });');
L.push('                });');
L.push('                req.on("timeout", function() {');
L.push('                    req.destroy();');
L.push('                    resolve({ reachable: false, hasData: false, error: "Timeout (5s)" });');
L.push('                });');
L.push('                req.on("error", function(err) {');
L.push('                    resolve({ reachable: false, hasData: false, error: err.message });');
L.push('                });');
L.push('                req.end();');
L.push('            } catch (err) {');
L.push('                resolve({ reachable: false, hasData: false, error: "Invalid URL: " + err.message });');
L.push('            }');
L.push('        });');
L.push('    }');

var newMethods = L.join('\n');

// --- Find the closing brace of the class (last } before module.exports) ---
var exportsIdx = content.indexOf('module.exports');
if (exportsIdx === -1) {
  console.error('[ERROR] module.exports not found');
  process.exit(1);
}

var classEndIdx = content.lastIndexOf('}', exportsIdx);
if (classEndIdx === -1) {
  console.error('[ERROR] Could not find class closing brace');
  process.exit(1);
}

// Insert new methods before the class closing brace
content = content.substring(0, classEndIdx) + newMethods + '\n' + content.substring(classEndIdx);

// --- Write patched file ---
fs.writeFileSync(REPO_PATH, content, 'utf8');
console.log('[OK] EquipmentDesignRepository.js patched (' + content.length + ' chars)');
console.log('[OK] Added 7 new class methods:');
console.log('     + createEquipment(data)');
console.log('     + updateEquipment(equipmentId, data)');
console.log('     + setEquipmentStatus(equipmentId, isActive)');
console.log('     + getAllEquipment(lineId)');
console.log('     + getProcesses(lineCode)');
console.log('     + validateEquipmentId(equipmentId)');
console.log('     + testCsvUrl(url)');
console.log('');
console.log('[NEXT] Run checkpoints:');
console.log('  node -e "const R = require(\'./src/infrastructure/repositories/EquipmentDesignRepository\'); const r = new R(); console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(r)).filter(m => m !== \'constructor\'))"');
