/**
 * Authentication and Authorization Middleware
 */

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// In-memory user store (in production, use a database)
const users = new Map();
const accessRequests = new Map();

// Initialize with default admin user
if (!users.has('admin')) {
  users.set('admin', {
    id: 'admin-1',
    email: 'admin@resort.com',
    name: 'System Administrator',
    role: 'admin',
    password: 'admin123', // Change in production!
    approvedAt: new Date().toISOString()
  });
}

// JWT token generation
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      name: user.name, 
      role: user.role 
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// JWT token verification
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }

  req.user = user;
  next();
}

// Role-based authorization middleware
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: `Insufficient privileges. Required: ${role}`
      });
    }

    next();
  };
}

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
}

// Login endpoint handler
function handleLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required'
    });
  }

  const user = Array.from(users.values()).find(u => u.email === email);
  
  if (!user || user.password !== password) {
    return res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }

  if (!user.approvedAt) {
    return res.status(403).json({
      success: false,
      error: 'Access not approved yet'
    });
  }

  const token = generateToken(user);
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  
  res.json({
    success: true,
    token,
    user: userWithoutPassword
  });
}

// Access request endpoint handler
function handleAccessRequest(req, res) {
  const { name, email, reason, organization, phone } = req.body;

  if (!name || !email || !reason) {
    return res.status(400).json({
      success: false,
      error: 'Name, email, and reason are required'
    });
  }

  const requestId = `req-${Date.now()}`;
  const request = {
    id: requestId,
    name,
    email,
    reason,
    organization: organization || null,
    phone: phone || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  };

  accessRequests.set(requestId, request);

  // In production, send email notification to admin
  console.log(`📧 New access request from ${name} (${email})`);
  console.log(`   Reason: ${reason}`);
  console.log(`   Request ID: ${requestId}`);

  res.json({
    success: true,
    message: 'Access request submitted successfully',
    requestId
  });
}

// Check access request status
function handleAccessStatus(req, res) {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required'
    });
  }

  const request = Array.from(accessRequests.values()).find(r => r.email === email);
  
  if (!request) {
    return res.status(404).json({
      success: false,
      error: 'No access request found for this email'
    });
  }

  res.json({
    success: true,
    status: request.status,
    message: getStatusMessage(request.status),
    request: {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt
    }
  });
}

// Admin: List all access requests
function handleListRequests(req, res) {
  const requests = Array.from(accessRequests.values()).map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    reason: r.reason,
    organization: r.organization,
    status: r.status,
    createdAt: r.createdAt,
    ipAddress: r.ipAddress
  }));

  res.json({
    success: true,
    requests
  });
}

// Admin: Approve access request
function handleApproveRequest(req, res) {
  const { requestId } = req.params;
  const { role = 'operator' } = req.body;

  const request = accessRequests.get(requestId);
  if (!request) {
    return res.status(404).json({
      success: false,
      error: 'Access request not found'
    });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({
      success: false,
      error: 'Request already processed'
    });
  }

  // Create user account
  const user = {
    id: `user-${Date.now()}`,
    email: request.email,
    name: request.name,
    role: role,
    organization: request.organization,
    phone: request.phone,
    approvedAt: new Date().toISOString()
  };

  users.set(user.email, user);
  request.status = 'approved';
  request.processedAt = new Date().toISOString();

  // In production, send approval email
  console.log(`✅ Access request approved for ${request.name} (${request.email})`);
  console.log(`   Role: ${role}`);
  console.log(`   User ID: ${user.id}`);

  res.json({
    success: true,
    message: 'Access request approved',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
}

// Admin: Reject access request
function handleRejectRequest(req, res) {
  const { requestId } = req.params;
  const { reason } = req.body;

  const request = accessRequests.get(requestId);
  if (!request) {
    return res.status(404).json({
      success: false,
      error: 'Access request not found'
    });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({
      success: false,
      error: 'Request already processed'
    });
  }

  request.status = 'rejected';
  request.rejectionReason = reason || 'No reason provided';
  request.processedAt = new Date().toISOString();

  // In production, send rejection email
  console.log(`❌ Access request rejected for ${request.name} (${request.email})`);
  console.log(`   Reason: ${request.rejectionReason}`);

  res.json({
    success: true,
    message: 'Access request rejected'
  });
}

function getStatusMessage(status) {
  switch (status) {
    case 'pending':
      return 'Your access request is pending approval';
    case 'approved':
      return 'Your access has been approved. You can now log in.';
    case 'rejected':
      return 'Your access request has been rejected';
    default:
      return 'Unknown status';
  }
}

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  authLimiter,
  handleLogin,
  handleAccessRequest,
  handleAccessStatus,
  handleListRequests,
  handleApproveRequest,
  handleRejectRequest,
  generateToken,
  verifyToken
};
