// =============================================================================
// config/security.js - Middleware de seguridad para acceso corporativo
// VSM Real-Time Monitoring v2 - BorgWarner GPEC5
// =============================================================================

var logger = require('./logger');

// Rangos DHCP corporativos BorgWarner (definidos por IT)
var CORPORATE_DHCP_RANGES = [
    {
        name: 'ServerNetwork',
        description: 'Red del servidor VSM',
        start: '10.3.0.1',
        end: '10.3.0.255',
        enabled: true
    },
    {
        name: 'WorkstationsAreaA',
        description: 'Estaciones de trabajo - Area A',
        start: '10.41.126.1',
        end: '10.45.126.255',
        enabled: true
    },
    {
        name: 'WorkstationsAreaB',
        description: 'Estaciones de trabajo - Area B',
        start: '10.50.126.1',
        end: '10.51.126.255',
        enabled: true
    },
    {
        name: 'MobileSpecialDevices',
        description: 'Dispositivos moviles y especiales',
        start: '10.92.48.1',
        end: '10.92.52.255',
        enabled: true
    }
];

var ALWAYS_ALLOWED = [
    '127.0.0.1',
    '::1',
    '10.3.0.200'
];

function ipToNumber(ip) {
    var parts = ip.split('.').map(Number);
    return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isIPInRange(ip, start, end) {
    var ipNum = ipToNumber(ip);
    var startNum = ipToNumber(start);
    var endNum = ipToNumber(end);
    return ipNum >= startNum && ipNum <= endNum;
}

function isValidIPv4(ip) {
    var parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(function(part) {
        var num = parseInt(part, 10);
        return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
    });
}

function extractClientIP(req) {
    var raw = req.headers['x-forwarded-for'] ||
              req.connection.remoteAddress ||
              req.socket.remoteAddress ||
              req.ip ||
              'unknown';
    return raw.replace(/^::ffff:/, '').split(',')[0].trim();
}

function isIPAuthorized(clientIP) {
    if (ALWAYS_ALLOWED.includes(clientIP)) {
        return { allowed: true, reason: 'static-allowed' };
    }
    if (!isValidIPv4(clientIP)) {
        return { allowed: false, reason: 'invalid-ipv4' };
    }
    for (var i = 0; i < CORPORATE_DHCP_RANGES.length; i++) {
        var range = CORPORATE_DHCP_RANGES[i];
        if (range.enabled && isIPInRange(clientIP, range.start, range.end)) {
            return { allowed: true, reason: 'dhcp-range', rangeName: range.name };
        }
    }
    return { allowed: false, reason: 'not-in-range' };
}

function ipFilterMiddleware(req, res, next) {
    var clientIP = extractClientIP(req);
    var result = isIPAuthorized(clientIP);
    if (result.allowed) {
        logger.debug('Access allowed: ' + clientIP + ' (' + result.reason + ')');
        next();
    } else {
        logger.warn('Access DENIED: ' + clientIP + ' (' + result.reason + ')');
        res.status(403).json({
            error: 'Acceso denegado. IP no autorizada.',
            message: 'Contacte al administrador si necesita acceso.',
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    ipFilterMiddleware: ipFilterMiddleware,
    isIPAuthorized: isIPAuthorized,
    CORPORATE_DHCP_RANGES: CORPORATE_DHCP_RANGES
};
