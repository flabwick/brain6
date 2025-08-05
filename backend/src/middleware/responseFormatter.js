/**
 * Response formatter middleware that standardizes all API responses
 * Adds helper methods to the Express response object
 */

const { v4: uuidv4 } = require('crypto');
const { ApiError } = require('../utils/apiError');

/**
 * Middleware that adds standardized response methods to Express res object
 */
const responseFormatter = (req, res, next) => {
  // Generate unique request ID for tracking
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  
  // Set request ID header for client
  res.setHeader('X-Request-ID', requestId);

  /**
   * Send success response with standardized format
   * @param {*} data - Response data
   * @param {string} message - Optional success message
   * @param {number} statusCode - HTTP status code (default: 200)
   */
  res.apiSuccess = function(data, message = null, statusCode = 200) {
    const response = {
      success: true,
      data: data,
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    if (message) {
      response.message = message;
    }

    return this.status(statusCode).json(response);
  };

  /**
   * Send error response with standardized format
   * @param {Error|ApiError|string} error - Error object or message
   * @param {number} statusCode - HTTP status code (default: 500)
   */
  res.apiError = function(error, statusCode = 500) {
    let errorResponse;

    if (error instanceof ApiError) {
      statusCode = error.statusCode;
      errorResponse = error.toJSON();
    } else if (error instanceof Error) {
      errorResponse = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : error.message,
          details: process.env.NODE_ENV === 'development' ? {
            stack: error.stack
          } : null
        },
        timestamp: new Date().toISOString()
      };
    } else if (typeof error === 'string') {
      errorResponse = {
        success: false,
        error: {
          code: 'GENERIC_ERROR',
          message: error
        },
        timestamp: new Date().toISOString()
      };
    } else {
      errorResponse = {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'An unknown error occurred'
        },
        timestamp: new Date().toISOString()
      };
    }

    // Add request ID to error response
    errorResponse.requestId = requestId;

    return this.status(statusCode).json(errorResponse);
  };

  /**
   * Send validation error response
   * @param {Object} fieldErrors - Object with field names as keys and error messages as values
   * @param {string} message - General validation error message
   */
  res.apiValidationError = function(fieldErrors, message = 'Validation failed') {
    const response = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: message,
        details: fieldErrors
      },
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    return this.status(400).json(response);
  };

  /**
   * Send not found error response
   * @param {string} resource - Name of the resource that wasn't found
   * @param {string} resourceId - ID of the resource (optional)
   */
  res.apiNotFound = function(resource = 'Resource', resourceId = null) {
    const message = resourceId 
      ? `${resource} with ID '${resourceId}' not found`
      : `${resource} not found`;

    const response = {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: message,
        details: { resource, resourceId }
      },
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    return this.status(404).json(response);
  };

  /**
   * Send unauthorized error response
   * @param {string} message - Custom unauthorized message
   */
  res.apiUnauthorized = function(message = 'Authentication required') {
    const response = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: message
      },
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    return this.status(401).json(response);
  };

  /**
   * Send forbidden error response
   * @param {string} message - Custom forbidden message
   */
  res.apiForbidden = function(message = 'Access denied') {
    const response = {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: message
      },
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    return this.status(403).json(response);
  };

  /**
   * Send conflict error response
   * @param {string} message - Conflict message
   * @param {Object} details - Additional conflict details
   */
  res.apiConflict = function(message = 'Resource conflict', details = null) {
    const response = {
      success: false,
      error: {
        code: 'CONFLICT',
        message: message,
        details: details
      },
      timestamp: new Date().toISOString(),
      requestId: requestId
    };

    return this.status(409).json(response);
  };

  /**
   * Send created response (for POST requests)
   * @param {*} data - Created resource data
   * @param {string} message - Success message
   */
  res.apiCreated = function(data, message = 'Resource created successfully') {
    return this.apiSuccess(data, message, 201);
  };

  /**
   * Send accepted response (for async operations)
   * @param {*} data - Response data (e.g., job ID)
   * @param {string} message - Success message
   */
  res.apiAccepted = function(data, message = 'Request accepted for processing') {
    return this.apiSuccess(data, message, 202);
  };

  /**
   * Send no content response
   * @param {string} message - Optional message
   */
  res.apiNoContent = function(message = null) {
    if (message) {
      return this.apiSuccess(null, message, 204);
    }
    return this.status(204).send();
  };

  next();
};

module.exports = responseFormatter;