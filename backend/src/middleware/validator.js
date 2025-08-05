/**
 * Request validation middleware
 * Provides common validation patterns for API endpoints
 */

const { ValidationError } = require('../utils/apiError');

/**
 * UUID validation pattern
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID parameter
 */
const validateUUID = (paramName) => {
  return (req, res, next) => {
    const value = req.params[paramName];
    
    if (!value) {
      return next(new ValidationError(`Missing required parameter: ${paramName}`));
    }
    
    if (!UUID_PATTERN.test(value)) {
      return next(new ValidationError(`Invalid UUID format for parameter: ${paramName}`));
    }
    
    next();
  };
};

/**
 * Validate request body against schema
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const errors = {};
    const body = req.body;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!body[field] || (typeof body[field] === 'string' && body[field].trim() === '')) {
          errors[field] = `Field '${field}' is required`;
        }
      }
    }

    // Validate field types and constraints
    if (schema.fields) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
        const value = body[fieldName];
        
        // Skip validation if field is missing and not required
        if (value === undefined || value === null) continue;
        
        // Type validation
        if (fieldSchema.type) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== fieldSchema.type) {
            errors[fieldName] = `Field '${fieldName}' must be of type ${fieldSchema.type}`;
            continue;
          }
        }

        // String validation
        if (fieldSchema.type === 'string' && typeof value === 'string') {
          if (fieldSchema.minLength && value.length < fieldSchema.minLength) {
            errors[fieldName] = `Field '${fieldName}' must be at least ${fieldSchema.minLength} characters`;
          }
          if (fieldSchema.maxLength && value.length > fieldSchema.maxLength) {
            errors[fieldName] = `Field '${fieldName}' must be no more than ${fieldSchema.maxLength} characters`;
          }
          if (fieldSchema.pattern && !fieldSchema.pattern.test(value)) {
            errors[fieldName] = `Field '${fieldName}' has invalid format`;
          }
          if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
            errors[fieldName] = `Field '${fieldName}' must be one of: ${fieldSchema.enum.join(', ')}`;
          }
        }

        // Number validation
        if (fieldSchema.type === 'number' && typeof value === 'number') {
          if (fieldSchema.min !== undefined && value < fieldSchema.min) {
            errors[fieldName] = `Field '${fieldName}' must be at least ${fieldSchema.min}`;
          }
          if (fieldSchema.max !== undefined && value > fieldSchema.max) {
            errors[fieldName] = `Field '${fieldName}' must be no more than ${fieldSchema.max}`;
          }
        }

        // Array validation
        if (fieldSchema.type === 'array' && Array.isArray(value)) {
          if (fieldSchema.minItems && value.length < fieldSchema.minItems) {
            errors[fieldName] = `Field '${fieldName}' must have at least ${fieldSchema.minItems} items`;
          }
          if (fieldSchema.maxItems && value.length > fieldSchema.maxItems) {
            errors[fieldName] = `Field '${fieldName}' must have no more than ${fieldSchema.maxItems} items`;
          }
        }

        // Custom validation
        if (fieldSchema.validate && typeof fieldSchema.validate === 'function') {
          try {
            const customResult = fieldSchema.validate(value);
            if (customResult !== true) {
              errors[fieldName] = customResult || `Field '${fieldName}' failed validation`;
            }
          } catch (error) {
            errors[fieldName] = `Field '${fieldName}' validation error: ${error.message}`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(new ValidationError('Validation failed', errors));
    }

    next();
  };
};

/**
 * Validate query parameters
 */
