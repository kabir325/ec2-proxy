/**
 * Monitoring and Logging Middleware
 */

const fs = require('fs').promises;
const path = require('path');

// Log configuration
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'access.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// Metrics storage
const metrics = {
  requests: {
    total: 0,
    success: 0,
    error: 0,
    byEndpoint: new Map(),
    byPI: new Map(),
    byHour: new Map()
  },
  pis: {
    online: new Set(),
    offline: new Set(),
    lastSeen: new Map(),
    responseTime: new Map()
  },
  auth: {
    logins: { success: 0, failed: 0 },
    requests: { pending: 0, approved: 0, rejected: 0 }
  },
  system: {
    startTime: new Date().toISOString(),
    uptime: 0,
    memoryUsage: 0
  }
};

// Ensure log directory exists
async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create log directory:', error);
  }
}

// Rotate log file if it's too large
async function rotateLogFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = filePath.replace('.log', `-${timestamp}.log`);
      await fs.rename(filePath, backupPath);
    }
  } catch (error) {
    // File doesn't exist, that's okay
  }
}

// Write log entry
async function writeLog(logFile, message) {
  try {
    await rotateLogFile(logFile);
    const timestamp = new Date().toISOString();
    await fs.appendFile(logFile, `[${timestamp}] ${message}\n`);
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

// Request logging middleware
function requestLogger(req, res, next) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const hour = new Date().getHours();
  
  // Update metrics
  metrics.requests.total++;
  metrics.requests.byHour.set(hour, (metrics.requests.byHour.get(hour) || 0) + 1);
  
  // Log request start
  const logMessage = `${req.method} ${req.path} - IP: ${req.ip} - User-Agent: ${req.headers['user-agent']}`;
  writeLog(LOG_FILE, logMessage);
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    
    // Update metrics
    if (status >= 200 && status < 400) {
      metrics.requests.success++;
    } else {
      metrics.requests.error++;
    }
    
    metrics.requests.byEndpoint.set(
      `${req.method} ${req.path}`, 
      (metrics.requests.byEndpoint.get(`${req.method} ${req.path}`) || 0) + 1
    );
    
    // Track PI-specific requests
    if (req.params.piId) {
      metrics.requests.byPI.set(
        req.params.piId, 
        (metrics.requests.byPI.get(req.params.piId) || 0) + 1
      );
      
      // Track response time for PI
      const currentAvg = metrics.pis.responseTime.get(req.params.piId) || 0;
      const count = metrics.requests.byPI.get(req.params.piId);
      metrics.pis.responseTime.set(req.params.piId, (currentAvg * (count - 1) + duration) / count);
    }
    
    // Log response
    const responseLog = `${req.method} ${req.path} - ${status} - ${duration}ms`;
    writeLog(LOG_FILE, responseLog);
    
    // Call original end
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
}

// Error logging middleware
function errorLogger(err, req, res, next) {
  const timestamp = new Date().toISOString();
  const errorMessage = `ERROR: ${err.message} - Stack: ${err.stack} - URL: ${req.url} - Method: ${req.method} - IP: ${req.ip}`;
  
  writeLog(ERROR_LOG_FILE, errorMessage);
  console.error('Application Error:', err);
  
  metrics.requests.error++;
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    timestamp
  });
}

// PI status monitoring
function updatePIStatus(piId, status, responseTime = null) {
  if (status === 'online') {
    metrics.pis.online.add(piId);
    metrics.pis.offline.delete(piId);
  } else {
    metrics.pis.offline.add(piId);
    metrics.pis.online.delete(piId);
  }
  
  metrics.pis.lastSeen.set(piId, new Date().toISOString());
  
  if (responseTime !== null) {
    metrics.pis.responseTime.set(piId, responseTime);
  }
}

