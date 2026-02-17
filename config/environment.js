// config/environment.js
require('dotenv').config();

module.exports = {
    // Database
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        name: process.env.DB_NAME || 'vsm_production',
        user: process.env.DB_USER || 'vsm_admin',
        password: process.env.DB_PASSWORD || ''
    },
    
    // Server
    server: {
        port: parseInt(process.env.PORT) || 3001,
        env: process.env.NODE_ENV || 'development'
    },
    
    // Polling
    polling: {
        csvInterval: parseInt(process.env.CSV_POLL_INTERVAL) || 30000,
        calcInterval: parseInt(process.env.CALC_POLL_INTERVAL) || 60000
    },
    
    // CSV Fetch
    csv: {
        timeout: parseInt(process.env.CSV_TIMEOUT) || 10000,
        retryAttempts: parseInt(process.env.CSV_RETRY_ATTEMPTS) || 3
    },
    
    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || './logs/app.log'
    },
    
    // Data Retention
    retention: {
        rawScansDays: parseInt(process.env.RAW_SCANS_RETENTION_DAYS) || 30
    }
};
