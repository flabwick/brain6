const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');

const Card = require('../models/Card');
const Brain = require('../models/Brain');
const { requireAuth } = require('../middleware/auth');
const cardProcessor = require('../services/cardProcessor');
const linkParser = require('../services/linkParser');

// All card routes require authentication
router.use(requireAuth);

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/clarity-uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 10 // Maximum 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    const supportedExtensions = cardProcessor.getSupportedExtensions();
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (supportedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: ${ext}`), false);
    }
  }
});

// Input validation helpers
const validateUUID = (id) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

const validateCardInput = (title, content = '') => {
  const errors = {};
  
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.title = 'Card title is required';
  } else if (title.length > 200) {
    errors.title = 'Card title cannot exceed 200 characters';
  }
  
  if (content && typeof content !== 'string') {
    errors.content = 'Card content must be a string';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

const validateBrainOwnership = async (brainId, userId) => {
  const brain = await Brain.findById(brainId);
  if (!brain) {
    return { valid: false, error: 'Brain not found' };
  }
  
  if (brain.userId !== userId) {
    return { valid: false, error: 'Access denied' };
  }
  
  return { valid: true, brain };
};

const validateCardOwnership = async (cardId, userId) => {
  const card = await Card.findById(cardId);
  if (!card) {
    return { valid: false, error: 'Card not found' };
  }
  
  const brainValidation = await validateBrainOwnership(card.brainId, userId);
  if (!brainValidation.valid) {
    return brainValidation;
  }
  
  return { valid: true, card, brain: brainValidation.brain };
};

/**
 * GET /api/cards/:id
 * Get single card with content
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot access card: ${validation.error}`
      });
    }

    const cardData = await validation.card.toJSON(true); // Include content
    
    // Get forward and back links
    const [forwardLinks, backlinks] = await Promise.all([
      validation.card.getForwardLinks(),
      validation.card.getBacklinks()
    ]);

    res.json({
      card: {
        ...cardData,
        forwardLinks: forwardLinks.map(link => ({
          card: link.card.toJSON ? link.card.toJSON() : link.card,
          linkText: link.linkText,
          position: link.position
        })),
        backlinks: backlinks.map(link => ({
          card: link.card.toJSON ? link.card.toJSON() : link.card,
          linkText: link.linkText,
          position: link.position
        }))
      }
    });

  } catch (error) {
    console.error('❌ Get card error:', error);
    res.status(500).json({
      error: 'Failed to retrieve card',
      message: 'An error occurred while fetching the card'
    });
  }
});

/**
 * POST /api/cards
 * Create new card from content
 */
router.post('/', async (req, res) => {
  try {
    const { title, content = '', brainId } = req.body;
    
    // Validate input
    const validation = validateCardInput(title, content);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        fields: validation.errors
      });
    }

    if (!brainId || !validateUUID(brainId)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'A valid brain ID is required'
      });
    }

    // Validate brain ownership
    const brainValidation = await validateBrainOwnership(brainId, req.session.userId);
    if (!brainValidation.valid) {
      const status = brainValidation.error === 'Brain not found' ? 404 : 403;
      return res.status(status).json({
        error: brainValidation.error,
        message: `Cannot create card: ${brainValidation.error}`
      });
    }

    // Create card using card processor
    const result = await cardProcessor.createCardFromContent(brainId, title.trim(), content);
    
    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to create card',
        message: result.error
      });
    }

    // Process links in the content
    await linkParser.processCardLinks(result.card.id, content);

    const cardData = await result.card.toJSON(true);

    res.status(201).json({
      card: cardData,
      message: 'Card created successfully'
    });

  } catch (error) {
    console.error('❌ Create card error:', error);
    res.status(500).json({
      error: 'Failed to create card',
      message: 'An error occurred while creating the card'
    });
  }
});

/**
 * PUT /api/cards/:id
 * Update card content
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot update card: ${validation.error}`
      });
    }

    const card = validation.card;
    const updates = {};

    // Update title if provided
    if (title !== undefined) {
      if (!title || title.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid title',
          message: 'Card title cannot be empty'
        });
      }
      
      if (title.length > 200) {
        return res.status(400).json({
          error: 'Invalid title',
          message: 'Card title cannot exceed 200 characters'
        });
      }

      updates.title = title.trim();
    }

    // Update content if provided
    if (content !== undefined) {
      if (typeof content !== 'string') {
        return res.status(400).json({
          error: 'Invalid content',
          message: 'Card content must be a string'
        });
      }

      await card.updateContent(content);
      
      // Process links in the updated content
      await linkParser.processCardLinks(card.id, content);
    }

    // Update other fields if provided
    if (Object.keys(updates).length > 0) {
      await card.update(updates);
    }

    const cardData = await card.toJSON(true);

    res.json({
      card: cardData,
      message: 'Card updated successfully'
    });

  } catch (error) {
    console.error('❌ Update card error:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        error: 'Card title already exists',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to update card',
      message: 'An error occurred while updating the card'
    });
  }
});

/**
 * DELETE /api/cards/:id
 * Delete card (soft delete)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { hard = false } = req.query;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot delete card: ${validation.error}`
      });
    }

    const card = validation.card;
    const cardTitle = card.title;
    const cardId = card.id;

    if (hard === 'true') {
      await card.hardDelete();
    } else {
      await card.delete();
    }

    res.json({
      message: hard === 'true' ? 'Card permanently deleted' : 'Card deleted successfully',
      cardTitle,
      cardId,
      deletionType: hard === 'true' ? 'hard' : 'soft'
    });

  } catch (error) {
    console.error('❌ Delete card error:', error);
    res.status(500).json({
      error: 'Failed to delete card',
      message: 'An error occurred while deleting the card'
    });
  }
});

/**
 * POST /api/cards/upload
 * Upload files to create cards
 */
