/**
 * System monitoring and health check endpoints
 * Provides API health status, debug information, and system metrics
 */

const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { asyncHandler } = require('../middleware/errorHandler');
const { middlewareHealthCheck } = require('../middleware');
const { healthCheck, pool } = require('../models/database');
const { jobQueue } = require('../services/simpleJobQueue');
const { rateLimiter } = require('../middleware/rateLimiter');
const { logger } = require('../utils/logger');

/**
 * GET /api/health
 * Basic health check - public endpoint
 */
router.get('/health', middlewareHealthCheck, asyncHandler(async (req, res) => {
  try {
    // Check database connectivity
    const dbHealthy = await healthCheck();
    
    // Check file system access
    const logDir = path.join(__dirname, '../../logs');
    let fileSystemHealthy = true;
    try {
      await fs.access(logDir);
    } catch {
      fileSystemHealthy = false;
    }

    const status = {
      status: dbHealthy && fileSystemHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      environment: process.env.NODE_ENV || 'development',
      components: {
        database: dbHealthy,
        filesystem: fileSystemHealthy,
        middleware: req.middlewareStatus
      }
    };

    const statusCode = status.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json(status);
    
  } catch (error) {
    await logger.error('Health check failed', { error: error.message });
    
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Service unavailable'
    });
  }
}));

/**
 * GET /api/health/detailed
 * Detailed health check with system metrics
 */
router.get('/health/detailed', asyncHandler(async (req, res) => {
  try {
    // Database health with connection pool stats
    const dbHealthy = await healthCheck();
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryStats = {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
      heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    };

    // Job queue stats
    const queueStats = jobQueue.getStats();

    // Rate limiter stats
    const rateLimiterStats = rateLimiter.getOverallStats();

    // File system checks
    const fileSystemChecks = await checkFileSystemHealth();

    // CPU usage (simple check)
    const loadAverage = process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0];

    const detailedStatus = {
      status: dbHealthy && fileSystemChecks.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(process.uptime() / 60)} minutes`,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      system: {
        loadAverage: loadAverage,
        memory: memoryStats,
        pid: process.pid
      },
      components: {
        database: {
          healthy: dbHealthy,
          connectionPool: poolStats
        },
        jobQueue: {
          healthy: true,
          stats: queueStats
        },
        rateLimiter: {
          healthy: true,
          stats: rateLimiterStats
        },
        fileSystem: fileSystemChecks
      }
    };

    const statusCode = detailedStatus.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json(detailedStatus);

  } catch (error) {
    await logger.error('Detailed health check failed', { error: error.message });
    
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Detailed health check failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Service unavailable'
    });
  }
}));

/**
 * GET /api/system/stats
 * System statistics for monitoring
 */
router.get('/stats', asyncHandler(async (req, res) => {
  try {
    // Get various system statistics
    const stats = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      jobQueue: jobQueue.getStats(),
      rateLimiter: rateLimiter.getOverallStats(),
      database: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    };

    return res.apiSuccess(stats);
    
  } catch (error) {
    await logger.error('Failed to get system stats', { error: error.message });
    throw error;
  }
}));

/**
 * Development and debug endpoints (only available in development)
 */
if (process.env.NODE_ENV === 'development') {
  
  /**
   * GET /api/debug/jobs
   * Current job queue status
   */
  router.get('/debug/jobs', asyncHandler(async (req, res) => {
    const stats = jobQueue.getStats();
    
    // Get sample of recent jobs (without sensitive data)
    const sampleJobs = [];
    for (const [jobId, job] of Array.from(jobQueue.jobs.entries()).slice(0, 10)) {
      sampleJobs.push({
        id: jobId,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        retryCount: job.retryCount
      });
    }

    return res.apiSuccess({
      stats,
      sampleJobs,
      pendingJobIds: jobQueue.pendingJobs.slice(0, 10),
      processingJobId: jobQueue.processingJobId
    });
  }));

  /**
   * GET /api/debug/errors
   * Recent error summary
   */
  router.get('/debug/errors', asyncHandler(async (req, res) => {
    try {
      const errorLogPath = path.join(__dirname, '../../logs');
      const files = await fs.readdir(errorLogPath);
      const errorFiles = files.filter(f => f.startsWith('error-'));
      
      let recentErrors = [];
      
      if (errorFiles.length > 0) {
        // Read the most recent error log
        const latestErrorFile = errorFiles.sort().reverse()[0];
        const errorLogContent = await fs.readFile(
          path.join(errorLogPath, latestErrorFile), 
          'utf-8'
        );
        
        // Parse last 10 error entries
        const errorLines = errorLogContent.trim().split('\n').slice(-10);
        recentErrors = errorLines.map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line, timestamp: new Date().toISOString() };
          }
        });
      }

      return res.apiSuccess({
        recentErrors,
        errorLogFiles: errorFiles,
        totalErrorFiles: errorFiles.length
      });
      
    } catch (error) {
      return res.apiSuccess({
        message: 'Could not read error logs',
        error: error.message,
        recentErrors: []
      });
    }
  }));

  /**
   * POST /api/debug/test-upload
   * Test upload endpoint without processing
   */
  router.post('/test-upload', (req, res) => {
    return res.apiSuccess({
      message: 'Test upload endpoint - use /api/upload/test for actual file testing',
      body: req.body,
      headers: req.headers,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * POST /api/debug/cleanup
   * Manually trigger cleanup operations
   */
  router.post('/cleanup', asyncHandler(async (req, res) => {
    const results = {};
    
    try {
      // Cleanup old jobs
      results.jobsCleanup = await jobQueue.cleanupOldJobs(7);
    } catch (error) {
      results.jobsCleanup = { error: error.message };
    }

    try {
      // Log system metrics
      await logger.logMetrics();
      results.metricsLogged = true;
    } catch (error) {
      results.metricsLogged = { error: error.message };
    }

    return res.apiSuccess(results, 'Cleanup operations completed');
  }));
}

/**
 * GET /api/system/version
 * Get API version and build information
 */
router.get('/version', (req, res) => {
  const versionInfo = {
    version: process.env.npm_package_version || '1.0.0',
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
    gitCommit: process.env.GIT_COMMIT || 'unknown',
    environment: process.env.NODE_ENV || 'development',
    node: process.version,
    platform: process.platform
  };

  return res.apiSuccess(versionInfo);
});

/**
 * Helper function to check file system health
 */
async function checkFileSystemHealth() {
  const checks = {
    healthy: true,
    details: {}
  };

  try {
    // Check logs directory
    const logDir = path.join(__dirname, '../../logs');
    await fs.ensureDir(logDir);
    checks.details.logsDirectory = { accessible: true, path: logDir };
  } catch (error) {
    checks.healthy = false;
    checks.details.logsDirectory = { accessible: false, error: error.message };
  }

  try {
    // Check storage directory
    const storageDir = path.join(__dirname, '../../storage');
    await fs.access(storageDir);
    checks.details.storageDirectory = { accessible: true, path: storageDir };
  } catch (error) {
    checks.details.storageDirectory = { accessible: false, error: error.message };
  }

  try {
    // Check temp write access
    const tempFile = path.join(__dirname, '../../temp-write-test');
    await fs.writeFile(tempFile, 'test');
    await fs.remove(tempFile);
    checks.details.writeAccess = { working: true };
  } catch (error) {
    checks.healthy = false;
    checks.details.writeAccess = { working: false, error: error.message };
  }

  return checks;
}

module.exports = router;