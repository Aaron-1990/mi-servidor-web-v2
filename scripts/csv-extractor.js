// scripts/csv-extractor.js
require('dotenv').config();

const logger = require('../config/logger');
const { testConnection } = require('../config/database');
const CSVFetcher = require('../src/infrastructure/external/CSVFetcher');
const CSVParser = require('../src/infrastructure/external/CSVParser');
const RawScanRepository = require('../src/infrastructure/repositories/RawScanRepository');
const EquipmentDesignRepository = require('../src/infrastructure/repositories/EquipmentDesignRepository');

class CSVExtractor {
    constructor() {
        this.fetcher = new CSVFetcher();
        this.parser = CSVParser;
        this.rawScanRepo = new RawScanRepository();
        this.equipmentRepo = new EquipmentDesignRepository();
    }

    async run() {
        logger.info('=== CSV EXTRACTOR STARTED ===');
        const startTime = Date.now();

        try {
            // Verificar conexion a BD
            const dbConnected = await testConnection();
            if (!dbConnected) {
                throw new Error('Database connection failed');
            }

            // Obtener equipos activos
            const equipments = await this.equipmentRepo.getActiveEquipments();
            logger.info(`Found ${equipments.length} active equipments`);

            let totalInserted = 0;
            let totalDuplicates = 0;
            let successCount = 0;
            let errorCount = 0;

            // Procesar cada equipo
            for (const equipment of equipments) {
                try {
                    const result = await this.processEquipment(equipment);
                    totalInserted += result.inserted;
                    totalDuplicates += result.duplicates;
                    successCount++;
                } catch (error) {
                    logger.error(`[${equipment.equipment_id}] Error: ${error.message}`);
                    errorCount++;
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            logger.info(`=== CSV EXTRACTOR COMPLETED ===`);
            logger.info(`Duration: ${duration}s | Equipments: ${successCount}/${equipments.length} | Inserted: ${totalInserted} | Duplicates: ${totalDuplicates}`);

            return {
                success: true,
                duration,
                equipments: successCount,
                inserted: totalInserted,
                duplicates: totalDuplicates,
                errors: errorCount
            };

        } catch (error) {
            logger.error(`Extractor failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async processEquipment(equipment) {
        const { equipment_id, csv_url } = equipment;

        // Fetch CSV
        const csvData = await this.fetcher.fetch(csv_url, equipment_id);
        if (!csvData) {
            return { inserted: 0, duplicates: 0 };
        }

        // Parse CSV
        const records = this.parser.parse(csvData, equipment_id);
        if (records.length === 0) {
            return { inserted: 0, duplicates: 0 };
        }

        // Insert to database
        const result = await this.rawScanRepo.insertBatch(records);
        
        logger.info(`[${equipment_id}] Inserted: ${result.inserted} | Duplicates: ${result.duplicates}`);
        
        return result;
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    const extractor = new CSVExtractor();
    extractor.run()
        .then(result => {
            console.log('Result:', JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = CSVExtractor;