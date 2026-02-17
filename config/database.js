// config/database.js
const { Pool } = require('pg');
const env = require('./environment');
const logger = require('./logger');

const pool = new Pool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

// Test connection on startup
pool.on('connect', () => {
    logger.info('Database pool: New client connected');
});

pool.on('error', (err) => {
    logger.error('Database pool error:', err);
});

// Helper function to test connection
async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        logger.info(`Database connected successfully at ${result.rows[0].now}`);
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    testConnection
};
