const Card = require('../models/Card');
const { query, transaction } = require('../models/database');

/**
 * CardFactory - Centralized card creation with type-specific logic
 * Provides standardized methods for creating different types of cards
 */
class CardFactory {
  /**
   * Create a saved card (permanent, brain-wide)
   * @param {string} brainId - Brain ID
   * @param {string} title - Card title
   * @param {string} content - Card content (markdown)
   * @param {Object} options - Additional options
   * @returns {Promise<Card>} - Created saved card
   */
  static async createSavedCard(brainId, title, content, options = {}) {
    if (!title || title.trim().length === 0) {
      throw new Error('Title is required for saved cards');
    }

    if (!content) {
      throw new Error('Content is required for saved cards');
    }

    const card = await Card.create(brainId, title, {
      content,
      cardType: 'saved',
      ...options
    });

    console.log(`✅ Created saved card: ${title}`);
    return card;
  }

  /**
   * Create an unsaved card (temporary, stream-specific)
   * @param {string} brainId - Brain ID
   * @param {string} streamId - Stream ID where card belongs
   * @param {string} content - Card content (can be empty string)
   * @param {Object} options - Additional options
   * @returns {Promise<Card>} - Created unsaved card
   */
  static async createUnsavedCard(brainId, streamId, content = '', options = {}) {
    if (!streamId) {
      throw new Error('Stream ID is required for unsaved cards');
    }

    // Allow empty content for immediate card creation
    const card = await Card.create(brainId, null, {
      content: content || '',
      cardType: 'unsaved',
      streamId,
      ...options
    });

    // Add card to stream automatically
    await this.addCardToStream(streamId, card.id, options.position);

    console.log(`✅ Created unsaved card in stream ${streamId}`);
    return card;
  }

  /**
   * Create empty unsaved card for immediate editing
   * @param {string} brainId - Brain ID
   * @param {string} streamId - Stream ID where card belongs
   * @param {number} position - Position in stream or insertAfterPosition
   * @param {boolean} isInsertAfter - If true, insert after the given position
   * @returns {Promise<Card>} - Created empty unsaved card
   */
  static async createEmptyUnsavedCard(brainId, streamId, position = null, isInsertAfter = false) {
    if (!streamId) {
      throw new Error('Stream ID is required for unsaved cards');
    }

    const card = await Card.create(brainId, null, {
      content: '',
      cardType: 'unsaved',
      streamId
    });

    // Add card to stream at the right position
    if (isInsertAfter && position !== null) {
      // Insert after the specified position (for generate card functionality)
      await this.addCardToStreamSafely(streamId, card.id, position + 1);
      console.log(`✅ Created empty unsaved card in stream ${streamId} after position ${position}`);
    } else {
      // Insert at exact position or end if null
      await this.addCardToStreamSafely(streamId, card.id, position);
      console.log(`✅ Created empty unsaved card in stream ${streamId} at position ${position || 'end'}`);
    }
    
    return card;
  }

  /**
   * Create a file card (document reference)
   * @param {string} brainId - Brain ID
   * @param {string} fileId - File ID reference
   * @param {string} fileName - Display name for the file
   * @param {Object} options - Additional options
   * @returns {Promise<Card>} - Created file card
   */
  static async createFileCard(brainId, fileId, fileName, options = {}) {
    if (!fileId) {
      throw new Error('File ID is required for file cards');
    }

    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name is required for file cards');
    }

    // Generate preview content from file if available
    let contentPreview = options.contentPreview || '';
    if (options.content) {
      contentPreview = options.content.substring(0, 500);
    }

    const card = await Card.create(brainId, fileName, {
      cardType: 'file',
      fileId,
      content: contentPreview,
      ...options
    });

