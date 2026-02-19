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
}

module.exports = EquipmentDesignRepository;