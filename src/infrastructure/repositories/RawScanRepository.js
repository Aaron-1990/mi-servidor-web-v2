// src/infrastructure/repositories/RawScanRepository.js
const { pool } = require('../../../config/database');
const logger = require('../../../config/logger');

class RawScanRepository {
    
    async insertBatch(records) {
        if (!records || records.length === 0) {
            return { inserted: 0, duplicates: 0 };
        }

        const client = await pool.connect();
        let inserted = 0;
        let duplicates = 0;

        try {
            for (const record of records) {
                try {
                    const result = await client.query(
                        `INSERT INTO raw_scans (equipment_id, serial_number, status, scanned_at, raw_data)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (equipment_id, serial_number, scanned_at) DO NOTHING`,
                        [
                            record.equipment_id,
                            record.serial_number,
                            record.status,
                            record.scanned_at,
                            record.raw_data
                        ]
                    );
                    if (result.rowCount > 0) {
                        inserted++;
                    } else {
                        duplicates++;
                    }
                } catch (error) {
                    if (error.code === '23505') {
                        duplicates++;
                    } else {
                        logger.error(`Insert error: ${error.message}`);
                    }
                }
            }
            
            return { inserted, duplicates };
            
        } finally {
            client.release();
        }
    }

    async getRecentByEquipment(equipmentId, limit = 100) {
        const result = await pool.query(
            `SELECT * FROM raw_scans 
             WHERE equipment_id = $1 
             ORDER BY scanned_at DESC 
             LIMIT $2`,
            [equipmentId, limit]
        );
        return result.rows;
    }

    async getCountByEquipment(equipmentId) {
        const result = await pool.query(
            `SELECT COUNT(*) as count FROM raw_scans WHERE equipment_id = $1`,
            [equipmentId]
        );
        return parseInt(result.rows[0].count);
    }

    async deleteOlderThan(days) {
        const result = await pool.query(
            `DELETE FROM raw_scans 
             WHERE created_at < NOW() - INTERVAL '${days} days'
             RETURNING id`
        );
        return result.rowCount;
    }
}

module.exports = RawScanRepository;
