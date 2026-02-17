/**
 * CSVParser - Parsea datos CSV de equipos de produccion
 * Extrae CSV de paginas HTML de MANTIS (BorgWarner)
 * El CSV esta dentro de tags <xmp>...</xmp>
 */
const { parse } = require('csv-parse/sync');
const logger = require('../../../config/logger');

class CSVParser {
    /**
     * Extrae datos CSV de respuesta HTML de MANTIS
     * El contenido CSV esta dentro de tags <xmp>...</xmp>
     */
    cleanCSVData(rawData) {
        if (!rawData || typeof rawData !== 'string') {
            return '';
        }

        // Buscar contenido entre <xmp> y </xmp>
        const xmpMatch = rawData.match(/<xmp>([\s\S]*?)<\/xmp>/i);
        
        if (xmpMatch && xmpMatch[1]) {
            const csvContent = xmpMatch[1].trim();
            logger.debug(`Extracted ${csvContent.split('\n').length} lines from <xmp> tag`);
            return csvContent;
        }
        
        // Fallback: buscar <pre> tags
        const preMatch = rawData.match(/<pre>([\s\S]*?)<\/pre>/i);
        
        if (preMatch && preMatch[1]) {
            const csvContent = preMatch[1].trim();
            logger.debug(`Extracted ${csvContent.split('\n').length} lines from <pre> tag`);
            return csvContent;
        }
        
        logger.warn('No <xmp> or <pre> tags found');
        return '';
    }

    /**
     * Parsea CSV sin header - columnas fijas de MANTIS:
     * 0: SerialNumber
     * 1: Line (GPEC5)
     * 2: ModelID
     * 3: EquipmentType (COVERPRESS, CONTINUITY, etc)
     * 4: StationID (GPEC5STA2, etc)
     * 5: Status (BREQ, BCMP OK, BCMP NG)
     * 6: DateTime (MM/DD/YYYY HH:mm:ss)
     */
    parse(rawData, equipmentId) {
        const csvContent = this.cleanCSVData(rawData);
        
        if (!csvContent) {
            logger.warn(`[${equipmentId}] No valid CSV data after cleaning`);
            return [];
        }

        try {
            const records = parse(csvContent, {
                columns: false,  // Sin header
                skip_empty_lines: true,
                relax_column_count: true,
                relax_quotes: true,
                trim: true
            });

            const parsedRecords = [];

            for (const record of records) {
                // Validar que tenga al menos 7 columnas
                if (record.length < 7) {
                    logger.debug(`[${equipmentId}] Skipping row with ${record.length} columns`);
                    continue;
                }

                const serialNumber = record[0]?.trim();
                const status = record[5]?.trim();
                const dateTimeStr = record[6]?.trim();

                // Validar campos requeridos
                if (!serialNumber || !status || !dateTimeStr) {
                    continue;
                }

                // Parsear fecha MM/DD/YYYY HH:mm:ss
                const scannedAt = this.parseDateTime(dateTimeStr);
                if (!scannedAt) {
                    logger.debug(`[${equipmentId}] Invalid date: ${dateTimeStr}`);
                    continue;
                }

                parsedRecords.push({
                    equipment_id: equipmentId,
                    serial_number: serialNumber,
                    status: status,
                    scanned_at: scannedAt,
                    raw_data: {
                        line: record[1],
                        model_id: record[2],
                        equipment_type: record[3],
                        station_id: record[4]
                    }
                });
            }

            logger.info(`[${equipmentId}] Parsed ${parsedRecords.length} valid records from ${records.length} rows`);
            return parsedRecords;

        } catch (error) {
            logger.error(`[${equipmentId}] Parse error: ${error.message}`);
            return [];
        }
    }

    /**
     * Parsea fecha formato MM/DD/YYYY HH:mm:ss
     */
    parseDateTime(dateTimeStr) {
        if (!dateTimeStr) return null;

        // Formato: 02/10/2026 00:00:08
        const match = dateTimeStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        
        if (match) {
            const [, month, day, year, hour, minute, second] = match;
            // Return formatted string - NO Date object conversion
            
            // Avoids local-to-UTC shift with timestamp without time zone
            return year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second;
        }

        return null;
    }
}

module.exports = new CSVParser();
