const express = require('express');
const router = express.Router();
const Brain = require('../models/Brain');
const Card = require('../models/Card');
const { requireAuth } = require('../middleware/auth');
const { validateBrainName } = require('../utils/fileSystem');
const { recreateWelcomeStream } = require('../services/welcomeContent');

// All brain routes require authentication
router.use(requireAuth);

// Input validation helpers
const validateBrainInput = (name) => {
  const errors = {};
  
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.name = 'Brain name is required';
  } else if (!validateBrainName(name.trim())) {
    errors.name = 'Brain name contains invalid characters or format';
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

const validateUUID = (id) => {
  // Accept any valid UUID format, including nil UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

/**
 * GET /api/brains
 * Get all brains for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const brains = await Brain.findByUserId(req.session.userId);
    
    // Get additional metadata for each brain
    const brainsWithMetadata = await Promise.all(
      brains.map(async (brain) => {
        return await brain.toJSON();
      })
    );

    res.json({
      brains: brainsWithMetadata,
      count: brainsWithMetadata.length
    });

  } catch (error) {
    console.error('❌ Get brains error:', error);
    res.status(500).json({
      error: 'Failed to retrieve brains',
      message: 'An error occurred while fetching your brains'
    });
  }
});

/**
 * POST /api/brains
 * Create a new brain for the authenticated user
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    
    // Validate input
    const validation = validateBrainInput(name);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please check your input',
        fields: validation.errors
      });
    }

    // Create brain
    const brain = await Brain.create(req.session.userId, name.trim());
    const brainData = await brain.toJSON();

    res.status(201).json({
      brain: brainData,
      message: 'Brain created successfully'
    });

  } catch (error) {
    console.error('❌ Create brain error:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        error: 'Brain already exists',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to create brain',
      message: 'An error occurred while creating the brain'
    });
  }
});

/**
 * GET /api/brains/:id
 * Get a specific brain by ID (must belong to authenticated user)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this brain'
      });
    }

    const brainData = await brain.toJSON();

    res.json({
      brain: brainData
    });

  } catch (error) {
    console.error('❌ Get brain error:', error);
    res.status(500).json({
      error: 'Failed to retrieve brain',
      message: 'An error occurred while fetching the brain'
    });
  }
});

/**
 * GET /api/brains/:id/cards
 * Get all cards for a specific brain
 */
router.get('/:id/cards', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this brain'
      });
    }

    const cards = await brain.getCards();

    res.json({
      cards: cards,
      count: cards.length,
      brainId: brain.id,
      brainName: brain.name
    });

  } catch (error) {
    console.error('❌ Get brain cards error:', error);
    res.status(500).json({
      error: 'Failed to retrieve cards',
      message: 'An error occurred while fetching brain cards'
    });
  }
});

/**
 * GET /api/brains/:id/cards/check-title
 * Check if a card title exists in the brain
 */
router.get('/:id/cards/check-title', async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.query;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        error: 'Invalid title',
        message: 'Title parameter is required'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this brain'
      });
    }

    // Check if card with this title exists
    const existingCard = await Card.findByBrainAndTitle(id, title.trim());

    res.json({
      exists: !!existingCard,
      title: title.trim()
    });

  } catch (error) {
    console.error('❌ Check title error:', error);
    res.status(500).json({
      error: 'Failed to check title',
      message: 'An error occurred while checking card title'
    });
  }
});

/**
 * DELETE /api/brains/:id
 * Delete a brain (archives files, removes from database)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to delete this brain'
      });
    }

    // Store brain name for response
    const brainName = brain.name;
    
    // Delete brain (archives files and removes from database)
    await brain.delete();

    res.json({
      message: 'Brain deleted successfully',
      brainName: brainName,
      brainId: id
    });

  } catch (error) {
    console.error('❌ Delete brain error:', error);
    res.status(500).json({
      error: 'Failed to delete brain',
      message: 'An error occurred while deleting the brain'
    });
  }
});

/**
 * POST /api/brains/:id/sync
 * Force synchronization of brain files with database
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to sync this brain'
      });
    }

    // Force sync
    const cardCount = await brain.forceSync();

    res.json({
      message: 'Brain synchronized successfully',
      brainId: brain.id,
      brainName: brain.name,
      cardCount: cardCount,
      lastScannedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Sync brain error:', error);
    res.status(500).json({
      error: 'Failed to sync brain',
      message: 'An error occurred while synchronizing the brain'
    });
  }
});

/**
 * POST /api/brains/:id/welcome
 * Recreate welcome stream for existing brain (if user deleted it)
 */
router.post('/:id/welcome', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    if (!validateUUID(id)) {
      return res.status(400).json({
        error: 'Invalid brain ID',
        message: 'Brain ID must be a valid UUID'
      });
    }

    const brain = await Brain.findById(id);
    
    if (!brain) {
      return res.status(404).json({
        error: 'Brain not found',
        message: 'The requested brain does not exist'
      });
    }

    // Check ownership
    if (brain.userId !== req.session.userId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You do not have permission to access this brain'
      });
    }

    // Recreate welcome stream
    const result = await recreateWelcomeStream(brain.id);

    res.status(201).json({
      ...result,
      brainId: brain.id,
      brainName: brain.name
    });

  } catch (error) {
    console.error('❌ Recreate welcome stream error:', error);
    
    if (error.message.includes('already exists')) {
      return res.status(409).json({
        error: 'Welcome stream already exists',
        message: error.message
      });
    }
    
    res.status(500).json({
      error: 'Failed to recreate welcome stream',
      message: 'An error occurred while recreating the welcome stream'
    });
  }
});

module.exports = router;