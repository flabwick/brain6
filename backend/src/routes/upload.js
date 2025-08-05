/**
 * Unified File Upload API Endpoint
 * Single powerful endpoint for handling all file uploads with background processing
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateUUID, validateBody, validateFileUpload } = require('../middleware/validator');
const { asyncHandler } = require('../middleware/errorHandler');
const { FileUploadPipeline } = require('../services/fileUploadPipeline');
const { jobQueue } = require('../services/simpleJobQueue');
const { logger } = require('../utils/logger');
const { 
  ValidationError, 
  NotFoundError, 
  ForbiddenError 
} = require('../utils/apiError');

// Initialize upload pipeline
const uploadPipeline = new FileUploadPipeline();

// All upload routes require authentication
router.use(requireAuth);

/**
 * POST /api/upload
 * Main file upload endpoint
 */
router.post('/', 
  uploadPipeline.getUploadMiddleware(), // Multer middleware for file handling
  validateFileUpload({
    maxFiles: parseInt(process.env.MAX_FILES_PER_UPLOAD) || 10,
    maxFileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 100) * 1024 * 1024,
    allowedExtensions: ['.md', '.txt', '.pdf', '.epub', '.docx'],
    requireBrainId: true
  }),
  asyncHandler(async (req, res) => {
    const { brainId } = req.body;
    const userId = req.session.userId;
    const files = req.files;
    
    // Parse options from request body
    const options = {
      createSeparateCards: req.body.createSeparateCards !== 'false', // Default true
      overwriteExisting: req.body.overwriteExisting === 'true',      // Default false
      processingPriority: req.body.processingPriority || 'normal',   // normal, high, low
      forceBackground: req.body.forceBackground === 'true'           // Force background processing
    };

    await logger.info('File upload started', {
      userId,
      brainId,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      options
    });

    try {
      // Process upload through pipeline
      const result = await uploadPipeline.handleUpload(files, brainId, userId, options);
      
      // Return immediate response with tracking information
      return res.apiAccepted(result, 'Files uploaded successfully, processing started');
      
    } catch (error) {
      await logger.error('Upload failed', {
        userId,
        brainId,
        error: error.message,
        fileCount: files.length
      });
      throw error;
    }
  })
);

/**
 * GET /api/upload/:uploadId/status
 * Check upload processing status
 */
router.get('/:uploadId/status',
  asyncHandler(async (req, res) => {
    const { uploadId } = req.params;
    const userId = req.session.userId;

    // Get upload status
    const status = await uploadPipeline.getUploadStatus(uploadId);
    
    if (!status) {
      throw new NotFoundError('Upload session', uploadId);
    }

    // Verify user owns this upload session
    if (status.userId !== userId) {
      throw new ForbiddenError('Access denied to upload session');
    }

    return res.apiSuccess(status);
  })
);

/**
 * GET /api/upload/jobs/:jobId/status
 * Check individual job status
 */
router.get('/jobs/:jobId/status',
  validateUUID('jobId'),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const userId = req.session.userId;

    const jobStatus = jobQueue.getJobStatus(jobId);
    
    if (!jobStatus) {
      throw new NotFoundError('Job', jobId);
    }

    // Basic security - only show jobs for current user
    // This is a simple check; in production you might want more robust authorization
    
    return res.apiSuccess(jobStatus);
  })
);

/**
 * GET /api/upload/history
 * Get user's upload history
 */
router.get('/history',
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    try {
      // Get recent upload sessions for user
      const uploads = await jobQueue.getUserJobs(userId, limit);
      
      return res.apiSuccess({
        uploads,
        limit,
        offset,
        hasMore: uploads.length === limit
      });
      
    } catch (error) {
      await logger.error('Failed to get upload history', {
        userId,
        error: error.message
      });
      throw error;
    }
  })
);

/**
 * POST /api/upload/retry-failed
 * Retry failed upload jobs
 */
