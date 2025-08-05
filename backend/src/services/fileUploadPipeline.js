/**
 * Unified File Upload Pipeline
 * Handles file uploads, validation, storage, and background processing
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('crypto');
const multer = require('multer');
const Brain = require('../models/Brain');
const User = require('../models/User');
const { logger } = require('../utils/logger');
const { jobQueue } = require('./simpleJobQueue');
const CardProcessor = require('./cardProcessor');
const { 
  FileTooLargeError, 
  UnsupportedFileTypeError, 
  StorageQuotaExceededError,
  ValidationError,
  NotFoundError,
  ProcessingError
} = require('../utils/apiError');
const { pool } = require('../models/database');

class FileUploadPipeline {
  constructor() {
    this.cardProcessor = new CardProcessor();
    this.maxFileSize = (process.env.MAX_FILE_SIZE_MB || 100) * 1024 * 1024; // Convert MB to bytes
    this.maxFilesPerUpload = parseInt(process.env.MAX_FILES_PER_UPLOAD) || 10;
    this.supportedMimeTypes = new Map([
      ['text/markdown', ['.md', '.markdown']],
      ['text/plain', ['.txt', '.text', '.log']],
      ['application/pdf', ['.pdf']],
      ['application/epub+zip', ['.epub']],
      ['application/x-mobipocket-ebook', ['.mobi']],
      ['text/html', ['.html', '.htm']],
      ['application/msword', ['.doc']],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']]
    ]);
    
    this.setupMulter();
  }

  /**
   * Setup multer for file upload handling
   */
  setupMulter() {
    // Create multer storage configuration
    const storage = multer.memoryStorage(); // Store in memory for processing

    this.upload = multer({
      storage: storage,
      limits: {
        fileSize: this.maxFileSize,
        files: this.maxFilesPerUpload,
        fieldSize: 1024 * 1024, // 1MB for form fields
        fieldNameSize: 100,
        fields: 10
      },
      fileFilter: (req, file, cb) => {
        try {
          this.validateFileType(file);
          cb(null, true);
        } catch (error) {
          cb(error, false);
        }
      }
    });
  }

  /**
   * Get multer middleware for handling uploads
   */
  getUploadMiddleware() {
    return this.upload.array('files', this.maxFilesPerUpload);
  }

  /**
   * Main upload handler
   */
  async handleUpload(files, brainId, userId, options = {}) {
    const uploadId = uuidv4();
    
    try {
      // Validate input
      await this.validateUploadRequest(files, brainId, userId, options);
      
      // Get brain and user info
      const brain = await Brain.findById(brainId);
      const user = await User.findById(userId);
      
      if (!brain || brain.userId !== userId) {
        throw new NotFoundError('Brain', brainId);
      }

      // Check storage quota
      await this.checkStorageQuota(user, files);

      // Process each file
      const fileResults = [];
      const jobIds = [];

      for (const file of files) {
        try {
          const fileResult = await this.processFile(file, brain, user, options, uploadId);
          fileResults.push(fileResult);
          
          if (fileResult.jobId) {
            jobIds.push(fileResult.jobId);
          }
        } catch (error) {
          await logger.error(`Failed to process file ${file.originalname}`, {
            error: error.message,
            fileName: file.originalname,
            uploadId,
            userId,
            brainId
          });

          fileResults.push({
            filename: file.originalname,
            status: 'failed',
            error: error.message
          });
        }
      }

      // Create upload session record
      await this.createUploadSession(uploadId, userId, brainId, fileResults.length);

      await logger.info(`Upload ${uploadId} completed`, {
        uploadId,
        userId,
        brainId,
        fileCount: files.length,
        successCount: fileResults.filter(f => f.status !== 'failed').length
      });

      return {
        uploadId,
        files: fileResults,
        jobIds: jobIds.filter(Boolean),
        summary: {
          total: files.length,
          queued: fileResults.filter(f => f.status === 'queued').length,
          failed: fileResults.filter(f => f.status === 'failed').length
        }
      };

    } catch (error) {
      await logger.error(`Upload failed`, {
        uploadId,
        userId,
        brainId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate upload request
   */
  async validateUploadRequest(files, brainId, userId, options) {
    if (!files || files.length === 0) {
      throw new ValidationError('No files provided');
    }

    if (files.length > this.maxFilesPerUpload) {
      throw new ValidationError(`Too many files. Maximum ${this.maxFilesPerUpload} files allowed per upload.`);
    }

    if (!brainId || !userId) {
      throw new ValidationError('Brain ID and User ID are required');
    }

    // Validate each file
    for (const file of files) {
      this.validateFile(file);
    }
  }

  /**
   * Validate individual file
   */
  validateFile(file) {
    if (!file.originalname || file.originalname.trim() === '') {
      throw new ValidationError('File must have a name');
    }

    if (file.size > this.maxFileSize) {
      throw new FileTooLargeError(this.formatBytes(this.maxFileSize), this.formatBytes(file.size));
    }

    this.validateFileType(file);
  }

  /**
   * Validate file type
   */
  validateFileType(file) {
    const ext = path.extname(file.originalname).toLowerCase();
    const processor = this.cardProcessor.getProcessor(file.originalname);
    
    if (!processor) {
      const supportedExts = this.cardProcessor.getSupportedExtensions();
      throw new UnsupportedFileTypeError(ext, supportedExts);
    }

    // Additional MIME type validation
    if (file.mimetype && !this.isMimeTypeSupported(file.mimetype, ext)) {
      await logger.warn('MIME type mismatch', {
        filename: file.originalname,
        expectedMime: file.mimetype,
        extension: ext
      });
    }
  }

  /**
   * Check if MIME type is supported
   */
  isMimeTypeSupported(mimeType, extension) {
    for (const [supportedMime, extensions] of this.supportedMimeTypes) {
      if (mimeType.startsWith(supportedMime.split('/')[0]) && extensions.includes(extension)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check storage quota
   */
  async checkStorageQuota(user, files) {
    const totalFileSize = files.reduce((sum, file) => sum + file.size, 0);
    
    if (user.storageUsed + totalFileSize > user.storageQuota) {
      throw new StorageQuotaExceededError(
        this.formatBytes(user.storageQuota),
        this.formatBytes(user.storageUsed + totalFileSize)
      );
    }
  }

  /**
   * Process individual file
   */
  async processFile(file, brain, user, options, uploadId) {
    const fileId = uuidv4();
    const fileName = this.sanitizeFileName(file.originalname);
    const brainPath = brain.folderPath;
    const filePath = path.join(brainPath, 'files', fileName);

    try {
      // Ensure brain files directory exists
      const filesDir = path.join(brainPath, 'files');
      await fs.ensureDir(filesDir);

      // Save file to disk
      await fs.writeFile(filePath, file.buffer);
      
      await logger.logFileOperation('upload', filePath, true);

      // Create file record in database
      await pool.query(`
        INSERT INTO files (id, brain_id, file_name, file_type, file_size, file_path, upload_method, uploaded_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        fileId,
        brain.id,
        fileName,
        path.extname(fileName).substring(1), // Remove dot from extension
        file.size,
        filePath,
        'web_upload',
        new Date()
      ]);

      // Determine processing approach
      const shouldProcessImmediately = file.size < 1024 * 1024; // Files under 1MB process immediately
      
      if (shouldProcessImmediately && !options.forceBackground) {
        // Process small files immediately
        try {
          const result = await this.processFileInBackground({
            fileId,
            fileName,
            filePath,
            fileSize: file.size
          }, brain.id, options);

          return {
            fileId,
            filename: fileName,
            status: 'completed',
            size: file.size,
            result: result
          };
        } catch (error) {
          // If immediate processing fails, queue it
          const jobId = await this.queueFileForProcessing({
            fileId,
            fileName,
            filePath,
            fileSize: file.size
          }, brain.id, user.id, options);

          return {
            fileId,
            filename: fileName,
            status: 'queued',
            size: file.size,
            jobId,
            estimatedProcessingTime: this.estimateProcessingTime(file.size, path.extname(fileName))
          };
        }
      } else {
        // Queue large files for background processing
        const jobId = await this.queueFileForProcessing({
          fileId,
          fileName,
          filePath,
          fileSize: file.size
        }, brain.id, user.id, options);

        return {
          fileId,
          filename: fileName,
          status: 'queued',
          size: file.size,
          jobId,
          estimatedProcessingTime: this.estimateProcessingTime(file.size, path.extname(fileName))
        };
      }

    } catch (error) {
      // Clean up file if processing failed
      try {
        await fs.remove(filePath);
      } catch (cleanupError) {
        await logger.error('Failed to cleanup failed upload file', {
          filePath,
          error: cleanupError.message
        });
      }

      throw new ProcessingError(`Failed to process file ${fileName}`, {
        fileName,
        originalError: error.message
      });
    }
  }

  /**
   * Queue file for background processing
   */
  async queueFileForProcessing(fileInfo, brainId, userId, options) {
    const jobId = await jobQueue.addJob(
      'FILE_PROCESSING',
      {
        fileInfo,
        brainId,
        options
      },
      userId,
      brainId,
      options.processingPriority === 'high' ? 10 : 0
    );

    return jobId;
  }

  /**
   * Process file in background (called by job queue)
   */
  async processFileInBackground(fileInfo, brainId, options = {}) {
    const { fileId, fileName, filePath, fileSize } = fileInfo;
    
    try {
      // Validate file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Process file using card processor
      const result = await this.cardProcessor.processFile(filePath, brainId, {
        createSeparateCards: options.createSeparateCards !== false,
        overwriteExisting: options.overwriteExisting === true,
        sourceFileId: fileId
      });

      // Update file record with processing result
      await pool.query(`
        UPDATE files 
        SET processing_status = 'completed', processed_at = $1
        WHERE id = $2
      `, [new Date(), fileId]);

      await logger.info(`File processing completed`, {
        fileId,
        fileName,
        cardsCreated: result.cardsCreated,
        processingTime: result.processingTime
      });

      return result;

    } catch (error) {
      // Update file record with error
      await pool.query(`
        UPDATE files 
        SET processing_status = 'failed', processing_error = $1
        WHERE id = $2
      `, [error.message, fileId]);

      await logger.error(`File processing failed`, {
        fileId,
        fileName,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Create upload session record
   */
  async createUploadSession(uploadId, userId, brainId, totalFiles) {
    try {
      await pool.query(`
        INSERT INTO upload_sessions 
        (id, user_id, brain_id, upload_id, total_files, completed_files, failed_files, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        uuidv4(),
        userId,
        brainId,
        uploadId,
        totalFiles,
        0,
        0,
        'processing',
        new Date()
      ]);
    } catch (error) {
      await logger.error('Failed to create upload session', {
        uploadId,
        error: error.message
      });
    }
  }

  /**
   * Get upload status
   */
  async getUploadStatus(uploadId) {
    try {
      const result = await pool.query(`
        SELECT * FROM upload_sessions WHERE upload_id = $1
      `, [uploadId]);

      if (result.rows.length === 0) {
        return null;
      }

      const session = result.rows[0];

      // Get job statuses for this upload
      const jobsResult = await pool.query(`
        SELECT id, job_type, status, error_message 
        FROM processing_jobs 
        WHERE input_data->>'uploadId' = $1
        ORDER BY created_at
      `, [uploadId]);

      return {
        uploadId,
        status: session.status,
        totalFiles: session.total_files,
        completedFiles: session.completed_files,
        failedFiles: session.failed_files,
        createdAt: session.created_at,
        completedAt: session.completed_at,
        jobs: jobsResult.rows
      };
    } catch (error) {
      await logger.error('Failed to get upload status', {
        uploadId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sanitize file name
   */
  sanitizeFileName(fileName) {
    // Remove path separators and dangerous characters
    let sanitized = fileName.replace(/[\/\\:*?"<>|]/g, '_');
    
    // Limit length
    if (sanitized.length > 255) {
      const ext = path.extname(sanitized);
      const name = path.basename(sanitized, ext);
      sanitized = name.substring(0, 255 - ext.length) + ext;
    }

    return sanitized;
  }

  /**
   * Estimate processing time based on file size and type
   */
  estimateProcessingTime(fileSize, extension) {
    const baseTime = {
      '.txt': 1,    // 1 second per MB
      '.md': 1,     // 1 second per MB
      '.pdf': 5,    // 5 seconds per MB
      '.epub': 3,   // 3 seconds per MB
      '.docx': 2    // 2 seconds per MB
    };

    const fileSizeMB = fileSize / (1024 * 1024);
    const timePerMB = baseTime[extension.toLowerCase()] || 2;
    const estimatedSeconds = Math.max(5, Math.ceil(fileSizeMB * timePerMB));

    if (estimatedSeconds < 60) {
      return `${estimatedSeconds} seconds`;
    } else {
      return `${Math.ceil(estimatedSeconds / 60)} minutes`;
    }
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clean up old upload sessions
   */
  async cleanupOldUploads(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await pool.query(`
        DELETE FROM upload_sessions 
        WHERE created_at < $1 AND status IN ('completed', 'failed')
      `, [cutoffDate]);

      await logger.info(`Cleaned up ${result.rowCount} old upload sessions`);
      return result.rowCount;
    } catch (error) {
      await logger.error('Failed to cleanup old uploads', { error: error.message });
      throw error;
    }
  }
}

module.exports = {
  FileUploadPipeline
};