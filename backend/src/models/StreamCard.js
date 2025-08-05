const { query, transaction } = require('./database');

/**
 * StreamCard Model
 * Handles the many-to-many relationship between streams and cards
 * with position management, AI context, and collapsed state
 */

class StreamCard {
  constructor(data) {
    this.id = data.id;
    this.streamId = data.stream_id;
    this.cardId = data.card_id;
    this.position = data.position;
    this.depth = data.depth;
    this.isInAIContext = data.is_in_ai_context;
    this.isCollapsed = data.is_collapsed;
    this.addedAt = data.added_at;
  }

  /**
   * Add a card to a stream at a specific position
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID  
   * @param {number} position - Position in stream (0-based)
   * @param {number} depth - Nesting depth (default: 0)
   * @param {Object} options - Additional options
   * @returns {Promise<StreamCard>} - Created StreamCard instance
   */
  static async addCardToStream(streamId, cardId, position = null, depth = 0, options = {}) {
    const { isInAIContext = false, isCollapsed = false } = options;

    return await transaction(async (client) => {
      // Verify stream exists
      const streamResult = await client.query(
        'SELECT id FROM streams WHERE id = $1',
        [streamId]
      );

      if (streamResult.rows.length === 0) {
        throw new Error('Stream not found');
      }

      // Verify card exists and is active
      const cardResult = await client.query(
        'SELECT id FROM cards WHERE id = $1 AND is_active = true',
        [cardId]
      );

      if (cardResult.rows.length === 0) {
        throw new Error('Card not found or inactive');
      }

      // Check if card already exists in this stream
      const existingResult = await client.query(
        'SELECT id FROM stream_cards WHERE stream_id = $1 AND card_id = $2',
        [streamId, cardId]
      );

      if (existingResult.rows.length > 0) {
        throw new Error('Card already exists in this stream');
      }

      // If no position specified, add at the end
      if (position === null) {
        const maxPositionResult = await client.query(
          'SELECT COALESCE(MAX(position), -1) as max_position FROM stream_cards WHERE stream_id = $1',
          [streamId]
        );
        position = maxPositionResult.rows[0].max_position + 1;
      }

      // Shift existing cards at this position and after to make room
      await client.query(
        'UPDATE stream_cards SET position = position + 1 WHERE stream_id = $1 AND position >= $2',
        [streamId, position]
      );

      // Insert the new stream_card relationship
      const result = await client.query(`
        INSERT INTO stream_cards (stream_id, card_id, position, depth, is_in_ai_context, is_collapsed)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [streamId, cardId, position, depth, isInAIContext, isCollapsed]);

      console.log(`✅ Added card ${cardId} to stream ${streamId} at position ${position}`);
      return new StreamCard(result.rows[0]);
    });
  }

  /**
   * Remove a card from a stream
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @returns {Promise<boolean>} - True if card was removed
   */
  static async removeCardFromStream(streamId, cardId) {
    return await transaction(async (client) => {
      // Get the position of the card being removed
      const cardResult = await client.query(
        'SELECT position FROM stream_cards WHERE stream_id = $1 AND card_id = $2',
        [streamId, cardId]
      );

      if (cardResult.rows.length === 0) {
        return false; // Card not in stream
      }

      const removedPosition = cardResult.rows[0].position;

      // Remove the card from the stream
      await client.query(
        'DELETE FROM stream_cards WHERE stream_id = $1 AND card_id = $2',
        [streamId, cardId]
      );

      // Shift remaining cards down to fill the gap
      await client.query(
        'UPDATE stream_cards SET position = position - 1 WHERE stream_id = $1 AND position > $2',
        [streamId, removedPosition]
      );

      console.log(`✅ Removed card ${cardId} from stream ${streamId}`);
      return true;
    });
  }

  /**
   * Reorder a card to a new position within a stream
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @param {number} newPosition - New position (0-based)
   * @param {number} newDepth - New depth (optional)
   * @returns {Promise<boolean>} - True if card was reordered
   */
  static async reorderCard(streamId, cardId, newPosition, newDepth = null) {
    return await transaction(async (client) => {
      // Get current position and depth
      const currentResult = await client.query(
        'SELECT position, depth FROM stream_cards WHERE stream_id = $1 AND card_id = $2',
        [streamId, cardId]
      );

      if (currentResult.rows.length === 0) {
        throw new Error('Card not found in stream');
      }

      const currentPosition = currentResult.rows[0].position;
      const currentDepth = currentResult.rows[0].depth;

      // If position hasn't changed and depth hasn't changed, nothing to do
      if (currentPosition === newPosition && (newDepth === null || currentDepth === newDepth)) {
        return false;
      }

      // Get max position to validate new position
      const maxResult = await client.query(
        'SELECT COALESCE(MAX(position), 0) as max_position FROM stream_cards WHERE stream_id = $1',
        [streamId]
      );
      const maxPosition = maxResult.rows[0].max_position;

      if (newPosition < 0 || newPosition > maxPosition) {
        throw new Error(`Invalid position: ${newPosition}. Must be between 0 and ${maxPosition}`);
      }

      // Complex position reordering logic
      if (currentPosition !== newPosition) {
        if (newPosition > currentPosition) {
          // Moving down: shift cards between old and new position up
          await client.query(
            'UPDATE stream_cards SET position = position - 1 WHERE stream_id = $1 AND position > $2 AND position <= $3',
            [streamId, currentPosition, newPosition]
          );
        } else {
          // Moving up: shift cards between new and old position down  
          await client.query(
            'UPDATE stream_cards SET position = position + 1 WHERE stream_id = $1 AND position >= $2 AND position < $3',
            [streamId, newPosition, currentPosition]
          );
        }
      }

      // Update the card's position and optionally depth
      const updateFields = ['position = $3'];
      const updateValues = [streamId, cardId, newPosition];
      
      if (newDepth !== null) {
        updateFields.push('depth = $4');
        updateValues.push(newDepth);
      }

      await client.query(`
        UPDATE stream_cards SET ${updateFields.join(', ')} 
        WHERE stream_id = $1 AND card_id = $2
      `, updateValues);

      console.log(`✅ Reordered card ${cardId} in stream ${streamId} to position ${newPosition}`);
      return true;
    });
  }

  /**
   * Toggle AI context for a card in a stream
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @returns {Promise<boolean>} - New AI context state
   */
  static async toggleAIContext(streamId, cardId) {
    const result = await query(`
      UPDATE stream_cards 
      SET is_in_ai_context = NOT is_in_ai_context 
      WHERE stream_id = $1 AND card_id = $2
      RETURNING is_in_ai_context
    `, [streamId, cardId]);

    if (result.rows.length === 0) {
      throw new Error('Card not found in stream');
    }

    const newState = result.rows[0].is_in_ai_context;
    console.log(`✅ Toggled AI context for card ${cardId} in stream ${streamId}: ${newState}`);
    return newState;
  }

  /**
   * Toggle collapsed state for a card in a stream
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @returns {Promise<boolean>} - New collapsed state
   */
  static async toggleCollapsed(streamId, cardId) {
    const result = await query(`
      UPDATE stream_cards 
      SET is_collapsed = NOT is_collapsed 
      WHERE stream_id = $1 AND card_id = $2
      RETURNING is_collapsed
    `, [streamId, cardId]);

    if (result.rows.length === 0) {
      throw new Error('Card not found in stream');
    }

    const newState = result.rows[0].is_collapsed;
    console.log(`✅ Toggled collapsed state for card ${cardId} in stream ${streamId}: ${newState}`);
    return newState;
  }

  /**
   * Update card state in stream (AI context, collapsed, depth)
   * @param {string} streamId - Stream ID
   * @param {string} cardId - Card ID
   * @param {Object} updates - State updates
   * @returns {Promise<StreamCard>} - Updated StreamCard instance
   */
  static async updateCardState(streamId, cardId, updates) {
    const allowedFields = ['is_in_ai_context', 'is_collapsed', 'depth'];
    const validUpdates = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        validUpdates[key] = value;
      }
    }

    if (Object.keys(validUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    const setClause = Object.keys(validUpdates).map((key, index) => `${key} = $${index + 3}`).join(', ');
    const values = [streamId, cardId, ...Object.values(validUpdates)];

    const result = await query(`
      UPDATE stream_cards 
      SET ${setClause}
      WHERE stream_id = $1 AND card_id = $2
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      throw new Error('Card not found in stream');
    }

    return new StreamCard(result.rows[0]);
  }

  /**
   * Get all cards in a stream with proper ordering
   * @param {string} streamId - Stream ID
   * @returns {Promise<Array<Object>>} - Array of cards with stream metadata
   */
  static async getStreamCards(streamId) {
    const result = await query(`
      SELECT c.*, sc.position, sc.depth, sc.is_in_ai_context, sc.is_collapsed, sc.added_at
      FROM cards c
      JOIN stream_cards sc ON c.id = sc.card_id
      WHERE sc.stream_id = $1 AND c.is_active = true
      ORDER BY sc.position
    `, [streamId]);

    return result.rows.map(row => ({
      id: row.id,
      brainId: row.brain_id,
      title: row.title,
      contentPreview: row.content_preview,
      fileSize: row.file_size,
      hasFile: !!row.file_path,
      filePath: row.file_path,
      lastModified: row.last_modified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Stream-specific metadata
      position: row.position,
      depth: row.depth,
      isInAIContext: row.is_in_ai_context,
      isCollapsed: row.is_collapsed,
      addedAt: row.added_at
    }));
  }

  /**
   * Get all streams that contain a specific card
   * @param {string} cardId - Card ID
   * @returns {Promise<Array<Object>>} - Array of streams with position info
   */
  static async getCardStreams(cardId) {
    const result = await query(`
      SELECT s.*, sc.position, sc.depth, sc.is_in_ai_context, sc.is_collapsed, sc.added_at
      FROM streams s
      JOIN stream_cards sc ON s.id = sc.stream_id
      WHERE sc.card_id = $1
      ORDER BY s.name
    `, [cardId]);

    return result.rows.map(row => ({
      id: row.id,
      brainId: row.brain_id,
      name: row.name,
      isFavorited: row.is_favorited,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      // Card position in this stream
      position: row.position,
      depth: row.depth,
      isInAIContext: row.is_in_ai_context,
      isCollapsed: row.is_collapsed,
      addedAt: row.added_at
    }));
  }

  /**
   * Get cards in AI context for a stream
   * @param {string} streamId - Stream ID
   * @returns {Promise<Array<Object>>} - Array of cards in AI context
   */
  static async getAIContextCards(streamId) {
    const result = await query(`
      SELECT c.id, c.title, c.content_preview, sc.position, sc.depth
      FROM cards c
      JOIN stream_cards sc ON c.id = sc.card_id
      WHERE sc.stream_id = $1 AND sc.is_in_ai_context = true AND c.is_active = true
      ORDER BY sc.position
    `, [streamId]);

    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      contentPreview: row.content_preview,
      position: row.position,
      depth: row.depth
    }));
  }

  /**
   * Normalize positions in a stream (fix gaps and duplicates)
   * @param {string} streamId - Stream ID
   * @returns {Promise<number>} - Number of cards reordered
   */
  static async normalizePositions(streamId) {
    return await transaction(async (client) => {
      // Get all cards in order
      const result = await client.query(`
        SELECT id, position 
        FROM stream_cards 
        WHERE stream_id = $1 
        ORDER BY position, added_at
      `, [streamId]);

      // Update positions to be sequential starting from 0
      let updated = 0;
      for (let i = 0; i < result.rows.length; i++) {
        const card = result.rows[i];
        if (card.position !== i) {
          await client.query(
            'UPDATE stream_cards SET position = $1 WHERE id = $2',
            [i, card.id]
          );
          updated++;
        }
      }

      if (updated > 0) {
        console.log(`✅ Normalized ${updated} card positions in stream ${streamId}`);
      }

      return updated;
    });
  }

  /**
   * Get position statistics for a stream
   * @param {string} streamId - Stream ID
   * @returns {Promise<Object>} - Position statistics
   */
  static async getPositionStats(streamId) {
    const result = await query(`
      SELECT 
        COUNT(*) as total_cards,
        MIN(position) as min_position,
        MAX(position) as max_position,
        COUNT(DISTINCT position) as unique_positions,
        COUNT(*) FILTER (WHERE is_in_ai_context = true) as ai_context_count
      FROM stream_cards 
      WHERE stream_id = $1
    `, [streamId]);

    const stats = result.rows[0];
    return {
      totalCards: parseInt(stats.total_cards),
      minPosition: parseInt(stats.min_position || 0),
      maxPosition: parseInt(stats.max_position || 0),
      uniquePositions: parseInt(stats.unique_positions),
      aiContextCount: parseInt(stats.ai_context_count),
      hasGaps: parseInt(stats.unique_positions) !== parseInt(stats.total_cards),
      expectedMaxPosition: parseInt(stats.total_cards) - 1
    };
  }

  /**
   * Bulk update positions for multiple cards
   * @param {string} streamId - Stream ID
   * @param {Array<Object>} updates - Array of {cardId, position, depth?} objects
   * @returns {Promise<number>} - Number of cards updated
   */
  static async bulkUpdatePositions(streamId, updates) {
    return await transaction(async (client) => {
      let updated = 0;
      
      for (const update of updates) {
        const { cardId, position, depth } = update;
        
        const setFields = ['position = $3'];
        const values = [streamId, cardId, position];
        
        if (depth !== undefined) {
          setFields.push('depth = $4');
          values.push(depth);
        }
        
        const result = await client.query(`
          UPDATE stream_cards 
          SET ${setFields.join(', ')}
          WHERE stream_id = $1 AND card_id = $2
        `, values);
        
        updated += result.rowCount;
      }
      
      console.log(`✅ Bulk updated ${updated} card positions in stream ${streamId}`);
      return updated;
    });
  }
}

module.exports = StreamCard;