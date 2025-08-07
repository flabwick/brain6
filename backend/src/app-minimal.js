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

// Simple UUID generator
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

// Request ID middleware
app.use((req, res, next) => {
  req.id = generateUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Response formatter middleware
app.use((req, res, next) => {
  res.apiSuccess = (data) => {
    return res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  };
  
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

// Middleware setup
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: [
    'https://dev.jimboslice.xyz',
    'http://localhost:3000',
    'http://localhost:4201'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

app.use(helmet({
  crossOriginEmbedderPolicy: false,
}));

app.use(morgan('combined'));

// Session configuration
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'web_sessions',
    createTableIfMissing: false
  }),
  secret: process.env.SESSION_SECRET || 'clarity-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  },
  name: 'clarity.sid'
}));

// Test endpoint with new format
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

// System health endpoint
app.get('/api/system/health', async (req, res) => {
  console.log('🏥 System health check requested');
  try {
    const { healthCheck } = require('./models/database');
    const isHealthy = await healthCheck();
    
    const memUsage = process.memoryUsage();
    
    res.apiSuccess({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      components: {
        database: isHealthy,
        server: true,
        memory: {
          used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
        }
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.apiError(503, 'HEALTH_CHECK_FAILED', 'Health check failed', error.message);
  }
});

// System stats endpoint
app.get('/api/system/stats', async (req, res) => {
  console.log('📊 System stats requested');
  try {
    const memUsage = process.memoryUsage();
    
    res.apiSuccess({
      uptime: process.uptime(),
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
      },
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    });
  } catch (error) {
    console.error('❌ Stats failed:', error);
    res.apiError(500, 'STATS_FAILED', 'Unable to get system stats', error.message);
  }
});

// System version endpoint
app.get('/api/system/version', (req, res) => {
  console.log('📋 Version info requested');
  try {
    res.apiSuccess({
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      node: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString()
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
    version: '1.0.0',
    description: 'Production-ready knowledge management API',
    endpoints: {
      test: '/api/test',
      health: '/api/system/health',
      stats: '/api/system/stats',
      version: '/api/system/version'
    }
  });
});

// Original application routes
try {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/brains', require('./routes/brains'));
  app.use('/api/cards', require('./routes/cards'));
  
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

// 404 handler for API routes
app.use('/api', (req, res, next) => {
  console.log(`❌ 404: ${req.method} ${req.path} not found`);
  if (!res.headersSent) {
    res.apiError(404, 'NOT_FOUND', `The endpoint ${req.method} ${req.path} does not exist`);
  }
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  
  if (res.headersSent) {
    return next(error);
  }
  
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

console.log('✅ Minimal production app loaded successfully');
module.exports = app;