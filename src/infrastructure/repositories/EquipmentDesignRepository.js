// src/infrastructure/repositories/EquipmentDesignRepository.js
const { pool } = require('../../../config/database');
const logger = require('../../../config/logger');

class EquipmentDesignRepository {
    
    async getActiveEquipments() {
        const result = await pool.query(
            `SELECT equipment_id, equipment_name, process_name, csv_url, 
                    design_ct, target_oee, equipment_type, is_parallel
             FROM equipment_design 
             WHERE is_active = true AND csv_url IS NOT NULL
             ORDER BY process_name, equipment_id`
        );
        return result.rows;
    }

    async getByEquipmentId(equipmentId) {
        const result = await pool.query(
            `SELECT * FROM equipment_design WHERE equipment_id = $1`,
            [equipmentId]
        );
        return result.rows[0] || null;
    }

    async getAll() {
        const result = await pool.query(
            `SELECT * FROM equipment_design ORDER BY process_name, equipment_id`
        );
        return result.rows;
    }

    // ================================================================
    // Feature 8: Equipment CRUD Operations (added 2026-02-19)
    // ================================================================

    // --- CREATE: Atomic transaction (3 INSERTs) ---
    async createEquipment(data) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const D = String.fromCharCode(36);

            // 1. INSERT equipment_design
            const insertDesign = "INSERT INTO equipment_design"
                + " (equipment_id, equipment_name, process_name, csv_url, design_ct,"
                + " target_oee, equipment_type, is_parallel, is_active)"
                + " VALUES (" + D + "1, " + D + "2, " + D + "3, " + D + "4, " + D + "5,"
                + " " + D + "6, " + D + "7, " + D + "8, true) RETURNING id";
            const designResult = await client.query(insertDesign, [
                data.equipment_id,
                data.equipment_name,
                data.process_name,
                data.csv_url || null,
                data.design_ct,
                data.target_oee || 85,
                data.equipment_type,
                data.is_parallel || false
            ]);

            // 2. INSERT line_processes
            const insertLP = "INSERT INTO line_processes"
                + " (line_id, equipment_id, process_order, is_parallel, parallel_group, sub_line_group)"
                + " VALUES (" + D + "1, " + D + "2, " + D + "3, " + D + "4, " + D + "5, " + D + "6)";
            await client.query(insertLP, [
                data.line_id,
                data.equipment_id,
                data.process_order,
                data.is_parallel || false,
                data.parallel_group || null,
                data.sub_line_group || null
            ]);

            // 3. INSERT equipment_metrics (initialized with nulls)
            const insertMetrics = "INSERT INTO equipment_metrics (equipment_id) VALUES (" + D + "1)";
            await client.query(insertMetrics, [data.equipment_id]);

