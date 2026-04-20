// src/infrastructure/repositories/ProductionLineRepository.js
const { pool } = require("../../../config/database");
const logger = require("../../../config/logger");
class ProductionLineRepository {
    async getActiveLines() {
        const result = await pool.query(
            "SELECT id, line_name, line_code, description, takt_time, target_output, shift_hours, is_active FROM production_lines WHERE is_active = true ORDER BY id"
        );
        return result.rows;
    }
    async getAllLines() {
        const result = await pool.query(
            "SELECT id, line_name, line_code, description, takt_time, target_output, shift_hours, is_active FROM production_lines ORDER BY id"
        );
        return result.rows;
    }
    async getLineByCode(lineCode) {
        const result = await pool.query(
            "SELECT * FROM production_lines WHERE line_code = $1",
            [lineCode]
        );
        return result.rows[0] || null;
    }
    async getEquipmentCount(lineId) {
        const result = await pool.query(
            "SELECT COUNT(*) as count FROM line_processes WHERE line_id = $1",
            [lineId]
        );
        return parseInt(result.rows[0].count);
    }
    async createLine(data) {
        const D = String.fromCharCode(36);
        const q = "INSERT INTO production_lines (line_name, line_code, takt_time, target_output, shift_hours, is_active)"
            + " VALUES (" + D + "1, " + D + "2, " + D + "3, " + D + "4, " + D + "5, true) RETURNING *";
        const result = await pool.query(q, [
            data.line_name,
            data.line_code.toUpperCase().replace(/s+/g, "_"),
            parseFloat(data.takt_time) || 45,
            parseInt(data.target_output) || 0,
            parseFloat(data.shift_hours) || 8
        ]);
        return result.rows[0];
    }
    async updateLine(id, data) {
        const D = String.fromCharCode(36);
        const q = "UPDATE production_lines SET line_name=" + D + "1, takt_time=" + D + "2,"
            + " target_output=" + D + "3, shift_hours=" + D + "4, is_active=" + D + "5"
            + " WHERE id=" + D + "6 RETURNING *";
        const result = await pool.query(q, [
            data.line_name,
            parseFloat(data.takt_time),
            parseInt(data.target_output),
            parseFloat(data.shift_hours),
            data.is_active !== undefined ? data.is_active : true,
            parseInt(id)
        ]);
        return result.rows[0] || null;
    }
}
module.exports = ProductionLineRepository;