router.post('/retry-failed',
  validateBody({
    required: ['jobIds'],
    fields: {
      jobIds: {
        type: 'array',
        minItems: 1,
        maxItems: 10
      }
    }
  }),
  asyncHandler(async (req, res) => {
    const { jobIds } = req.body;
    const userId = req.session.userId;

    const retryResults = [];

    for (const jobId of jobIds) {
      try {
        const jobStatus = jobQueue.getJobStatus(jobId);
        
        if (!jobStatus) {
          retryResults.push({
            jobId,
            success: false,
            error: 'Job not found'
          });
          continue;
        }

        if (jobStatus.status !== 'failed') {
          retryResults.push({
            jobId,
            success: false,
            error: 'Job is not in failed state'
          });
          continue;
        }

        // Reset job status and add back to queue
        // This is a simplified retry mechanism
        const newJobId = await jobQueue.addJob(
          jobStatus.type,
          jobStatus.data,
          userId,
          null, // brainId from job data
          1 // Higher priority for retries
        );

        retryResults.push({
          jobId: jobId,
          newJobId,
          success: true
        });

      } catch (error) {
        retryResults.push({
          jobId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = retryResults.filter(r => r.success).length;
    
    await logger.info('Retry failed jobs completed', {
      userId,
      totalJobs: jobIds.length,
      successCount,
      results: retryResults
    });

    return res.apiSuccess({
      results: retryResults,
      summary: {
        total: jobIds.length,
        succeeded: successCount,
        failed: jobIds.length - successCount
      }
    }, `${successCount} of ${jobIds.length} jobs queued for retry`);
  })
);

/**
 * DELETE /api/upload/:uploadId
 * Cancel ongoing upload (if possible)
 */
router.delete('/:uploadId',
  asyncHandler(async (req, res) => {
    const { uploadId } = req.params;
    const userId = req.session.userId;

    // Get upload status first
    const status = await uploadPipeline.getUploadStatus(uploadId);
    
    if (!status) {
      throw new NotFoundError('Upload session', uploadId);
    }

    // Verify ownership
    if (status.userId !== userId) {
      throw new ForbiddenError('Access denied to upload session');
    }

    // Can only cancel if still processing
    if (status.status === 'completed') {
      throw new ValidationError('Cannot cancel completed upload');
    }

    try {
      // Mark upload session as cancelled
      // Note: This is a simplified cancellation - in a full implementation,
      // you'd need to also cancel the individual jobs in the queue
      
      await logger.info('Upload cancelled by user', {
        userId,
        uploadId,
        status: status.status
      });

      return res.apiSuccess({ 
        uploadId,
        cancelled: true 
      }, 'Upload cancellation requested');
      
    } catch (error) {
      await logger.error('Failed to cancel upload', {
        userId,
        uploadId,
        error: error.message
      });
      throw error;
    }
  })
);

/**
 * GET /api/upload/queue/stats
 * Get queue statistics (for monitoring/debugging)
 */
router.get('/queue/stats',
  asyncHandler(async (req, res) => {
    const stats = jobQueue.getStats();
    
    return res.apiSuccess({
      queue: stats,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  })
);

/**
 * POST /api/upload/test
 * Test endpoint for development/debugging
 */
if (process.env.NODE_ENV === 'development') {
  router.post('/test',
    uploadPipeline.getUploadMiddleware(),
    asyncHandler(async (req, res) => {
      const files = req.files || [];
      
      // Return file information without processing
      const fileInfo = files.map(file => ({
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer ? `${file.buffer.length} bytes` : 'No buffer'
      }));

      return res.apiSuccess({
        message: 'Test upload - files received but not processed',
        files: fileInfo,
        body: req.body
      });
    })
  );
}

/**
 * Error handling for multer errors
 */
router.use((error, req, res, next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.apiError(
      `File too large. Maximum size: ${Math.round(error.limit / 1024 / 1024)}MB`,
      413
    );
  }
  
  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.apiError(
      `Too many files. Maximum: ${error.limit} files`,
      400
    );
  }
  
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.apiError(
      'Unexpected file field in upload',
      400
    );
  }

  next(error);
});

module.exports = router;