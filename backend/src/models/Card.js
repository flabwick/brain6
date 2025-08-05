const { query, transaction } = require('./database');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

/**
 * Card Model
 * Handles card-related database operations and file system integration
 */

class Card {
  constructor(data) {
    this.id = data.id;
    this.brainId = data.brain_id;
    this.title = data.title;
    this.filePath = data.file_path;
    this.fileHash = data.file_hash;
    this.contentPreview = data.content_preview;
    this.fileSize = data.file_size;
    this.isActive = data.is_active;
    this.lastModified = data.last_modified;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  /**
   * Create a new card with optional file system integration
   * @param {string} brainId - Brain ID that owns the card
   * @param {string} title - Card title (must be unique within brain)
   * @param {Object} options - Card creation options
   * @param {string} options.content - Card content (markdown)
   * @param {string} options.filePath - Path to source file (optional)
   * @param {string} options.fileHash - File hash for sync (optional)
   * @param {number} options.fileSize - File size in bytes (optional)
   * @returns {Promise<Card>} - Created card instance
   */
  static async create(brainId, title, options = {}) {
    const {
      content = '',
      filePath = null,
      fileHash = null,
      fileSize = 0
    } = options;

    if (!title || title.trim().length === 0) {
      throw new Error('Card title is required');
    }

    if (title.length > 200) {
      throw new Error('Card title cannot exceed 200 characters');
    }

    return await transaction(async (client) => {
      // Verify brain exists and get brain info
      const brainResult = await client.query(
        'SELECT id, folder_path, user_id FROM brains WHERE id = $1',
        [brainId]
      );

      if (brainResult.rows.length === 0) {
        throw new Error('Brain not found');
      }

      const brain = brainResult.rows[0];

      // Check if card title already exists in this brain
      const existingCard = await client.query(
        'SELECT id FROM cards WHERE brain_id = $1 AND title = $2 AND is_active = true',
        [brainId, title.trim()]
      );

      if (existingCard.rows.length > 0) {
        throw new Error(`Card '${title}' already exists in this brain`);
      }

      // Generate content preview (first 500 characters)
      const contentPreview = content.substring(0, 500);

      // Calculate file hash if content provided
      let calculatedHash = fileHash;
      if (content && !fileHash) {
        calculatedHash = crypto.createHash('sha256').update(content).digest('hex');
      }

      // Insert card into database
      const result = await client.query(`
        INSERT INTO cards (brain_id, title, file_path, file_hash, content_preview, file_size, is_active, last_modified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        RETURNING *
      `, [brainId, title.trim(), filePath, calculatedHash, contentPreview, fileSize, true]);

      const card = new Card(result.rows[0]);

      // If content provided and no file path, save as markdown file
      if (content && !filePath) {
        const sanitizedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
        const fileName = `${sanitizedTitle}.md`;
        const cardFilePath = path.join(brain.folder_path, 'cards', fileName);
        
        await fs.ensureDir(path.dirname(cardFilePath));
        await fs.writeFile(cardFilePath, content, 'utf8');
        
        // Update card with file path
        await client.query(
          'UPDATE cards SET file_path = $1 WHERE id = $2',
          [cardFilePath, card.id]
        );
        card.filePath = cardFilePath;
      }

      // Update brain storage usage
      await client.query(
        'UPDATE brains SET storage_used = storage_used + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [fileSize, brainId]
      );

      console.log(`✅ Created card: ${title} in brain ${brainId}`);
      return card;
    });
  }

  /**
   * Find card by ID
   * @param {string} cardId - Card ID to find
   * @returns {Promise<Card|null>} - Card instance or null
   */
  static async findById(cardId) {
    const result = await query(
      'SELECT * FROM cards WHERE id = $1',
      [cardId]
    );

    return result.rows.length > 0 ? new Card(result.rows[0]) : null;
  }

  /**
   * Find card by brain and title
   * @param {string} brainId - Brain ID
   * @param {string} title - Card title
   * @param {boolean} activeOnly - Only return active cards (default: true)
   * @returns {Promise<Card|null>} - Card instance or null
   */
  static async findByBrainAndTitle(brainId, title, activeOnly = true) {
    const whereClause = activeOnly ? 'AND is_active = true' : '';
    
    const result = await query(`
      SELECT * FROM cards 
      WHERE brain_id = $1 AND title = $2 ${whereClause}
    `, [brainId, title]);

    return result.rows.length > 0 ? new Card(result.rows[0]) : null;
  }

  /**
   * Find card by file path
   * @param {string} filePath - File path to find
   * @returns {Promise<Card|null>} - Card instance or null
   */
  static async findByFilePath(filePath) {
    const result = await query(
      'SELECT * FROM cards WHERE file_path = $1 AND is_active = true',
      [filePath]
    );

    return result.rows.length > 0 ? new Card(result.rows[0]) : null;
  }

  /**
   * Get all cards in a brain
   * @param {string} brainId - Brain ID
   * @param {Object} options - Query options
   * @param {boolean} options.activeOnly - Only return active cards (default: true)
   * @param {number} options.limit - Limit number of results
   * @param {number} options.offset - Offset for pagination
   * @param {string} options.orderBy - Order by field (default: 'title')
   * @returns {Promise<Array<Card>>} - Array of card instances
   */
  static async findByBrainId(brainId, options = {}) {
    const {
      activeOnly = true,
      limit = null,
      offset = 0,
      orderBy = 'title'
    } = options;

    const whereClause = activeOnly ? 'AND is_active = true' : '';
    const limitClause = limit ? `LIMIT ${limit} OFFSET ${offset}` : '';
    
    const result = await query(`
      SELECT * FROM cards 
      WHERE brain_id = $1 ${whereClause}
      ORDER BY ${orderBy}
      ${limitClause}
    `, [brainId]);

    return result.rows.map(row => new Card(row));
  }

  /**
   * Search cards by title or content preview
   * @param {string} brainId - Brain ID to search within
   * @param {string} searchTerm - Search term
   * @param {Object} options - Search options
   * @returns {Promise<Array<Card>>} - Array of matching cards
   */
  static async search(brainId, searchTerm, options = {}) {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    const { activeOnly = true, limit = 50 } = options;
    const whereClause = activeOnly ? 'AND is_active = true' : '';
    
    const result = await query(`
      SELECT * FROM cards 
      WHERE brain_id = $1 ${whereClause}
      AND (
        title ILIKE $2 
        OR content_preview ILIKE $2
      )
      ORDER BY 
        CASE WHEN title ILIKE $2 THEN 1 ELSE 2 END,
        title
      LIMIT $3
    `, [brainId, `%${searchTerm.trim()}%`, limit]);

    return result.rows.map(row => new Card(row));
  }

  /**
   * Get full content of card from file system
   * @returns {Promise<string>} - Card content
   */
  async getContent() {
    if (!this.filePath) {
      return this.contentPreview || '';
    }

    try {
      if (await fs.pathExists(this.filePath)) {
        return await fs.readFile(this.filePath, 'utf8');
      } else {
        console.warn(`⚠️  Card file not found: ${this.filePath}`);
        return this.contentPreview || '';
      }
    } catch (error) {
      console.error(`❌ Error reading card file ${this.filePath}:`, error.message);
      return this.contentPreview || '';
    }
  }

  /**
   * Update card content and optionally save to file system
   * @param {string} content - New card content
   * @param {Object} options - Update options
   * @param {boolean} options.updateFile - Update file system file (default: true)
   * @returns {Promise<void>}
   */
  async updateContent(content, options = {}) {
    const { updateFile = true } = options;

    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }

    const contentPreview = content.substring(0, 500);
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    const fileSize = Buffer.byteLength(content, 'utf8');

    await transaction(async (client) => {
      // Get current file size for storage calculation
      const currentCard = await client.query(
        'SELECT file_size FROM cards WHERE id = $1',
        [this.id]
      );

      if (currentCard.rows.length === 0) {
        throw new Error('Card not found');
      }

      const oldFileSize = currentCard.rows[0].file_size || 0;
      const sizeDifference = fileSize - oldFileSize;

      // Update card in database
      await client.query(`
        UPDATE cards 
        SET content_preview = $1, file_hash = $2, file_size = $3, 
            last_modified = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [contentPreview, fileHash, fileSize, this.id]);

      // Update brain storage usage
      if (sizeDifference !== 0) {
        await client.query(
          'UPDATE brains SET storage_used = storage_used + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [sizeDifference, this.brainId]
        );
      }

      // Update file system if requested and file path exists
      if (updateFile && this.filePath) {
        try {
          await fs.ensureDir(path.dirname(this.filePath));
          await fs.writeFile(this.filePath, content, 'utf8');
        } catch (error) {
          console.error(`❌ Error writing card file ${this.filePath}:`, error.message);
          throw new Error('Failed to update card file');
        }
      }

      // Update instance properties
      this.contentPreview = contentPreview;
      this.fileHash = fileHash;
      this.fileSize = fileSize;
      this.lastModified = new Date();
      this.updatedAt = new Date();
    });

    console.log(`✅ Updated card: ${this.title}`);
  }

  /**
   * Update card metadata (title, file path, etc.)
   * @param {Object} updates - Fields to update
   * @returns {Promise<void>}
   */
  async update(updates) {
    const allowedFields = ['title', 'file_path', 'file_hash', 'content_preview', 'file_size'];
    const validUpdates = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        validUpdates[key] = value;
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    // Check title uniqueness if title is being updated
    if (validUpdates.title && validUpdates.title !== this.title) {
      const existing = await Card.findByBrainAndTitle(this.brainId, validUpdates.title);
      if (existing && existing.id !== this.id) {
        throw new Error(`Card '${validUpdates.title}' already exists in this brain`);
      }
    }

    const setClause = Object.keys(validUpdates).map((key, index) => `${key} = $${index + 2}`).join(', ');
    const values = [this.id, ...Object.values(validUpdates)];

    await query(`
      UPDATE cards 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, values);

    // Update instance properties
    Object.assign(this, validUpdates);
    this.updatedAt = new Date();

    console.log(`✅ Updated card metadata: ${this.title}`);
  }

  /**
   * Soft delete card (mark as inactive)
   * @param {Object} options - Delete options
   * @param {boolean} options.deleteFile - Delete file from file system (default: false)
   * @returns {Promise<void>}
   */
  async delete(options = {}) {
    const { deleteFile = false } = options;

    await transaction(async (client) => {
      // Mark card as inactive
      await client.query(
        'UPDATE cards SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [this.id]
      );

      // Delete all links involving this card
      await client.query(
        'DELETE FROM card_links WHERE source_card_id = $1 OR target_card_id = $1',
        [this.id]
      );

      // Update brain storage usage
      await client.query(
        'UPDATE brains SET storage_used = storage_used - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [this.fileSize, this.brainId]
      );

      // Optionally delete file from file system
      if (deleteFile && this.filePath) {
        try {
          if (await fs.pathExists(this.filePath)) {
            await fs.remove(this.filePath);
            console.log(`✅ Deleted card file: ${this.filePath}`);
          }
        } catch (error) {
          console.error(`❌ Error deleting card file ${this.filePath}:`, error.message);
        }
      }

      this.isActive = false;
      this.updatedAt = new Date();
    });

    console.log(`✅ Deleted card: ${this.title}`);
  }

  /**
   * Hard delete card (permanently remove from database)
   * @returns {Promise<void>}
   */
  async hardDelete() {
    await transaction(async (client) => {
      // Delete all links involving this card
      await client.query(
        'DELETE FROM card_links WHERE source_card_id = $1 OR target_card_id = $1',
        [this.id]
      );

      // Delete card from database
      await client.query('DELETE FROM cards WHERE id = $1', [this.id]);

      // Update brain storage usage
      await client.query(
        'UPDATE brains SET storage_used = storage_used - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [this.fileSize, this.brainId]
      );

      // Delete file from file system if it exists
      if (this.filePath) {
        try {
          if (await fs.pathExists(this.filePath)) {
            await fs.remove(this.filePath);
            console.log(`✅ Deleted card file: ${this.filePath}`);
          }
        } catch (error) {
          console.error(`❌ Error deleting card file ${this.filePath}:`, error.message);
        }
      }
    });

    console.log(`✅ Hard deleted card: ${this.title}`);
  }

  /**
   * Get cards that link to this card (backlinks)
   * @returns {Promise<Array<Object>>} - Array of cards with link info
   */
  async getBacklinks() {
    const result = await query(`
      SELECT c.*, cl.link_text, cl.position_in_source
      FROM cards c
      JOIN card_links cl ON c.id = cl.source_card_id
      WHERE cl.target_card_id = $1 AND cl.is_valid = true AND c.is_active = true
      ORDER BY c.title
    `, [this.id]);

    return result.rows.map(row => ({
      card: new Card(row),
      linkText: row.link_text,
      position: row.position_in_source
    }));
  }

  /**
   * Get cards that this card links to (forward links)
   * @returns {Promise<Array<Object>>} - Array of cards with link info
   */
  async getForwardLinks() {
    const result = await query(`
      SELECT c.*, cl.link_text, cl.position_in_source
      FROM cards c
      JOIN card_links cl ON c.id = cl.target_card_id
      WHERE cl.source_card_id = $1 AND cl.is_valid = true AND c.is_active = true
      ORDER BY cl.position_in_source
    `, [this.id]);

    return result.rows.map(row => ({
      card: new Card(row),
      linkText: row.link_text,
      position: row.position_in_source
    }));
  }

  /**
   * Check if file system file has been modified since last sync
   * @returns {Promise<boolean>} - True if file has been modified
   */
  async hasFileChanged() {
    if (!this.filePath || !this.fileHash) {
      return false;
    }

    try {
      if (!(await fs.pathExists(this.filePath))) {
        return true; // File was deleted
      }

      const content = await fs.readFile(this.filePath, 'utf8');
      const currentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      return currentHash !== this.fileHash;
    } catch (error) {
      console.error(`❌ Error checking file changes for ${this.filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Sync card with file system (update from file)
   * @returns {Promise<boolean>} - True if card was updated
   */
  async syncWithFile() {
    if (!this.filePath) {
      return false;
    }

    try {
      if (!(await fs.pathExists(this.filePath))) {
        // File was deleted, mark card as inactive
        await this.delete();
        return true;
      }

      const content = await fs.readFile(this.filePath, 'utf8');
      const currentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      if (currentHash !== this.fileHash) {
        await this.updateContent(content, { updateFile: false });
        console.log(`✅ Synced card with file: ${this.title}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Error syncing card with file ${this.filePath}:`, error.message);
      return false;
    }
  }

  /**
   * Get card info for API responses
   * @param {boolean} includeContent - Include full content (default: false)
   * @returns {Promise<Object>} - Card data
   */
  async toJSON(includeContent = false) {
    const data = {
      id: this.id,
      brainId: this.brainId,
      title: this.title,
      contentPreview: this.contentPreview,
      fileSize: this.fileSize,
      hasFile: !!this.filePath,
      filePath: this.filePath,
      lastModified: this.lastModified,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };

    if (includeContent) {
      data.content = await this.getContent();
    }

    return data;
  }

  /**
   * Count total cards in a brain
   * @param {string} brainId - Brain ID
   * @param {boolean} activeOnly - Count only active cards (default: true)
   * @returns {Promise<number>} - Card count
   */
  static async countByBrainId(brainId, activeOnly = true) {
    const whereClause = activeOnly ? 'AND is_active = true' : '';
    
    const result = await query(`
      SELECT COUNT(*) as count 
      FROM cards 
      WHERE brain_id = $1 ${whereClause}
    `, [brainId]);

    return parseInt(result.rows[0].count);
  }
}

module.exports = Card;