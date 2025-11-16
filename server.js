const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const PIDiscovery = require('./pi-discovery');
const { 
  authenticateToken, 
  requireAdmin, 
  authLimiter,
  handleLogin,
  handleAccessRequest,
  handleAccessStatus,
  handleListRequests,
  handleApproveRequest,
  handleRejectRequest
} = require('./middleware/auth');
const {
  requestLogger,
  errorLogger,
  securityMonitor,
  updatePIStatus,
  trackAuthEvent,
  getMetrics,
  getHealthStatus,
  initMonitoring
} = require('./middleware/monitoring');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize monitoring
initMonitoring();

// Initialize PI Discovery
const piDiscovery = new PIDiscovery();

// Middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Monitoring and security middleware
app.use(requestLogger);
app.use(securityMonitor);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Authentication endpoints
app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    handleLogin(req, res);
  } catch (error) {
    trackAuthEvent('login_failed', { email: req.body.email, ip: req.ip });
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/auth/request-access', authLimiter, (req, res) => {
  try {
    handleAccessRequest(req, res);
    trackAuthEvent('access_request', { 
      name: req.body.name, 
      email: req.body.email 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Request failed' });
  }
});

app.get('/api/auth/access-status', (req, res) => {
  try {
    handleAccessStatus(req, res);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Status check failed' });
  }
});

// Token validation endpoint
app.get('/api/auth/validate', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// Admin authentication endpoints
app.get('/api/admin/requests', authenticateToken, requireAdmin, (req, res) => {
  try {
    handleListRequests(req, res);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list requests' });
  }
});

app.post('/api/admin/requests/:requestId/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    handleApproveRequest(req, res);
    trackAuthEvent('access_approved', { 
      email: req.body.email, 
      role: req.body.role 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Approval failed' });
  }
});

app.post('/api/admin/requests/:requestId/reject', authenticateToken, requireAdmin, (req, res) => {
  try {
    handleRejectRequest(req, res);
    trackAuthEvent('access_rejected', { 
      email: req.body.email, 
      reason: req.body.reason 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Rejection failed' });
  }
});

// Metrics endpoint (admin only)
app.get('/api/admin/metrics', authenticateToken, requireAdmin, (req, res) => {
  try {
    const metricsData = getMetrics();
    res.json({
      success: true,
      ...metricsData
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get metrics' });
  }
});

// Protected routes - require authentication
app.use('/api', authenticateToken);

// Helper function to make requests to Pi
async function proxyToPi(piId, endpoint, method = 'GET', data = null) {
  const pi = piDiscovery.getPI(piId);
  if (!pi) {
    throw new Error(`Invalid Pi ID: ${piId}`);
  }

  const url = `http://${pi.ip}:${pi.port}${endpoint}`;
  const startTime = Date.now();
  
  try {
    const config = {
      method,
      url,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `MusicPlayerProxy/1.0 (${piId})`
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    const responseTime = Date.now() - startTime;
    
    // Update PI status and metrics
    updatePIStatus(piId, 'online', responseTime);
    piDiscovery.updatePIStatus(piId, 'online');
    
    return {
      success: true,
      data: response.data,
      piName: pi.name,
      piId,
      piIp: pi.ip,
      responseTime
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    // Mark PI as offline
    updatePIStatus(piId, 'offline');
    piDiscovery.updatePIStatus(piId, 'offline');
    
    console.error(`Error connecting to ${piId}:`, error.message);
    
    return {
      success: false,
      error: error.message,
      piName: pi.name,
      piId,
      piIp: pi.ip,
      responseTime,
      details: error.response?.data || 'Connection failed'
    };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  const health = getHealthStatus();
  const piStatus = piDiscovery.getAllPIStatus();
  
  res.json({
    ...health,
    pis: {
      total: piStatus.total,
      online: piStatus.online,
      offline: piStatus.offline,
      details: piStatus.pis
    }
  });
});

// Player status endpoint
app.get('/api/all/status', async (req, res) => {
  try {
    const pis = piDiscovery.getAllPIs();
    const results = await Promise.all(
      Object.keys(pis).map(piId => 
        proxyToPi(piId, '/api/status', 'GET')
          .then(result => ({ piId, ...result }))
          .catch(error => ({ 
            piId, 
            success: false, 
            error: error.message 
          }))
      )
    );
    
    res.json({
      success: true,
      players: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List available players
app.get('/api/players', (req, res) => {
  const pis = piDiscovery.getAllPIs();
  const players = Object.entries(pis).map(([id, config]) => ({
    id,
    name: config.name,
    location: config.location || 'Unknown',
    status: config.status,
    lastSeen: config.lastSeen,
    // Don't expose internal IPs to clients
    available: config.status === 'online'
  }));
  
  res.json({
    success: true,
    players
  });
});

// Admin endpoints for PI management
app.get('/api/admin/pis', authenticateToken, requireAdmin, (req, res) => {
  const pis = piDiscovery.getAllPIs();
  res.json({
    success: true,
    pis
  });
});

app.get('/api/admin/pis/:piId', authenticateToken, requireAdmin, (req, res) => {
  const pi = piDiscovery.getPI(req.params.piId);
  if (!pi) {
    return res.status(404).json({
      success: false,
      error: 'PI not found'
    });
  }
  res.json({
    success: true,
    pi
  });
});

app.post('/api/admin/pis', authenticateToken, requireAdmin, (req, res) => {
  const { ip, name, location, description } = req.body;
  
  if (!ip || !name) {
    return res.status(400).json({
      success: false,
      error: 'IP and name are required'
    });
  }
  
  const piId = piDiscovery.addPI(ip, name, location, description);
  res.json({
    success: true,
    piId,
    message: 'PI added successfully'
  });
});

app.delete('/api/admin/pis/:piId', authenticateToken, requireAdmin, (req, res) => {
  const success = piDiscovery.removePI(req.params.piId);
  if (!success) {
    return res.status(404).json({
      success: false,
      error: 'PI not found'
    });
  }
  res.json({
    success: true,
    message: 'PI removed successfully'
  });
});

app.post('/api/admin/discover', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const discoveredPis = await piDiscovery.discoverPis();
    res.json({
      success: true,
      discovered: discoveredPis.length,
      pis: discoveredPis
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/admin/health-check', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const results = await piDiscovery.checkAllPIHealth();
    res.json({
      success: true,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🎵 Music Player Proxy Server running on port ${PORT}`);
  console.log(`🌐 Allowed origins:`, allowedOrigins);
  
  // Initialize PI discovery
  console.log('🔍 Initializing PI Discovery...');
  await piDiscovery.discoverPis();
  
  // Start automatic discovery
  piDiscovery.startAutoDiscovery();
  
  const allPis = piDiscovery.getAllPIs();
  const onlinePis = piDiscovery.getOnlinePIs();
  
  console.log(`📊 Discovered ${allPis.length} Pis (${onlinePis.length} online)`);
  allPis.forEach(pi => {
    const status = pi.status === 'online' ? '🟢' : '🔴';
    console.log(`   ${status} ${pi.name} (${pi.ip})`);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  piDiscovery.stopAutoDiscovery();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  piDiscovery.stopAutoDiscovery();
  process.exit(0);
});
