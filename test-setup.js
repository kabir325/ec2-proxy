// Test script to verify all dependencies are available
console.log('Testing EC2 Proxy setup...');

try {
  const express = require('express');
  console.log('✓ Express loaded');
} catch (e) {
  console.log('✗ Express not found:', e.message);
}

try {
  const cors = require('cors');
  console.log('✓ CORS loaded');
} catch (e) {
  console.log('✗ CORS not found:', e.message);
}

try {
  const helmet = require('helmet');
  console.log('✓ Helmet loaded');
} catch (e) {
  console.log('✗ Helmet not found:', e.message);
}

try {
  const rateLimit = require('express-rate-limit');
  console.log('✓ Rate limit loaded');
} catch (e) {
  console.log('✗ Rate limit not found:', e.message);
}

try {
  const axios = require('axios');
  console.log('✓ Axios loaded');
} catch (e) {
  console.log('✗ Axios not found:', e.message);
}

try {
  const jwt = require('jsonwebtoken');
  console.log('✓ JWT loaded');
} catch (e) {
  console.log('✗ JWT not found:', e.message);
}

try {
  const PIDiscovery = require('./pi-discovery');
  console.log('✓ PI Discovery module loaded');
} catch (e) {
  console.log('✗ PI Discovery not found:', e.message);
}

try {
  const auth = require('./middleware/auth');
  console.log('✓ Auth middleware loaded');
} catch (e) {
  console.log('✗ Auth middleware not found:', e.message);
}

try {
  const monitoring = require('./middleware/monitoring');
  console.log('✓ Monitoring middleware loaded');
} catch (e) {
  console.log('✗ Monitoring middleware not found:', e.message);
}

console.log('\nSetup test complete!');