router.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const { brainId } = req.body;
    
    if (!brainId || !validateUUID(brainId)) {
      // Clean up uploaded files
      if (req.files) {
        for (const file of req.files) {
          await fs.remove(file.path).catch(() => {});
        }
      }
      
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'A valid brain ID is required'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded',
        message: 'At least one file must be uploaded'
      });
    }

    // Validate brain ownership
    const brainValidation = await validateBrainOwnership(brainId, req.session.userId);
    if (!brainValidation.valid) {
      // Clean up uploaded files
      for (const file of req.files) {
        await fs.remove(file.path).catch(() => {});
      }
      
      const status = brainValidation.error === 'Brain not found' ? 404 : 403;
      return res.status(status).json({
        error: brainValidation.error,
        message: `Cannot upload files: ${brainValidation.error}`
      });
    }

    const filePaths = req.files.map(file => {
      // Restore original filename
      const originalPath = path.join(path.dirname(file.path), file.originalname);
      fs.moveSync(file.path, originalPath);
      return originalPath;
    });

    // Process files
    const results = await cardProcessor.processFiles(filePaths, brainId, {
      copyFile: true,
      updateExisting: false
    });

    // Clean up temporary files
    for (const filePath of filePaths) {
      await fs.remove(filePath).catch(() => {});
    }

    // Process links for successfully created cards
    for (const result of results) {
      if (result.success && result.card) {
        const content = await result.card.getContent();
        await linkParser.processCardLinks(result.card.id, content);
      }
    }

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    res.status(201).json({
      message: `Processed ${results.length} files: ${successful.length} succeeded, ${failed.length} failed`,
      results: {
        successful: successful.map(r => ({
          fileName: path.basename(r.filePath),
          cardId: r.card.id,
          cardTitle: r.card.title,
          action: r.action
        })),
        failed: failed.map(r => ({
          fileName: path.basename(r.filePath),
          error: r.error
        }))
      },
      summary: {
        totalFiles: results.length,
        successful: successful.length,
        failed: failed.length
      }
    });

  } catch (error) {
    console.error('❌ Upload files error:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      for (const file of req.files) {
        await fs.remove(file.path).catch(() => {});
      }
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'File size exceeds the 100MB limit'
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        error: 'Too many files',
        message: 'Maximum 10 files per upload'
      });
    }

    res.status(500).json({
      error: 'Failed to upload files',
      message: 'An error occurred while processing uploaded files'
    });
  }
});

/**
 * POST /api/cards/:id/links
 * Update card links after content changes
 */
router.post('/:id/links', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot update links: ${validation.error}`
      });
    }

    const card = validation.card;
    const content = await card.getContent();
    
    // Process links
    const result = await linkParser.processCardLinks(card.id, content);

    res.json({
      message: 'Card links updated successfully',
      linkStats: {
        linksFound: result.linksFound,
        linksResolved: result.linksResolved,
        brokenLinks: result.brokenLinks
      },
      details: result.details
    });

  } catch (error) {
    console.error('❌ Update card links error:', error);
    res.status(500).json({
      error: 'Failed to update card links',
      message: 'An error occurred while updating card links'
    });
  }
});

/**
 * GET /api/cards/:id/links
 * Get card's forward and back links
 */
router.get('/:id/links', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot access card links: ${validation.error}`
      });
    }

    const [forwardLinks, backlinks] = await Promise.all([
      validation.card.getForwardLinks(),
      validation.card.getBacklinks()
    ]);

    res.json({
      cardId: id,
      forwardLinks: forwardLinks.map(link => ({
        card: {
          id: link.card.id,
          title: link.card.title,
          contentPreview: link.card.contentPreview,
          brainId: link.card.brainId
        },
        linkText: link.linkText,
        position: link.position
      })),
      backlinks: backlinks.map(link => ({
        card: {
          id: link.card.id,
          title: link.card.title,
          contentPreview: link.card.contentPreview,
          brainId: link.card.brainId
        },
        linkText: link.linkText,
        position: link.position
      })),
      summary: {
        forwardLinksCount: forwardLinks.length,
        backlinksCount: backlinks.length
      }
    });

  } catch (error) {
    console.error('❌ Get card links error:', error);
    res.status(500).json({
      error: 'Failed to retrieve card links',
      message: 'An error occurred while fetching card links'
    });
  }
});

/**
 * POST /api/cards/:id/sync
 * Sync card with its file system file
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid card ID',
        message: 'Card ID must be a valid UUID'
      });
    }

    const validation = await validateCardOwnership(id, req.session.userId);
    if (!validation.valid) {
      const status = validation.error === 'Card not found' ? 404 : 403;
      return res.status(status).json({
        error: validation.error,
        message: `Cannot sync card: ${validation.error}`
      });
    }

    const result = await cardProcessor.syncCard(id);

    if (!result.success) {
      return res.status(400).json({
        error: 'Sync failed',
        message: result.error
      });
    }

    // If card was updated, reprocess links
    if (result.action === 'updated') {
      const content = await validation.card.getContent();
      await linkParser.processCardLinks(id, content);
    }

    res.json({
      message: result.action === 'updated' ? 'Card synced successfully' : 'Card is already up to date',
      syncResult: result.action,
      cardId: id
    });

  } catch (error) {
    console.error('❌ Sync card error:', error);
    res.status(500).json({
      error: 'Failed to sync card',
      message: 'An error occurred while syncing the card'
    });
  }
});

module.exports = router;