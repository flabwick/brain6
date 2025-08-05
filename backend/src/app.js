// src/app.js
// Production-ready Express application with all features integrated

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const { pool } = require('./models/database');
const crypto = require('crypto');

const app = express();

// Simple UUID v4 generator (since crypto.v4 doesn't exist)
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

// Request ID middleware - adds unique ID to each request
app.use((req, res, next) => {
  req.id = generateUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Response formatter middleware - standardizes API responses
app.use((req, res, next) => {
  // Helper for success responses
  res.apiSuccess = (data) => {
    return res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  };
  
  // Helper for error responses
  res.apiError = (statusCode, code, message, details = null) => {
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        details
      },
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  };
  
  next();
});

// Basic middleware setup (order is important)
app.use(compression()); // Compress responses
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration
app.use(cors({
  origin: ['http://localhost:4201', 'http://localhost:3000'], // Frontend URLs
  credentials: true, // Required for cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding for development
}));

// Request logging
app.use(morgan('combined'));

// Session configuration
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'web_sessions',
    createTableIfMissing: false // Table should already exist
  }),
  secret: process.env.SESSION_SECRET || 'clarity-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax' // CSRF protection
  },
  name: 'clarity.sid' // Custom session cookie name
}));

// Import database and other modules BEFORE defining routes
const database = require('./models/database');
const fs = require('fs-extra');
const path = require('path');

// ===== ROUTES SECTION (ORDER MATTERS!) =====

// Keep existing test endpoint FIRST
app.get('/api/test', (req, res) => {
  console.log('🧪 Test endpoint requested');
  res.apiSuccess({
    message: 'Production API is running!',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    session: req.session ? {
      id: req.sessionID,
      userId: req.session.userId || null
    } : null
  });
});

// Basic health check
app.get('/api/health', async (req, res) => {
  console.log('🏥 Health check requested');
  try {
    const isHealthy = await database.healthCheck();
    
    if (isHealthy) {
      res.apiSuccess({
        status: 'healthy',
        services: {
          database: 'connected',
          filesystem: 'accessible',
          server: 'running'
        }
      });
    } else {
      res.apiError(503, 'HEALTH_CHECK_FAILED', 'Database connection failed');
    }
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.apiError(503, 'HEALTH_CHECK_FAILED', 'Health check failed', error.message);
  }
});

// Detailed health check
app.get('/api/system/health', async (req, res) => {
  console.log('🏥 Detailed health check requested');
  try {
    const startTime = Date.now();
    
    // Database health
    const dbStart = Date.now();
    const dbResult = await database.query('SELECT version(), NOW() as current_time');
    const dbTime = Date.now() - dbStart;
    
    // Memory usage
    const memUsage = process.memoryUsage();
    
    res.apiSuccess({
      status: 'healthy',
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
        }
      },
      database: {
        status: 'connected',
        responseTime: dbTime + 'ms',
        currentTime: dbResult.rows[0].current_time
      },
      responseTime: Date.now() - startTime + 'ms'
    });
  } catch (error) {
    console.error('❌ Detailed health check failed:', error);
    res.apiError(503, 'DETAILED_HEALTH_CHECK_FAILED', 'Detailed health check failed', error.message);
  }
});

// System statistics
app.get('/api/system/stats', async (req, res) => {
  console.log('📊 System stats requested');
  try {
    // Get database stats
    const userCount = await database.query('SELECT COUNT(*) as count FROM users');
    const brainCount = await database.query('SELECT COUNT(*) as count FROM brains');
    const cardCount = await database.query('SELECT COUNT(*) as count FROM cards WHERE is_active = true');
    
    res.apiSuccess({
      users: parseInt(userCount.rows[0].count),
      brains: parseInt(brainCount.rows[0].count),
      cards: parseInt(cardCount.rows[0].count),
      memory: process.memoryUsage(),
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('❌ System stats failed:', error);
    res.apiError(503, 'STATS_FAILED', 'Unable to get system statistics', error.message);
  }
});

// Version information
app.get('/api/system/version', (req, res) => {
  console.log('ℹ️  Version info requested');
  try {
    const packageJson = require('../package.json');
    
    res.apiSuccess({
      name: packageJson.name,
      version: packageJson.version,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('❌ Version info failed:', error);
    res.apiError(500, 'VERSION_INFO_FAILED', 'Unable to get version information', error.message);
  }
});

// API documentation endpoint
app.get('/api', (req, res) => {
  console.log('📖 API documentation requested');
  res.apiSuccess({
    name: 'Clarity Knowledge Management API',
    version: require('../package.json').version,
    description: 'Knowledge management with file processing',
    endpoints: {
      authentication: '/api/auth',
      brains: '/api/brains',
      cards: '/api/cards',
      streams: '/api/streams'
    },
    system: {
      health: '/api/health',
      detailedHealth: '/api/system/health',
      stats: '/api/system/stats',
      version: '/api/system/version'
    }
  });
});

// ===== APPLICATION ROUTES =====
try {
  // Core application routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/brains', require('./routes/brains'));
  app.use('/api/cards', require('./routes/cards'));
  
  // Check if streams route exists
  try {
    app.use('/api/streams', require('./routes/streams'));
    console.log('✅ Streams routes loaded');
  } catch (error) {
    console.log('⚠️  Streams route not available yet:', error.message);
  }
  
} catch (error) {
  console.error('❌ Error loading routes:', error);
  throw error;
}

// ===== ERROR HANDLERS (MUST BE LAST!) =====

// 404 handler for API routes (AFTER all routes are defined)
app.use('/api', (req, res, next) => {
  console.log(`❌ 404: ${req.method} ${req.path} not found`);
  if (!res.headersSent) {
    res.apiError(404, 'NOT_FOUND', `The endpoint ${req.method} ${req.path} does not exist`);
  }
});

// Global error handler (MUST BE LAST!)
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  
  // Don't send error if response already sent
  if (res.headersSent) {
    return next(error);
  }
  
  // Send appropriate error response
  if (res.apiError) {
    res.apiError(500, 'INTERNAL_SERVER_ERROR', 
      process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong');
  } else {
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
  }
});

console.log('✅ App.js loaded successfully');
module.exports = app;