    console.log(`✅ Created file card: ${fileName}`);
    return card;
  }

  /**
   * Convert unsaved card to saved card
   * @param {string} cardId - Card ID to convert
   * @param {string} title - New title for saved card
   * @returns {Promise<Card>} - Converted card
   */
  static async convertUnsavedToSaved(cardId, title) {
    const card = await Card.findById(cardId);
    
    if (!card) {
      throw new Error('Card not found');
    }

    if (card.cardType !== 'unsaved') {
      throw new Error('Only unsaved cards can be converted to saved');
    }

    await card.convertToSaved(title);
    
    console.log(`✅ Converted unsaved card to saved: ${title}`);
    return card;
  }

  /**
   * Create card from AI generation (starts as unsaved)
   * @param {string} brainId - Brain ID
   * @param {string} streamId - Stream ID
   * @param {string} generatedContent - AI-generated content
   * @param {Object} options - Additional options
   * @returns {Promise<Card>} - Created unsaved card
   */
  static async createFromAIGeneration(brainId, streamId, generatedContent, options = {}) {
    if (!generatedContent || generatedContent.trim().length === 0) {
      throw new Error('Generated content cannot be empty');
    }

    // AI-generated content always starts as unsaved
    const card = await this.createUnsavedCard(brainId, streamId, generatedContent, {
      ...options,
      source: 'ai_generation'
    });

    console.log(`✅ Created AI-generated unsaved card in stream ${streamId}`);
    return card;
  }

  /**
   * Create multiple cards from content splitting
   * @param {string} brainId - Brain ID
   * @param {Array} contentChunks - Array of content chunks
   * @param {Object} options - Creation options
   * @returns {Promise<Array<Card>>} - Created cards
   */
  static async createFromContentSplit(brainId, contentChunks, options = {}) {
    const { cardType = 'saved', streamId = null, titlePrefix = 'Part' } = options;
    
    if (!contentChunks || contentChunks.length === 0) {
      throw new Error('Content chunks are required');
    }

    const cards = [];
    
    for (let i = 0; i < contentChunks.length; i++) {
      const chunk = contentChunks[i];
      const title = chunk.title || `${titlePrefix} ${i + 1}`;
      
      let card;
      
      switch (cardType) {
        case 'saved':
          card = await this.createSavedCard(brainId, title, chunk.content, options);
          break;
          
        case 'unsaved':
          if (!streamId) {
            throw new Error('Stream ID required for unsaved cards');
          }
          card = await this.createUnsavedCard(brainId, streamId, chunk.content, {
            ...options,
            position: i
          });
          break;
          
        default:
          throw new Error(`Unsupported card type for content splitting: ${cardType}`);
      }
      
      cards.push(card);
    }

    console.log(`✅ Created ${cards.length} cards from content splitting`);
    return cards;
  }

  /**
   * Add card to stream with position (safer version)
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @param {number} position - Position in stream (optional)
   * @returns {Promise<void>}
   */
  static async addCardToStreamSafely(streamId, cardId, position = null) {
    return await transaction(async (client) => {
      // Check if card is already in stream
      const existing = await client.query(
        'SELECT id FROM stream_cards WHERE stream_id = $1 AND card_id = $2',
        [streamId, cardId]
      );

      if (existing.rows.length > 0) {
        return; // Card already in stream
      }

      // If position is null, append to end
      if (position === null) {
        const result = await client.query(
          'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM stream_cards WHERE stream_id = $1',
          [streamId]
        );
        position = result.rows[0].next_position;
      } else {
        // Renumber all positions to ensure gaps and avoid conflicts
        const allCards = await client.query(
          'SELECT id, position FROM stream_cards WHERE stream_id = $1 ORDER BY position',
          [streamId]
        );

        // Create a temporary table approach
        await client.query('BEGIN');
        
        // Temporarily set all positions to negative values to avoid conflicts
        await client.query(
          'UPDATE stream_cards SET position = -position - 1000 WHERE stream_id = $1',
          [streamId]
        );

        // Now renumber from the desired insertion point
        let newPos = 0;
        for (const card of allCards.rows) {
          if (newPos === position) {
            newPos++; // Leave space for our new card
          }
          await client.query(
            'UPDATE stream_cards SET position = $1 WHERE stream_id = $2 AND id = $3',
            [newPos, streamId, card.id]
          );
          newPos++;
        }
      }
      
      // Insert the new card
      await client.query(`
        INSERT INTO stream_cards (stream_id, card_id, position, is_in_ai_context, is_collapsed)
        VALUES ($1, $2, $3, false, false)
      `, [streamId, cardId, position]);
      
      console.log(`✅ Added card ${cardId} to stream ${streamId} at position ${position}`);
    });
  }

  /**
   * Add card to stream with position (original method for backward compatibility)
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @param {number} position - Position in stream (optional)
   * @returns {Promise<void>}
   */
  static async addCardToStream(streamId, cardId, position = null) {
    return await transaction(async (client) => {
      // Get next position if not specified
      if (position === null) {
        const result = await client.query(
          'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM stream_cards WHERE stream_id = $1',
          [streamId]
        );
        position = result.rows[0].next_position;
      }

      // Check if card is already in stream (with lock to prevent race conditions)
      const existing = await client.query(
        'SELECT id FROM stream_cards WHERE stream_id = $1 AND card_id = $2 FOR UPDATE',
        [streamId, cardId]
      );

      if (existing.rows.length > 0) {
        return; // Card already in stream
      }

      // Lock the entire stream to prevent concurrent modifications
      await client.query(
        'SELECT stream_id FROM stream_cards WHERE stream_id = $1 LIMIT 1 FOR UPDATE',
        [streamId]
      );
      
      // Use a more robust approach: find a safe position and insert
      if (position !== null) {
        // Check if the requested position exists
        const existingAtPosition = await client.query(
          'SELECT card_id FROM stream_cards WHERE stream_id = $1 AND position = $2',
          [streamId, position]
        );
        
        if (existingAtPosition.rows.length > 0) {
          // Position is occupied, shift everything from that position up
          await client.query(`
            UPDATE stream_cards 
            SET position = position + 1 
            WHERE stream_id = $1 AND position >= $2
          `, [streamId, position]);
        }
      } else {
        // If position is null, append to end
        const maxPositionResult = await client.query(
          'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM stream_cards WHERE stream_id = $1',
          [streamId]
        );
        position = maxPositionResult.rows[0].next_position;
      }
      
      // Insert the new card
      await client.query(`
        INSERT INTO stream_cards (stream_id, card_id, position, is_in_ai_context, is_collapsed)
        VALUES ($1, $2, $3, false, false)
      `, [streamId, cardId, position]);
      
      console.log(`✅ Added card ${cardId} to stream ${streamId} at position ${position}`);
    });
  }

  /**
   * Get brain ID from stream
   * @param {string} streamId - Stream ID
   * @returns {Promise<string>} - Brain ID
   */
  static async getBrainIdFromStream(streamId) {
    const result = await query(
      'SELECT brain_id FROM streams WHERE id = $1',
      [streamId]
    );

    if (result.rows.length === 0) {
      throw new Error('Stream not found');
    }

    return result.rows[0].brain_id;
  }

  /**
   * Validate card type and parameters
   * @param {string} cardType - Card type to validate
   * @param {Object} params - Parameters to validate
   * @returns {boolean} - True if valid
   */
  static validateCardType(cardType, params = {}) {
    const validTypes = ['saved', 'file', 'unsaved'];
    
    if (!validTypes.includes(cardType)) {
      throw new Error(`Invalid card type: ${cardType}. Must be one of: ${validTypes.join(', ')}`);
    }

    switch (cardType) {
      case 'saved':
        if (!params.title || params.title.trim().length === 0) {
          throw new Error('Title is required for saved cards');
        }
        break;
        
      case 'unsaved':
        if (!params.streamId) {
          throw new Error('Stream ID is required for unsaved cards');
        }
        break;
        
      case 'file':
        if (!params.fileId) {
          throw new Error('File ID is required for file cards');
        }
        if (!params.fileName || params.fileName.trim().length === 0) {
          throw new Error('File name is required for file cards');
        }
        break;
    }

    return true;
  }

  /**
   * Get card creation statistics
   * @param {string} brainId - Brain ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Creation statistics
   */
  static async getCreationStatistics(brainId, options = {}) {
    const { since = null } = options;
    
    let whereClause = 'WHERE brain_id = $1 AND is_active = true';
    const params = [brainId];
    
    if (since) {
      whereClause += ' AND created_at >= $2';
      params.push(since);
    }
    
    const result = await query(`
      SELECT 
        card_type,
        COUNT(*) as count,
        DATE(created_at) as creation_date
      FROM cards 
      ${whereClause}
      GROUP BY card_type, DATE(created_at)
      ORDER BY creation_date DESC, count DESC
    `, params);

    return result.rows;
  }
}

module.exports = CardFactory;