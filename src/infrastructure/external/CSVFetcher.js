// src/infrastructure/external/CSVFetcher.js
const axios = require('axios');
const logger = require('../../../config/logger');
const env = require('../../../config/environment');

class CSVFetcher {
    constructor() {
        this.timeout = env.csv.timeout;
        this.retryAttempts = env.csv.retryAttempts;
    }

    async fetch(url, equipmentId) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                logger.debug(`[${equipmentId}] Fetching CSV (attempt ${attempt}/${this.retryAttempts})`);
                
                const response = await axios.get(url, {
                    timeout: this.timeout,
                    responseType: 'text',
                    headers: {
                        'Accept': 'text/csv,text/plain,*/*'
                    }
                });
                
                if (response.status === 200 && response.data) {
                    logger.debug(`[${equipmentId}] CSV fetched successfully (${response.data.length} bytes)`);
                    return response.data;
                }
                
                throw new Error(`Invalid response: ${response.status}`);
                
            } catch (error) {
                lastError = error;
                logger.warn(`[${equipmentId}] Fetch attempt ${attempt} failed: ${error.message}`);
                
                if (attempt < this.retryAttempts) {
                    await this.sleep(1000 * attempt);
                }
            }
        }
        
        logger.error(`[${equipmentId}] All fetch attempts failed: ${lastError.message}`);
        return null;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = CSVFetcher;