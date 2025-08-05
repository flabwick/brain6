/**
 * Comprehensive error handling middleware for production-ready API
 */

const { logger } = require('../utils/logger');
const { ApiError, isOperationalError } = require('../utils/apiError');

/**
 * Global error handler middleware
 * Must be placed AFTER all routes and other middleware
 */
const globalErrorHandler = (error, req, res, next) => {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  // Log error with full context
  logErrorWithContext(error, req);

  // Handle known API errors
  if (error instanceof ApiError) {
    return res.apiError(error);
  }

  // Handle specific error types
  if (error.name === 'ValidationError') {
    return handleValidationError(error, res);
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    return handleFileSizeError(error, res);
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return handleFileCountError(error, res);
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return handleUnexpectedFileError(error, res);
  }

  // Handle database errors
  if (isDatabaseError(error)) {
    return handleDatabaseError(error, res);
  }

  // Handle file system errors
  if (isFileSystemError(error)) {
    return handleFileSystemError(error, res);
  }

  // Handle timeout errors
  if (error.code === 'TIMEOUT' || error.name === 'TimeoutError') {
    return handleTimeoutError(error, res);
  }

  // Handle JSON parsing errors
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.apiError('Invalid JSON in request body', 400);
  }

  // Handle unknown errors
  handleUnknownError(error, res);
};

/**
 * 404 handler for unmatched routes
 */
const notFoundHandler = (req, res) => {
  res.apiNotFound('API endpoint');
};

/**
 * Async error wrapper for route handlers
 * Catches async errors and passes them to error handler
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Log error with full request context
 */
async function logErrorWithContext(error, req) {
  const context = {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    userId: req.session?.userId || null,
    sessionId: req.sessionID || null,
    body: sanitizeRequestBody(req.body),
    query: req.query,
    params: req.params
  };

  // Add stack trace for operational errors in development
  if (process.env.NODE_ENV === 'development' && isOperationalError(error)) {
    context.stack = error.stack;
  }

  await logger.logError(error, context);
}

/**
 * Sanitize request body to remove sensitive data from logs
 */
function sanitizeRequestBody(body) {
  if (!body || typeof body !== 'object') return body;

  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

  const sanitizeObject = (obj) => {
    Object.keys(obj).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    });
  };

  sanitizeObject(sanitized);
  return sanitized;
}

/**
 * Handle validation errors
 */
function handleValidationError(error, res) {
  const fieldErrors = {};
  
  if (error.errors) {
    Object.keys(error.errors).forEach(field => {
      fieldErrors[field] = error.errors[field].message;
    });
  }

  return res.apiValidationError(fieldErrors, 'Validation failed');
}

/**
 * Handle file size limit errors
 */
function handleFileSizeError(error, res) {
  return res.apiError(
    `File too large. Maximum size allowed: ${formatBytes(error.limit)}`,
    413
  );
}

/**
 * Handle file count limit errors
 */
function handleFileCountError(error, res) {
  return res.apiError(
    `Too many files uploaded. Maximum allowed: ${error.limit}`,
    400
  );
}

/**
 * Handle unexpected file field errors
 */
function handleUnexpectedFileError(error, res) {
  return res.apiError(
    'Unexpected file field in upload',
    400
  );
}

/**
 * Check if error is a database error
 */
function isDatabaseError(error) {
  return error.code && (
    error.code.startsWith('23') || // Integrity constraint violations
    error.code.startsWith('42') || // Syntax errors
    error.code === '08003' ||      // Connection does not exist
    error.code === '08006' ||      // Connection failure  
    error.code === '53300'         // Too many connections
  );
}

/**
 * Handle database errors
 */
function handleDatabaseError(error, res) {
  // Map common database errors to user-friendly messages
  const errorMessages = {
    '23505': 'Resource already exists',           // Unique violation
    '23503': 'Referenced resource does not exist', // Foreign key violation
    '23514': 'Invalid data provided',             // Check violation
    '42703': 'Invalid request format',            // Undefined column
    '08003': 'Database connection lost',          // Connection does not exist
    '08006': 'Database connection failed',        // Connection failure
    '53300': 'Service temporarily unavailable'    // Too many connections
  };

  const message = errorMessages[error.code] || 'Database operation failed';
  
  return res.apiError(message, 500);
}

/**
 * Check if error is a file system error
 */
function isFileSystemError(error) {
  return error.code && (
    error.code === 'ENOENT' ||  // File not found
    error.code === 'EACCES' ||  // Permission denied
    error.code === 'ENOSPC' ||  // No space left
    error.code === 'EMFILE' ||  // Too many open files
    error.code === 'EISDIR' ||  // Is a directory
    error.code === 'ENOTDIR'    // Not a directory
  );
}

/**
 * Handle file system errors
 */
function handleFileSystemError(error, res) {
  const errorMessages = {
    'ENOENT': 'File or directory not found',
    'EACCES': 'Permission denied',
    'ENOSPC': 'Insufficient storage space',
    'EMFILE': 'Too many files open',
    'EISDIR': 'Expected file but found directory',
    'ENOTDIR': 'Expected directory but found file'
  };

  const message = errorMessages[error.code] || 'File system operation failed';
  
  return res.apiError(message, 500);
}

/**
 * Handle timeout errors
 */
function handleTimeoutError(error, res) {
  return res.apiError(
    'Request timeout. Operation took too long to complete.',
    408
  );
}

/**
 * Handle unknown/unexpected errors
 */
function handleUnknownError(error, res) {
  // Log as critical error
  logger.error('Unknown error occurred', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  });

  // Return generic error message
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;

  return res.apiError(message, 500);
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create error boundary for critical operations
 */
const createErrorBoundary = (operation) => {
  return async (req, res, next) => {
    try {
      await operation(req, res, next);
    } catch (error) {
      // Ensure error is properly logged and handled
      await logger.logError(error, {
        operation: operation.name,
        requestId: req.requestId
      });
      next(error);
    }
  };
};

module.exports = {
  globalErrorHandler,
  notFoundHandler,
  asyncHandler,
  createErrorBoundary
};