            await client.query("COMMIT");
            logger.info("[REPO] Equipment created: " + data.equipment_id);
            return { success: true, equipment_id: data.equipment_id, design_id: designResult.rows[0].id };

        } catch (err) {
            await client.query("ROLLBACK");
            logger.error("[REPO] createEquipment ROLLBACK: " + err.message);
            throw err;
        } finally {
            client.release();
        }
    }

    // --- UPDATE: equipment_design + line_processes in transaction ---
    async updateEquipment(equipmentId, data) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const D = String.fromCharCode(36);

            // Dynamic SET for equipment_design
            var designFields = [];
            var designValues = [];
            var pIdx = 1;
            ["equipment_name", "process_name", "csv_url", "design_ct",
             "target_oee", "equipment_type", "is_parallel"].forEach(function(col) {
                if (data[col] !== undefined) {
                    designFields.push(col + " = " + D + pIdx);
                    designValues.push(data[col]);
                    pIdx++;
                }
            });

            if (designFields.length > 0) {
                designFields.push("updated_at = NOW()");
                designValues.push(equipmentId);
                var dq = "UPDATE equipment_design SET " + designFields.join(", ")
                    + " WHERE equipment_id = " + D + pIdx;
                await client.query(dq, designValues);
            }

            // Dynamic SET for line_processes
            var lpFields = [];
            var lpValues = [];
            var lpIdx = 1;
            ["process_order", "is_parallel", "parallel_group", "sub_line_group"].forEach(function(col) {
                if (data[col] !== undefined) {
                    lpFields.push(col + " = " + D + lpIdx);
                    lpValues.push(data[col]);
                    lpIdx++;
                }
            });

            if (lpFields.length > 0) {
                lpValues.push(equipmentId);
                var lq = "UPDATE line_processes SET " + lpFields.join(", ")
                    + " WHERE equipment_id = " + D + lpIdx;
                await client.query(lq, lpValues);
            }

            await client.query("COMMIT");
            logger.info("[REPO] Equipment updated: " + equipmentId);
            return { success: true, updated: true };

        } catch (err) {
            await client.query("ROLLBACK");
            logger.error("[REPO] updateEquipment ROLLBACK: " + err.message);
            throw err;
        } finally {
            client.release();
        }
    }

    // --- STATUS TOGGLE ---
    async setEquipmentStatus(equipmentId, isActive) {
        const D = String.fromCharCode(36);
        const query = "UPDATE equipment_design SET is_active = " + D + "1, updated_at = NOW()"
            + " WHERE equipment_id = " + D + "2 RETURNING equipment_id, is_active";
        const result = await pool.query(query, [isActive, equipmentId]);
        if (result.rows.length === 0) {
            throw new Error("Equipment not found: " + equipmentId);
        }
        logger.info("[REPO] Equipment " + equipmentId + " status -> " + isActive);
        return { success: true, is_active: result.rows[0].is_active };
    }

    // --- LIST: All equipment with line/process metadata ---
    async getAllEquipment(lineId) {
        const D = String.fromCharCode(36);
        const query = "SELECT ed.id, ed.equipment_id, ed.equipment_name, ed.process_name,"
            + " ed.csv_url, ed.design_ct, ed.target_oee, ed.equipment_type,"
            + " ed.is_parallel, ed.is_active, ed.created_at, ed.updated_at,"
            + " lp.process_order, lp.parallel_group, lp.sub_line_group, lp.line_id,"
            + " pl.line_code, pl.line_name"
            + " FROM equipment_design ed"
            + " LEFT JOIN line_processes lp ON ed.equipment_id = lp.equipment_id"
            + " LEFT JOIN production_lines pl ON lp.line_id = pl.id"
            + " WHERE (" + D + "1::int IS NULL OR lp.line_id = " + D + "1::int)"
            + " ORDER BY lp.process_order, ed.equipment_id";
        const result = await pool.query(query, [lineId || null]);
        return result.rows;
    }

    // --- PROCESSES: Distinct process names for dropdown ---
    async getProcesses(lineCode) {
        const D = String.fromCharCode(36);
        const query = "SELECT DISTINCT ed.process_name"
            + " FROM equipment_design ed"
            + " JOIN line_processes lp ON ed.equipment_id = lp.equipment_id"
            + " JOIN production_lines pl ON lp.line_id = pl.id"
            + " WHERE (" + D + "1::text IS NULL OR pl.line_code = " + D + "1::text)"
            + " AND ed.is_active = true"
            + " ORDER BY ed.process_name";
        const result = await pool.query(query, [lineCode || null]);
        return result.rows.map(function(r) { return r.process_name; });
    }

    // --- VALIDATE: Check if equipment_id exists ---
    async validateEquipmentId(equipmentId) {
        const D = String.fromCharCode(36);
        const query = "SELECT COUNT(*)::int AS cnt FROM equipment_design WHERE equipment_id = " + D + "1";
        const result = await pool.query(query, [equipmentId]);
        return { exists: result.rows[0].cnt > 0 };
    }

    // --- TEST CSV URL: HTTP GET with timeout ---
    async testCsvUrl(url) {
        const http = require("http");
        return new Promise(function(resolve) {
            try {
                const parsed = new URL(url);
                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || 80,
                    path: parsed.pathname + parsed.search,
                    method: "GET",
                    timeout: 5000
                };
                const req = http.request(options, function(res) {
                    let body = "";
                    res.on("data", function(chunk) { body += chunk; });
                    res.on("end", function() {
                        const reachable = res.statusCode === 200;
                        const hasData = body.indexOf("<xmp>") !== -1 || body.indexOf("<XMP>") !== -1;
                        resolve({ reachable: reachable, hasData: hasData, statusCode: res.statusCode });
                    });
                });
                req.on("timeout", function() {
                    req.destroy();
                    resolve({ reachable: false, hasData: false, error: "Timeout (5s)" });
                });
                req.on("error", function(err) {
                    resolve({ reachable: false, hasData: false, error: err.message });
                });
                req.end();
            } catch (err) {
                resolve({ reachable: false, hasData: false, error: "Invalid URL: " + err.message });
            }
        });
    }
}

module.exports = EquipmentDesignRepository;