const validateQuery = (schema) => {
  return (req, res, next) => {
    const errors = {};
    const query = req.query;

    for (const [paramName, paramSchema] of Object.entries(schema)) {
      const value = query[paramName];
      
      // Skip if parameter is missing and not required
      if (value === undefined) {
        if (paramSchema.required) {
          errors[paramName] = `Query parameter '${paramName}' is required`;
        }
        continue;
      }

      // Type conversion and validation
      let convertedValue = value;
      
      if (paramSchema.type === 'number') {
        convertedValue = Number(value);
        if (isNaN(convertedValue)) {
          errors[paramName] = `Query parameter '${paramName}' must be a number`;
          continue;
        }
      } else if (paramSchema.type === 'boolean') {
        convertedValue = value.toLowerCase() === 'true';
      } else if (paramSchema.type === 'array') {
        convertedValue = Array.isArray(value) ? value : [value];
      }

      // Range validation for numbers
      if (paramSchema.type === 'number') {
        if (paramSchema.min !== undefined && convertedValue < paramSchema.min) {
          errors[paramName] = `Query parameter '${paramName}' must be at least ${paramSchema.min}`;
        }
        if (paramSchema.max !== undefined && convertedValue > paramSchema.max) {
          errors[paramName] = `Query parameter '${paramName}' must be no more than ${paramSchema.max}`;
        }
      }

      // Enum validation
      if (paramSchema.enum && !paramSchema.enum.includes(convertedValue)) {
        errors[paramName] = `Query parameter '${paramName}' must be one of: ${paramSchema.enum.join(', ')}`;
      }

      // Update query with converted value
      req.query[paramName] = convertedValue;
    }

    if (Object.keys(errors).length > 0) {
      return next(new ValidationError('Query validation failed', errors));
    }

    next();
  };
};

/**
 * Sanitize input to prevent XSS and injection attacks
 */
const sanitizeInput = (req, res, next) => {
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    // Remove potentially dangerous HTML tags and scripts
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  };

  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }

  next();
};

/**
 * Validate file upload parameters
 */
const validateFileUpload = (options = {}) => {
  const {
    maxFiles = 10,
    maxFileSize = 100 * 1024 * 1024, // 100MB
    allowedMimeTypes = [],
    allowedExtensions = [],
    requireBrainId = true
  } = options;

  return (req, res, next) => {
    const errors = {};

    // Check if files are present
    if (!req.files || req.files.length === 0) {
      errors.files = 'At least one file is required';
    } else {
      // Check file count
      if (req.files.length > maxFiles) {
        errors.files = `Too many files. Maximum ${maxFiles} files allowed`;
      }

      // Check each file
      req.files.forEach((file, index) => {
        const fieldName = `files[${index}]`;

        // Check file size
        if (file.size > maxFileSize) {
          errors[fieldName] = `File too large. Maximum size: ${Math.round(maxFileSize / 1024 / 1024)}MB`;
        }

        // Check MIME type
        if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.mimetype)) {
          errors[fieldName] = `Unsupported file type: ${file.mimetype}`;
        }

        // Check file extension
        if (allowedExtensions.length > 0) {
          const ext = file.originalname.split('.').pop().toLowerCase();
          if (!allowedExtensions.includes(`.${ext}`)) {
            errors[fieldName] = `Unsupported file extension: .${ext}`;
          }
        }

        // Check filename
        if (!file.originalname || file.originalname.trim() === '') {
          errors[fieldName] = 'File must have a name';
        }
      });
    }

    // Check brain ID if required
    if (requireBrainId) {
      const brainId = req.body.brainId;
      if (!brainId) {
        errors.brainId = 'Brain ID is required';
      } else if (!UUID_PATTERN.test(brainId)) {
        errors.brainId = 'Invalid brain ID format';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(new ValidationError('File upload validation failed', errors));
    }

    next();
  };
};

/**
 * Common validation schemas
 */
const schemas = {
  // Brain creation/update
  brain: {
    required: ['name'],
    fields: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        pattern: /^[a-zA-Z0-9\s\-_]+$/
      }
    }
  },

  // Card creation/update
  card: {
    required: ['title', 'content'],
    fields: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: 200
      },
      content: {
        type: 'string',
        minLength: 1
      }
    }
  },

  // Stream creation/update
  stream: {
    required: ['name'],
    fields: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 100
      },
      isFavorited: {
        type: 'boolean'
      }
    }
  },

  // Pagination parameters
  pagination: {
    page: {
      type: 'number',
      min: 1,
      max: 1000
    },
    limit: {
      type: 'number',
      min: 1,
      max: 100
    },
    sort: {
      type: 'string',
      enum: ['created_at', 'updated_at', 'name', 'title']
    },
    order: {
      type: 'string',
      enum: ['asc', 'desc']
    }
  }
};

module.exports = {
  validateUUID,
  validateBody,
  validateQuery,
  sanitizeInput,
  validateFileUpload,
  schemas
};