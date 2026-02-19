// src/infrastructure/repositories/ProductionLineRepository.js
const { pool } = require('../../../config/database');
const logger = require('../../../config/logger');

class ProductionLineRepository {
    async getActiveLines() {
        const result = await pool.query(
            'SELECT id, line_name, line_code, description, takt_time, target_output, shift_hours, is_active FROM production_lines WHERE is_active = true ORDER BY id'
        );
        return result.rows;
    }

    async getLineByCode(lineCode) {
        const result = await pool.query(
            'SELECT * FROM production_lines WHERE line_code = $1',
            [lineCode]
        );
        return result.rows[0] || null;
    }

    async getEquipmentCount(lineId) {
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM line_processes WHERE line_id = $1',
            [lineId]
        );
        return parseInt(result.rows[0].count);
    }
}

module.exports = ProductionLineRepository;
