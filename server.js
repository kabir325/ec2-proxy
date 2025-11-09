const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Pi configuration
const PI_CONFIG = {
  pi1: {
    ip: process.env.PI1_IP || '100.104.127.38',
    port: process.env.PI_API_PORT || '5000',
    name: 'Music Player 1'
  },
  pi2: {
    ip: process.env.PI2_IP || '100.114.175.61',
    port: process.env.PI_API_PORT || '5000',
    name: 'Music Player 2'
  }
};

// Middleware
app.use(helmet());
app.use(express.json());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

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

// Helper function to make requests to Pi
async function proxyToPi(piId, endpoint, method = 'GET', data = null) {
  const pi = PI_CONFIG[piId];
  if (!pi) {
    throw new Error(`Invalid Pi ID: ${piId}`);
  }

  const url = `http://${pi.ip}:${pi.port}${endpoint}`;
  
  try {
    const config = {
      method,
      url,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return {
      success: true,
      data: response.data,
      piName: pi.name
    };
  } catch (error) {
    console.error(`Error connecting to ${piId}:`, error.message);
    
    return {
      success: false,
      error: error.message,
      piName: pi.name,
      details: error.response?.data || 'Connection failed'
    };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    pis: Object.keys(PI_CONFIG)
  });
});

// Get status for a specific Pi
app.get('/api/:piId/status', async (req, res) => {
  const { piId } = req.params;
  
  try {
    const result = await proxyToPi(piId, '/api/status', 'GET');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Control a specific Pi
app.post('/api/:piId/control', async (req, res) => {
  const { piId } = req.params;
  const controlData = req.body;
  
  try {
    const result = await proxyToPi(piId, '/api/control', 'POST', controlData);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get stats for a specific Pi
app.get('/api/:piId/stats', async (req, res) => {
  const { piId } = req.params;
  
  try {
    const result = await proxyToPi(piId, '/api/stats', 'GET');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get health for a specific Pi
app.get('/api/:piId/health', async (req, res) => {
  const { piId } = req.params;
  
  try {
    const result = await proxyToPi(piId, '/api/health', 'GET');
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get status for all Pis
app.get('/api/all/status', async (req, res) => {
  try {
    const results = await Promise.all(
      Object.keys(PI_CONFIG).map(piId => 
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

// List available Pis
app.get('/api/players', (req, res) => {
  const players = Object.entries(PI_CONFIG).map(([id, config]) => ({
    id,
    name: config.name,
    // Don't expose internal IPs to clients
    available: true
  }));
  
  res.json({
    success: true,
    players
  });
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Music Player Proxy Server running on port ${PORT}`);
  console.log(`Configured Pis:`, Object.keys(PI_CONFIG));
  console.log(`Allowed origins:`, allowedOrigins);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
