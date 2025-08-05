const Stream = require('../../src/models/Stream');
const StreamCard = require('../../src/models/StreamCard');
const Card = require('../../src/models/Card');
const Brain = require('../../src/models/Brain');
const StreamManager = require('../../src/services/streamManager');
const { ensureAuthentication } = require('../utils/auth');

/**
 * Stream CLI Commands
 */

/**
 * List streams for a brain
 */
async function listStreams(brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const streams = await Stream.findByBrainId(brain.id);
  const streamsWithStats = await Promise.all(
    streams.map(async (stream) => {
      const data = await stream.toJSON();
      return {
        ...data,
        brainName: brainName,
        favorite: data.isFavorited ? '⭐' : '',
        lastAccessed: data.lastAccessedAt ? new Date(data.lastAccessedAt).toLocaleDateString() : 'Never'
      };
    })
  );
  
  return {
    brainName,
    streams: streamsWithStats,
    count: streamsWithStats.length
  };
}

/**
 * Create a new stream
 */
async function createStream(streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.create(brain.id, streamName, false);
  const streamData = await stream.toJSON();
  
  return {
    ...streamData,
    brainName,
    message: `Stream '${streamName}' created successfully`
  };
}

/**
 * Delete a stream
 */
async function deleteStream(streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  await stream.delete();
  
  return {
    streamName,
    brainName,
    deleted: true,
    message: `Stream '${streamName}' deleted successfully`
  };
}

/**
 * Toggle favorite status of a stream
 */
async function toggleFavoriteStream(streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  await stream.toggleFavorite();
  
  return {
    streamName,
    brainName,
    isFavorited: stream.isFavorited,
    status: stream.isFavorited ? '⭐ Favorited' : 'Unfavorited',
    message: `Stream '${streamName}' ${stream.isFavorited ? 'added to' : 'removed from'} favorites`
  };
}

/**
 * Show stream contents
 */
async function showStream(streamName, brainName, includeContent = false) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const streamData = await StreamManager.getStreamWithCards(stream.id, includeContent);
  
  // Format cards for CLI display
  const formattedCards = streamData.cards.map((card, index) => ({
    position: card.position,
    title: card.title,
    depth: card.depth,
    indent: '  '.repeat(card.depth),
    aiContext: card.isInAIContext ? '✨' : '',
    collapsed: card.isCollapsed ? '📁' : '📄',
    preview: card.contentPreview ? card.contentPreview.substring(0, 100) + '...' : '',
    content: includeContent ? card.content : undefined
  }));
  
  return {
    streamName,
    brainName,
    isFavorited: streamData.isFavorited,
    totalCards: streamData.totalCards,
    aiContextCount: streamData.aiContextCount,
    cards: formattedCards,
    lastAccessed: streamData.lastAccessedAt
  };
}

/**
 * Show AI context cards for a stream
 */
async function showStreamAIContext(streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const aiContextCards = await StreamCard.getAIContextCards(stream.id);
  
  const formattedCards = aiContextCards.map(card => ({
    position: card.position,
    title: card.title,
    depth: card.depth,
    indent: '  '.repeat(card.depth),
    preview: card.contentPreview ? card.contentPreview.substring(0, 100) + '...' : ''
  }));
  
  return {
    streamName,
    brainName,
    aiContextCards: formattedCards,
    count: aiContextCards.length,
    message: `${aiContextCards.length} cards in AI context`
  };
}

/**
 * Add card to stream
 */
async function addCardToStream(cardTitle, streamName, brainName, options = {}) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const card = await Card.findByBrainAndTitle(brain.id, cardTitle);
  if (!card) {
    throw new Error(`Card '${cardTitle}' not found in brain '${brainName}'`);
  }
  
  const { position, depth = 0, isInAIContext = false, isCollapsed = false } = options;
  
  const result = await StreamManager.addCardToStream(
    stream.id, 
    card.id, 
    position, 
    depth, 
    { isInAIContext, isCollapsed }
  );
  
  return {
    cardTitle,
    streamName,
    brainName,
    position: result.insertedAt,
    depth,
    aiContext: isInAIContext ? '✨' : '',
    collapsed: isCollapsed ? '📁' : '📄',
    message: `Card '${cardTitle}' added to stream '${streamName}' at position ${result.insertedAt}`
  };
}

/**
 * Remove card from stream
 */
async function removeCardFromStream(cardTitle, streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const card = await Card.findByBrainAndTitle(brain.id, cardTitle);
  if (!card) {
    throw new Error(`Card '${cardTitle}' not found in brain '${brainName}'`);
  }
  
  const result = await StreamManager.removeCardFromStream(stream.id, card.id);
  
  if (!result.removed) {
    throw new Error(`Card '${cardTitle}' is not in stream '${streamName}'`);
  }
  
  return {
    cardTitle,
    streamName,
    brainName,
    removed: true,
    totalCards: result.totalCards,
    message: `Card '${cardTitle}' removed from stream '${streamName}'`
  };
}

