/**
 * Production Middleware Stack
 * Consolidated middleware configuration for production-ready API
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

// Custom middleware
const responseFormatter = require('./responseFormatter');
const { globalErrorHandler, notFoundHandler } = require('./errorHandler');
const { requestLogger } = require('../utils/logger');
const {
  createGeneralLimiter,
  createAuthLimiter,
  createUploadLimiter,
  createUserBasedLimiter
} = require('./rateLimiter');
const { sanitizeInput } = require('./validator');

/**
 * Request ID generator middleware
 */
const requestId = (req, res, next) => {
  const { v4: uuidv4 } = require('crypto');
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

/**
 * Request timeout middleware
 */
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    // Set timeout for the request
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: 'Request timeout'
          },
          timestamp: new Date().toISOString(),
          requestId: req.requestId
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    const originalEnd = res.end;
    res.end = function(...args) {
      clearTimeout(timeout);
      originalEnd.apply(this, args);
    };

    next();
  };
};

/**
 * Content size limit middleware
 */
const contentSizeLimit = {
  json: { limit: process.env.MAX_JSON_SIZE || '10mb' },
  urlencoded: { extended: true, limit: process.env.MAX_FORM_SIZE || '10mb' }
};

/**
 * CORS configuration
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://dev.jimboslice.xyz',
      'http://localhost:3000',
      'http://localhost:4201',
      'http://localhost:8080',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'Accept',
    'Origin'
  ],
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset'
  ]
};

/**
 * Security headers configuration
 */
const helmetOptions = {
  crossOriginEmbedderPolicy: false, // Allow embedding for development
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
};

/**
 * Development vs Production middleware selection
 */
const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Request logging configuration
 */
const morganFormat = isDevelopment 
  ? 'dev' 
  : ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms';

/**
 * Apply all middleware to Express app
 */
const setupMiddleware = (app) => {
  // 1. Security first - must be applied early
  app.use(helmet(helmetOptions));
  app.use(cors(corsOptions));
  
  // 2. Request processing middleware
  app.use(requestId);
  app.use(requestTimeout(parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000));
  
  // 3. Compression for responses
  app.use(compression());
  
  // 4. Body parsing with size limits
  app.use(express.json(contentSizeLimit.json));
  app.use(express.urlencoded(contentSizeLimit.urlencoded));
  
  // 5. Input sanitization
  app.use(sanitizeInput);
  
  // 6. Request logging
  if (isDevelopment) {
    app.use(morgan(morganFormat));
  }
  app.use(requestLogger);
  
  // 7. Response formatting
  app.use(responseFormatter);
  
  // 8. General rate limiting (applied to all routes)
  app.use(createGeneralLimiter());
  
  return app;
};

/**
 * Apply route-specific middleware
 */
const setupRouteMiddleware = (app) => {
  // Authentication routes with strict rate limiting
  app.use('/api/auth', createAuthLimiter());
  
  // Upload routes with special rate limiting
  app.use('/api/upload', createUploadLimiter());
  
  // Authenticated routes with user-based rate limiting
  app.use('/api/brains', createUserBasedLimiter());
  app.use('/api/cards', createUserBasedLimiter());
  app.use('/api/streams', createUserBasedLimiter());
  
  return app;
};

/**
 * Apply error handling middleware (must be last)
 */
const setupErrorHandling = (app) => {
  // 404 handler for unmatched API routes
  app.use('/api', notFoundHandler);
  
  // Global error handler (must be absolutely last)
  app.use(globalErrorHandler);
  
  return app;
};

/**
 * Complete middleware setup for production
 */
const setupProductionMiddleware = (app) => {
  setupMiddleware(app);
  setupRouteMiddleware(app);
  setupErrorHandling(app);
  
  return app;
};

/**
 * Middleware for development (lighter security)
 */
const setupDevelopmentMiddleware = (app) => {
  // Lighter security for development
  app.use(helmet({ 
    ...helmetOptions,
    contentSecurityPolicy: false // Disable CSP in development
  }));
  app.use(cors(corsOptions));
  
  app.use(requestId);
  app.use(compression());
  app.use(express.json(contentSizeLimit.json));
  app.use(express.urlencoded(contentSizeLimit.urlencoded));
  app.use(sanitizeInput);
  app.use(morgan('dev'));
  app.use(responseFormatter);
  
  // Lighter rate limiting in development
  app.use('/api/auth', createAuthLimiter());
  
  // Error handling
  app.use('/api', notFoundHandler);
  app.use(globalErrorHandler);
  
  return app;
};

/**
 * Middleware health check
 */
const middlewareHealthCheck = (req, res, next) => {
  // Add middleware status to health check
  req.middlewareStatus = {
    requestId: !!req.requestId,
    responseFormatter: !!res.apiSuccess,
    rateLimiter: !!res.get('X-RateLimit-Limit'),
    timestamp: new Date().toISOString()
  };
  next();
};

module.exports = {
  setupMiddleware,
  setupRouteMiddleware,
  setupErrorHandling,
  setupProductionMiddleware,
  setupDevelopmentMiddleware,
  middlewareHealthCheck,
  
  // Individual middleware exports for custom configurations
  requestId,
  requestTimeout,
  contentSizeLimit,
  corsOptions,
  helmetOptions,
  createGeneralLimiter,
  createAuthLimiter,
  createUploadLimiter,
  createUserBasedLimiter
};