// Auth event monitoring
function trackAuthEvent(event, data = {}) {
  switch (event) {
    case 'login_success':
      metrics.auth.logins.success++;
      writeLog(LOG_FILE, `AUTH: Login success - User: ${data.email} - IP: ${data.ip}`);
      break;
    case 'login_failed':
      metrics.auth.logins.failed++;
      writeLog(LOG_FILE, `AUTH: Login failed - Email: ${data.email} - IP: ${data.ip}`);
      break;
    case 'access_request':
      metrics.auth.requests.pending++;
      writeLog(LOG_FILE, `AUTH: Access request - Name: ${data.name} - Email: ${data.email}`);
      break;
    case 'access_approved':
      metrics.auth.requests.pending--;
      metrics.auth.requests.approved++;
      writeLog(LOG_FILE, `AUTH: Access approved - Email: ${data.email} - Role: ${data.role}`);
      break;
    case 'access_rejected':
      metrics.auth.requests.pending--;
      metrics.auth.requests.rejected++;
      writeLog(LOG_FILE, `AUTH: Access rejected - Email: ${data.email} - Reason: ${data.reason}`);
      break;
  }
}

// Get system metrics
function getMetrics() {
  const uptime = Date.now() - new Date(metrics.system.startTime).getTime();
  metrics.system.uptime = uptime;
  metrics.system.memoryUsage = process.memoryUsage();
  
  return {
    ...metrics,
    requests: {
      ...metrics.requests,
      byEndpoint: Object.fromEntries(metrics.requests.byEndpoint),
      byPI: Object.fromEntries(metrics.requests.byPI),
      byHour: Object.fromEntries(metrics.requests.byHour)
    },
    pis: {
      online: Array.from(metrics.pis.online),
      offline: Array.from(metrics.pis.offline),
      lastSeen: Object.fromEntries(metrics.pis.lastSeen),
      responseTime: Object.fromEntries(metrics.pis.responseTime)
    }
  };
}

// Get health status
function getHealthStatus() {
  const now = Date.now();
  const uptime = now - new Date(metrics.system.startTime).getTime();
  const memoryUsage = process.memoryUsage();
  
  // Check if system is healthy
  const errorRate = metrics.requests.total > 0 ? metrics.requests.error / metrics.requests.total : 0;
  const isHealthy = errorRate < 0.1 && uptime > 0; // Less than 10% error rate
  
  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime,
    memory: {
      used: memoryUsage.heapUsed,
      total: memoryUsage.heapTotal,
      percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal * 100).toFixed(2)
    },
    requests: {
      total: metrics.requests.total,
      success: metrics.requests.success,
      error: metrics.requests.error,
      errorRate: (errorRate * 100).toFixed(2) + '%'
    },
    pis: {
      online: metrics.pis.online.size,
      offline: metrics.pis.offline.size,
      total: metrics.pis.online.size + metrics.pis.offline.size
    }
  };
}

// Security monitoring
function securityMonitor(req, res, next) {
  // Detect suspicious patterns
  const suspiciousPatterns = [
    /\.\./,  // Path traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection attempts
    /javascript:/i  // JavaScript protocol
  ];
  
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(req.url) || pattern.test(JSON.stringify(req.body))
  );
  
  if (isSuspicious) {
    const warning = `SECURITY: Suspicious request detected - IP: ${req.ip} - URL: ${req.url} - Body: ${JSON.stringify(req.body)}`;
    writeLog(ERROR_LOG_FILE, warning);
    console.warn('Suspicious request detected:', req.ip, req.url);
    
    // Block suspicious requests
    return res.status(403).json({
      success: false,
      error: 'Request blocked for security reasons'
    });
  }
  
  next();
}

// Initialize monitoring
async function initMonitoring() {
  await ensureLogDir();
  console.log('📊 Monitoring system initialized');
  console.log(`📁 Logs directory: ${LOG_DIR}`);
}

// Cleanup old log files
async function cleanupLogs() {
  try {
    const files = await fs.readdir(LOG_DIR);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    for (const file of files) {
      if (file.endsWith('.log') && file !== 'access.log' && file !== 'error.log') {
        const filePath = path.join(LOG_DIR, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`🗑️ Cleaned up old log file: ${file}`);
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup logs:', error);
  }
}

// Run cleanup daily
setInterval(cleanupLogs, 24 * 60 * 60 * 1000);

module.exports = {
  requestLogger,
  errorLogger,
  securityMonitor,
  updatePIStatus,
  trackAuthEvent,
  getMetrics,
  getHealthStatus,
  initMonitoring,
  cleanupLogs
};