/**
 * Move card to new position in stream
 */
async function moveCardInStream(cardTitle, streamName, brainName, newPosition, newDepth = null) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const card = await Card.findByBrainAndTitle(brain.id, cardTitle);
  if (!card) {
    throw new Error(`Card '${cardTitle}' not found in brain '${brainName}'`);
  }
  
  const result = await StreamManager.moveCard(stream.id, card.id, newPosition, newDepth);
  
  if (!result.changed) {
    return {
      cardTitle,
      streamName,
      brainName,
      message: `Card '${cardTitle}' is already at the requested position`
    };
  }
  
  return {
    cardTitle,
    streamName,
    brainName,
    newPosition,
    newDepth,
    totalCards: result.totalCards,
    message: `Card '${cardTitle}' moved to position ${newPosition}${newDepth !== null ? ` with depth ${newDepth}` : ''}`
  };
}

/**
 * Search cards for adding to streams
 */
async function searchCards(query, brainName, includeOtherBrains = true) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const results = await StreamManager.searchCardsForStream(
    brain.id, 
    query, 
    includeOtherBrains, 
    user.id
  );
  
  const formatCards = (cards) => cards.map(card => ({
    title: card.title,
    brainName: card.brainName || brainName,
    preview: card.contentPreview ? card.contentPreview.substring(0, 80) + '...' : '',
    hasFile: card.hasFile ? '📄' : '✏️',
    size: card.fileSize ? `${Math.round(card.fileSize / 1024)}KB` : '0KB'
  }));
  
  return {
    query,
    brainName,
    currentBrain: {
      cards: formatCards(results.currentBrain),
      count: results.currentBrain.length
    },
    otherBrains: {
      cards: formatCards(results.otherBrains),
      count: results.otherBrains.length
    },
    totalResults: results.totalResults
  };
}

/**
 * Duplicate a stream
 */
async function duplicateStream(streamName, brainName, newStreamName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const result = await StreamManager.duplicateStream(stream.id, newStreamName);
  
  return {
    originalStream: streamName,
    newStream: newStreamName,
    brainName,
    cardsCopied: result.totalCards,
    message: `Stream '${streamName}' duplicated as '${newStreamName}' with ${result.totalCards} cards`
  };
}

/**
 * Get stream statistics
 */
async function getStreamStats(streamName, brainName) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const stream = await Stream.findByBrainAndName(brain.id, streamName);
  if (!stream) {
    throw new Error(`Stream '${streamName}' not found in brain '${brainName}'`);
  }
  
  const stats = await StreamManager.getStreamStats(stream.id);
  
  return {
    ...stats,
    brainName,
    formattedStats: {
      cards: `${stats.totalCards} total`,
      aiContext: `${stats.aiContextCount} in AI context`,
      depth: `Average depth: ${stats.averageDepth.toFixed(1)}`,
      nested: stats.hasNestedCards ? 'Has nested cards' : 'Flat structure',
      size: `${Math.round(stats.aiContextSize / 1024)}KB in AI context`,
      favorited: stats.isFavorited ? '⭐ Favorited' : 'Not favorited'
    }
  };
}

/**
 * Get analytics for all streams in a brain
 */
async function getStreamAnalytics(brainName, limit = 10) {
  const user = await ensureAuthentication();
  
  const brain = await Brain.findByUserAndName(user.id, brainName);
  if (!brain) {
    throw new Error(`Brain '${brainName}' not found`);
  }
  
  const analytics = await StreamManager.getStreamAnalytics(brain.id, limit);
  
  return {
    brainName,
    analytics: analytics.analytics,
    recentStreams: analytics.recentStreams.map(stream => ({
      ...stream,
      favorite: stream.isFavorited ? '⭐' : '',
      lastAccessed: new Date(stream.lastAccessedAt).toLocaleDateString()
    })),
    summary: {
      total: `${analytics.analytics.totalStreams} streams`,
      favorites: `${analytics.analytics.favoritedStreams} favorited`,
      avgCards: `${analytics.analytics.avgCardsPerStream.toFixed(1)} cards per stream`,
      uniqueCards: `${analytics.analytics.uniqueCardsInStreams} unique cards used`
    }
  };
}

module.exports = {
  listStreams,
  createStream,
  deleteStream,
  toggleFavoriteStream,
  showStream,
  showStreamAIContext,
  addCardToStream,
  removeCardFromStream,
  moveCardInStream,
  searchCards,
  duplicateStream,
  getStreamStats,
  getStreamAnalytics
};