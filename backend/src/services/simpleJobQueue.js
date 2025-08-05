/**
 * Simple in-memory job queue for background processing
 * Suitable for single-server deployments with moderate load
 */

const { v4: uuidv4 } = require('crypto');
const { logger } = require('../utils/logger');
const { pool } = require('../models/database');

class SimpleJobQueue {
  constructor() {
    this.jobs = new Map(); // Map of jobId -> job object
    this.pendingJobs = []; // Array of job IDs waiting to be processed
    this.isProcessing = false;
    this.processingJobId = null;
    this.maxRetries = 3;
    this.processingTimeout = 5 * 60 * 1000; // 5 minutes
    this.retryDelay = 30 * 1000; // 30 seconds
    
    // Initialize database table
    this.initializeDatabase();
  }

  async initializeDatabase() {
    try {
      // Create processing_jobs table if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS processing_jobs (
          id UUID PRIMARY KEY,
          user_id UUID REFERENCES users(id),
          brain_id UUID REFERENCES brains(id),
          job_type VARCHAR(50) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          input_data JSONB,
          output_data JSONB,
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP
        );
      `);

      // Create index for efficient status queries
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_processing_jobs_status 
        ON processing_jobs(status, created_at);
      `);

      await logger.info('Job queue database initialized');
    } catch (error) {
      await logger.error('Failed to initialize job queue database', { error: error.message });
      throw error;
    }
  }

  /**
   * Add a new job to the queue
   */
  async addJob(type, data, userId = null, brainId = null, priority = 0) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      data,
      userId,
      brainId,
      priority,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null
    };

    // Store job in memory
    this.jobs.set(jobId, job);
    
    // Add to pending queue (sorted by priority)
    this.insertJobByPriority(jobId, priority);

    // Save to database
    try {
      await pool.query(`
        INSERT INTO processing_jobs (
          id, user_id, brain_id, job_type, status, input_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [jobId, userId, brainId, type, 'pending', JSON.stringify(data), job.createdAt]);

      await logger.info(`Job ${jobId} (${type}) added to queue`, {
        jobId,
        jobType: type,
        userId,
        brainId,
        priority
      });
    } catch (error) {
      // Remove from memory if database save fails
      this.jobs.delete(jobId);
      this.pendingJobs = this.pendingJobs.filter(id => id !== jobId);
      throw error;
    }

    // Start processing if not already running
    this.startProcessing();

    return jobId;
  }

  /**
   * Insert job into pending queue based on priority
   */
  insertJobByPriority(jobId, priority) {
    const insertIndex = this.pendingJobs.findIndex(existingJobId => {
      const existingJob = this.jobs.get(existingJobId);
      return existingJob && existingJob.priority < priority;
    });

    if (insertIndex === -1) {
      this.pendingJobs.push(jobId);
    } else {
      this.pendingJobs.splice(insertIndex, 0, jobId);
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      retryCount: job.retryCount,
      progress: job.progress || null
    };
  }

  /**
   * Get all jobs for a user
   */
  async getUserJobs(userId, limit = 20) {
    try {
      const result = await pool.query(`
        SELECT id, job_type, status, created_at, started_at, completed_at, error_message
        FROM processing_jobs 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2
      `, [userId, limit]);

      return result.rows;
    } catch (error) {
      await logger.error('Failed to get user jobs', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Start processing jobs
   */
  startProcessing() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processNextJob();
  }

  /**
   * Stop processing jobs
   */
  stopProcessing() {
    this.isProcessing = false;
    if (this.processingJobId) {
      const job = this.jobs.get(this.processingJobId);
      if (job) {
        job.status = 'cancelled';
        this.updateJobInDatabase(this.processingJobId, 'cancelled', null, 'Processing stopped');
      }
    }
  }

  /**
   * Process the next job in the queue
   */
  async processNextJob() {
    if (!this.isProcessing || this.pendingJobs.length === 0) {
      this.isProcessing = false;
      return;
    }

    const jobId = this.pendingJobs.shift();
    const job = this.jobs.get(jobId);

    if (!job) {
      // Job not found, continue with next
      this.processNextJob();
      return;
    }

    this.processingJobId = jobId;
    job.status = 'processing';
    job.startedAt = new Date();

    await this.updateJobInDatabase(jobId, 'processing');
    await logger.logJob(jobId, job.type, 'started');

    // Set timeout for job processing
    const timeoutId = setTimeout(async () => {
      await this.handleJobTimeout(jobId);
    }, this.processingTimeout);

    try {
      // Process the job based on its type
      const result = await this.executeJob(job);
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // Mark job as completed
      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;

      await this.updateJobInDatabase(jobId, 'completed', result);
      await logger.logJob(jobId, job.type, 'completed', Date.now() - job.startedAt.getTime());

    } catch (error) {
      clearTimeout(timeoutId);
      await this.handleJobError(jobId, error);
    }

    this.processingJobId = null;
    
    // Process next job
    setTimeout(() => {
      this.processNextJob();
    }, 100); // Small delay to prevent tight loops
  }

  /**
   * Execute a job based on its type
   */
  async executeJob(job) {
    switch (job.type) {
      case 'FILE_PROCESSING':
        return await this.processFileJob(job);
      
      case 'LINK_RESOLUTION':
        return await this.processLinkResolutionJob(job);
      
      case 'STORAGE_CALCULATION':
        return await this.processStorageCalculationJob(job);
      
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * Process file upload job
   */
  async processFileJob(job) {
    const { fileInfo, brainId, options } = job.data;
    
    // Import the file upload pipeline (avoid circular dependency)
    const { FileUploadPipeline } = require('./fileUploadPipeline');
    const pipeline = new FileUploadPipeline();
    
    return await pipeline.processFileInBackground(fileInfo, brainId, options);
  }

  /**
   * Process link resolution job
   */
  async processLinkResolutionJob(job) {
    // Import link parser (avoid circular dependency)
    const linkParser = require('./linkParser');
    
    const { cardId } = job.data;
    return await linkParser.updateCardLinks(cardId);
  }

  /**
   * Process storage calculation job
   */
  async processStorageCalculationJob(job) {
    const { brainId } = job.data;
    
    // Calculate storage usage for brain
    const result = await pool.query(`
      SELECT SUM(LENGTH(content)) as total_size
      FROM card_versions cv
      JOIN cards c ON cv.card_id = c.id
      WHERE c.brain_id = $1 AND cv.is_active = true
    `, [brainId]);

    const totalSize = parseInt(result.rows[0].total_size) || 0;

    // Update brain storage usage
    await pool.query(`
      UPDATE brains SET storage_used = $1 WHERE id = $2
    `, [totalSize, brainId]);

    return { brainId, storageUsed: totalSize };
  }

  /**
   * Handle job timeout
   */
  async handleJobTimeout(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'processing') return;

    const error = new Error(`Job ${jobId} timed out after ${this.processingTimeout}ms`);
    await this.handleJobError(jobId, error);
  }

  /**
   * Handle job error and retry if appropriate
   */
  async handleJobError(jobId, error) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.retryCount++;
    job.error = error.message;

    await logger.logJob(jobId, job.type, 'failed', 
      Date.now() - job.startedAt.getTime(), error);

    // Retry if under max retries
    if (job.retryCount < this.maxRetries) {
      job.status = 'pending';
      
      // Add back to queue with delay
      setTimeout(() => {
        this.insertJobByPriority(jobId, job.priority);
      }, this.retryDelay);

      await this.updateJobInDatabase(jobId, 'pending', null, error.message);
      await logger.info(`Job ${jobId} scheduled for retry ${job.retryCount}/${this.maxRetries}`);
    } else {
      // Max retries exceeded
      job.status = 'failed';
      job.completedAt = new Date();
      
      await this.updateJobInDatabase(jobId, 'failed', null, error.message);
      await logger.error(`Job ${jobId} failed permanently after ${job.retryCount} retries`);
    }
  }

  /**
   * Update job status in database
   */
  async updateJobInDatabase(jobId, status, result = null, errorMessage = null) {
    try {
      const now = new Date();
      const updateFields = ['status = $2'];
      const values = [jobId, status];
      let paramIndex = 3;

      if (status === 'processing') {
        updateFields.push(`started_at = $${paramIndex++}`);
        values.push(now);
      }

      if (status === 'completed' || status === 'failed') {
        updateFields.push(`completed_at = $${paramIndex++}`);
        values.push(now);
      }

      if (result) {
        updateFields.push(`output_data = $${paramIndex++}`);
        values.push(JSON.stringify(result));
      }

      if (errorMessage) {
        updateFields.push(`error_message = $${paramIndex++}`);
        values.push(errorMessage);
      }

      const job = this.jobs.get(jobId);
      if (job) {
        updateFields.push(`retry_count = $${paramIndex++}`);
        values.push(job.retryCount);
      }

      await pool.query(`
        UPDATE processing_jobs 
        SET ${updateFields.join(', ')}
        WHERE id = $1
      `, values);

    } catch (error) {
      await logger.error('Failed to update job in database', { 
        jobId, 
        status, 
        error: error.message 
      });
    }
  }

  /**
   * Clean up completed jobs older than specified days
   */
  async cleanupOldJobs(daysOld = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Remove from database
      const result = await pool.query(`
        DELETE FROM processing_jobs 
        WHERE status IN ('completed', 'failed') 
        AND completed_at < $1
      `, [cutoffDate]);

      // Remove from memory
      for (const [jobId, job] of this.jobs.entries()) {
        if ((job.status === 'completed' || job.status === 'failed') &&
            job.completedAt && job.completedAt < cutoffDate) {
          this.jobs.delete(jobId);
        }
      }

      await logger.info(`Cleaned up ${result.rowCount} old jobs`);
      return result.rowCount;
    } catch (error) {
      await logger.error('Failed to cleanup old jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const statusCounts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const job of this.jobs.values()) {
      statusCounts[job.status]++;
    }

    return {
      totalJobs: this.jobs.size,
      pendingJobs: this.pendingJobs.length,
      isProcessing: this.isProcessing,
      processingJobId: this.processingJobId,
      statusCounts
    };
  }
}

// Create singleton instance
const jobQueue = new SimpleJobQueue();

module.exports = {
  jobQueue,
  SimpleJobQueue
};