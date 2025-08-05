/**
 * Simple in-memory rate limiter
 * For production, consider using Redis-based rate limiting
 */

const { logger } = require('../utils/logger');
const { TooManyRequestsError } = require('../utils/apiError');

class SimpleRateLimiter {
  constructor() {
    this.requests = new Map(); // Map of identifier -> request data
    this.cleanupInterval = 60 * 1000; // Clean up every minute
    
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Create rate limiter middleware
   */
  createLimiter(options = {}) {
    const {
      windowMs = 60 * 60 * 1000, // 1 hour window
      maxRequests = 100,         // Max requests per window
      keyGenerator = (req) => req.ip, // Function to generate unique key
      skipSuccessfulRequests = false,
      skipFailedRequests = false,
      message = 'Too many requests, please try again later'
    } = options;

    return async (req, res, next) => {
      try {
        const key = keyGenerator(req);
        const now = Date.now();
        const windowStart = now - windowMs;

        // Get or create request data for this key
        let requestData = this.requests.get(key);
        if (!requestData) {
          requestData = {
            requests: [],
            totalRequests: 0
          };
          this.requests.set(key, requestData);
        }

        // Clean old requests outside the window
        requestData.requests = requestData.requests.filter(
          timestamp => timestamp > windowStart
        );

        // Check if limit exceeded
        if (requestData.requests.length >= maxRequests) {
          const oldestRequest = Math.min(...requestData.requests);
          const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

          // Log rate limit hit
          await logger.warn('Rate limit exceeded', {
            key,
            currentRequests: requestData.requests.length,
            maxRequests,
            windowMs,
            retryAfter,
            endpoint: req.path,
            userAgent: req.get('User-Agent')
          });

          // Set rate limit headers
          res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': 0,
            'X-RateLimit-Reset': new Date(oldestRequest + windowMs).toISOString(),
            'Retry-After': retryAfter
          });

          throw new TooManyRequestsError(message, retryAfter);
        }

        // Override res.end to track the response
        const originalEnd = res.end;
        res.end = function(...args) {
          const statusCode = res.statusCode;
          
          // Only count request if we should track it
          const shouldCount = (
            (!skipSuccessfulRequests || statusCode >= 400) &&
            (!skipFailedRequests || statusCode < 400)
          );

          if (shouldCount) {
            requestData.requests.push(now);
            requestData.totalRequests++;
          }

          // Set rate limit headers
          res.set({
            'X-RateLimit-Limit': maxRequests,
            'X-RateLimit-Remaining': Math.max(0, maxRequests - requestData.requests.length),
            'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
          });

          originalEnd.apply(this, args);
        };

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Get rate limit stats for a key
   */
  getStats(key) {
    const requestData = this.requests.get(key);
    if (!requestData) {
      return { requests: 0, totalRequests: 0 };
    }

    const now = Date.now();
    const windowStart = now - (60 * 60 * 1000); // 1 hour window
    
    // Clean old requests
    requestData.requests = requestData.requests.filter(
      timestamp => timestamp > windowStart
    );

    return {
      requests: requestData.requests.length,
      totalRequests: requestData.totalRequests,
      oldestRequest: requestData.requests.length > 0 ? Math.min(...requestData.requests) : null
    };
  }

  /**
   * Clear rate limit data for a key
   */
  reset(key) {
    this.requests.delete(key);
  }

  /**
   * Start cleanup interval to remove old data
   */
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - (2 * 60 * 60 * 1000); // 2 hours ago

      let cleanedCount = 0;
      for (const [key, requestData] of this.requests.entries()) {
        // Remove very old requests
        requestData.requests = requestData.requests.filter(
          timestamp => timestamp > cutoff
        );

        // Remove entries with no recent requests
        if (requestData.requests.length === 0) {
          this.requests.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} old rate limit entries`);
      }
    }, this.cleanupInterval);
  }

  /**
   * Get overall stats
   */
  getOverallStats() {
    return {
      totalKeys: this.requests.size,
      totalActiveRequests: Array.from(this.requests.values())
        .reduce((sum, data) => sum + data.requests.length, 0)
    };
  }
}

// Create singleton instance
const rateLimiter = new SimpleRateLimiter();

// Predefined rate limiters
const createGeneralLimiter = () => rateLimiter.createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_HOUR) || 100,
  keyGenerator: (req) => req.ip,
  message: 'Too many requests from this IP, please try again later'
});

const createAuthLimiter = () => rateLimiter.createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // Very strict for auth endpoints
  keyGenerator: (req) => req.ip,
  skipSuccessfulRequests: true, // Only count failed attempts
  message: 'Too many authentication attempts, please try again later'
});

const createUploadLimiter = () => rateLimiter.createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: parseInt(process.env.RATE_LIMIT_UPLOADS_PER_HOUR) || 10,
  keyGenerator: (req) => req.session?.userId || req.ip,
  message: 'Upload limit exceeded, please try again later'
});

const createUserBasedLimiter = () => rateLimiter.createLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 1000, // Higher limit for authenticated users
  keyGenerator: (req) => req.session?.userId || req.ip,
  message: 'Request limit exceeded for your account'
});

module.exports = {
  rateLimiter,
  createGeneralLimiter,
  createAuthLimiter,
  createUploadLimiter,
  createUserBasedLimiter
};