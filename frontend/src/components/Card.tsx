import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card as CardType, StreamCard } from '../types';
import { useApp } from '../contexts/AppContext';
import api from '../services/api';
import CardSearchInterface from './CardSearchInterface';
import CardCreateInterface from './CardCreateInterface';

interface CardProps {
  card: CardType;
  streamCard: StreamCard;
  streamId: string;
  brainId: string;
  depth?: number;
  onUpdate: (cardId: string, updates: Partial<CardType>) => void;
  onDelete: (cardId: string) => void;
  onToggleCollapse?: (streamCardId: string) => void; // Made optional since we handle display locally now
  onAddCardBelow?: (afterPosition: number) => void;
  onCreateCardBelow?: (afterPosition: number) => void;
  onMoveUp?: (cardId: string) => void;
  onMoveDown?: (cardId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
  showAddInterface?: boolean;
  showCreateInterface?: boolean;
  onAddCard?: (cardId: string, position: number) => void;
  onCreateCard?: (card: CardType, position: number) => void;
  onCancelAdd?: () => void;
  onCancelCreate?: () => void;
}

const Card: React.FC<CardProps> = ({
  card,
  streamCard,
  streamId,
  brainId,
  depth = 0,
  onUpdate,
  onDelete,
  onToggleCollapse,
  onAddCardBelow,
  onCreateCardBelow,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  showAddInterface = false,
  showCreateInterface = false,
  onAddCard,
  onCreateCard,
  onCancelAdd,
  onCancelCreate,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editContent, setEditContent] = useState(card.content || card.contentPreview || '');
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const { aiContextCards, toggleAIContext } = useApp();

  const cardId = (card as any).cardId || card.id; // Use cardId if available, fallback to id
  const isInAIContext = aiContextCards.includes(cardId);
  
  // Three display states: 0 = collapsed (heading only), 1 = preview (limited), 2 = expanded (full)
  const [displayState, setDisplayState] = useState<0 | 1 | 2>(1); // Default to preview state

  useEffect(() => {
    setEditTitle(card.title);
    setEditContent(card.content || card.contentPreview || '');
    // Reset full content when card changes
    setFullContent(null);
  }, [card.title, card.content, card.contentPreview]);

  // Load full content when editing starts
  const loadFullContent = async () => {
    if (fullContent !== null || isLoadingContent) return fullContent;
    
    try {
      setIsLoadingContent(true);
      const response = await api.get(`/cards/${cardId}`);
      const content = response.data.card.content || '';
      setFullContent(content);
      return content;
    } catch (error) {
      console.error('Failed to load full card content:', error);
      // Fallback to existing content
      const fallbackContent = card.content || card.contentPreview || '';
      setFullContent(fallbackContent);
      return fallbackContent;
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleTitleSubmit = async () => {
    if (editTitle.trim() !== card.title) {
      await onUpdate(card.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditTitle(card.title);
      setIsEditingTitle(false);
    }
  };

  const handleContentSubmit = async () => {
    const originalContent = fullContent || card.content || card.contentPreview || '';
    if (editContent !== originalContent) {
      await onUpdate(cardId, { content: editContent });
    }
    setIsEditingContent(false);
  };

  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const contentToRestore = fullContent || card.content || card.contentPreview || '';
      setEditContent(contentToRestore);
      setIsEditingContent(false);
    }
    // Ctrl+S to save
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleContentSubmit();
    }
  };

  // Toggle between the three display states
  const handleToggleDisplay = () => {
    setDisplayState(prevState => {
      if (prevState === 0) return 1; // collapsed → preview
      if (prevState === 1) return 2; // preview → expanded
      return 0; // expanded → collapsed
    });
  };

  // Get the appropriate icon for current display state
  const getDisplayIcon = () => {
    switch (displayState) {
      case 0: return '›'; // Collapsed - right arrow (different symbol)
      case 1: return '‹'; // Preview - left arrow (different symbol)
      case 2: return '«'; // Expanded - double left arrow (different symbol)
      default: return '‹';
    }
  };

  const cardClasses = [
    'card',
    isInAIContext && 'card-ai-context',
    displayState === 0 && 'card-collapsed',
    displayState === 1 && 'card-preview',
    displayState === 2 && 'card-expanded',
    depth > 0 && 'card-nested'
  ].filter(Boolean).join(' ');

  const titleStyle = depth > 0 ? {
    fontSize: `${Math.max(13, 15 - depth)}px`
  } : {};

  return (
    <div className={cardClasses}>
      <div className="card-header" onClick={handleToggleDisplay}>
        {isEditingTitle ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="card-title-editable"
            style={titleStyle}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3 
            className="card-title" 
            style={titleStyle}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditingTitle(true);
            }}
          >
            {card.title}
          </h3>
        )}

        <div className="card-controls">
          <button
            type="button"
            className={`btn btn-small ${isInAIContext ? 'btn-primary' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleAIContext(cardId);
            }}
            title={isInAIContext ? 'Remove from AI context' : 'Add to AI context'}
          >
            AI
          </button>
          
          <button
            type="button"
            className="btn btn-small"
            onClick={async (e) => {
              e.stopPropagation();
              // Load full content before editing
              const content = await loadFullContent();
              setEditContent(content);
              setIsEditingContent(true);
              setIsEditingTitle(true);
            }}
            disabled={isLoadingContent}
            title="Edit card"
          >
            {isLoadingContent ? '🔄' : '✏️'}
          </button>
          
          <button
            type="button"
            className="btn btn-small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(cardId);
            }}
            title="Remove card from stream"
            style={{ 
              color: '#ef4444',
              fontWeight: 'bold',
              fontSize: '16px'
            }}
          >
            ×
          </button>
          
          {/* Reordering controls */}
          {(onMoveUp || onMoveDown) && (
            <>
              <button
                type="button"
                className="btn btn-small"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp?.(cardId);
                }}
                disabled={isFirst}
                title="Move card up"
                style={{ opacity: isFirst ? 0.3 : 1 }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown?.(cardId);
                }}
                disabled={isLast}
                title="Move card down"
                style={{ opacity: isLast ? 0.3 : 1 }}
              >
                ↓
              </button>
            </>
          )}
          
          <button
            type="button"
            className="btn btn-small"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleDisplay();
            }}
            title={displayState === 0 ? 'Show preview' : displayState === 1 ? 'Show full' : 'Collapse'}
          >
            {getDisplayIcon()}
          </button>
        </div>
      </div>

      {displayState > 0 && (
        <div className="card-content">
          {isEditingContent ? (
            <div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleContentKeyDown}
                className="form-input form-textarea"
                style={{ 
                  width: '100%', 
                  marginBottom: '12px',
                  minHeight: editContent.length > 1000 ? '400px' : '120px',
                  maxHeight: '80vh'
                }}
                autoFocus
                placeholder="Write your content in markdown..."
              />
              <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>
                {editContent.length.toLocaleString()} characters • {Math.round(editContent.split(/\s+/).filter((w: string) => w.length > 0).length).toLocaleString()} words
              </div>
              <div className="flex gap-sm">
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={handleContentSubmit}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    const contentToRestore = fullContent || card.content || card.contentPreview || '';
                    setEditContent(contentToRestore);
                    setIsEditingContent(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div 
              className={`card-content-display ${displayState === 1 ? 'card-content-preview' : 'card-content-expanded'}`}
              onDoubleClick={async () => {
                const content = await loadFullContent();
                setEditContent(content);
                setIsEditingContent(true);
              }}
            >
              {(card.content || card.contentPreview) ? (
                <>
                  {displayState === 2 ? (
                    // Fully expanded - show complete content or load it if needed
                    fullContent ? (
                      <ReactMarkdown>{fullContent}</ReactMarkdown>
                    ) : (
                      <>
                        <ReactMarkdown>{card.content || card.contentPreview}</ReactMarkdown>
                        {(!card.content && card.contentPreview && card.contentPreview.length >= 500) && (
                          <div 
                            className="read-more-indicator"
                            onClick={async () => {
                              await loadFullContent();
                            }}
                            style={{ 
                              color: '#6b7280', 
                              fontSize: '12px', 
                              marginTop: '8px', 
                              cursor: 'pointer',
                              textDecoration: 'underline'
                            }}
                          >
                            {isLoadingContent ? 'Loading full content...' : '...click to load full content'}
                          </div>
                        )}
                      </>
                    )
                  ) : (
                    // Preview mode - show limited content with read more
                    <>
                      <div className="card-preview-content">
                        <ReactMarkdown>{card.content || card.contentPreview}</ReactMarkdown>
                      </div>
                      {(card.content || card.contentPreview) && (card.content || card.contentPreview).length > 200 && (
                        <div 
                          className="read-more-indicator"
                          onClick={() => setDisplayState(2)}
                          style={{ 
                            color: '#3b82f6', 
                            fontSize: '12px', 
                            marginTop: '4px', 
                            cursor: 'pointer',
                            fontWeight: '500'
                          }}
                        >
                          ...read more
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                  No content yet. Double-click to add content.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Card Action Buttons - Add/Create below this card */}
      {(onAddCardBelow || onCreateCardBelow) && displayState > 0 && (
        <div className="card-actions" style={{
          display: 'flex',
          gap: '8px',
          padding: '8px 12px',
          borderTop: '1px solid #f3f4f6',
          backgroundColor: '#fafbfc',
          justifyContent: 'center'
        }}>
          {onAddCardBelow && !showAddInterface && !showCreateInterface && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onAddCardBelow(streamCard.position)}
              title="Add existing card below this one"
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              📎 Add Card
            </button>
          )}
          {onCreateCardBelow && !showAddInterface && !showCreateInterface && (
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={() => onCreateCardBelow(streamCard.position)}
              title="Create new card below this one"
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              ✨ Create Card
            </button>
          )}
        </div>
      )}
      
      {/* Inline Card Search Interface */}
      {showAddInterface && onAddCard && onCancelAdd && (
        <CardSearchInterface
          brainId={brainId}
          streamId={streamId}
          streamCards={[streamCard]} // Pass current stream card to avoid showing it
          onCardSelected={(card) => onAddCard(card.id, streamCard.position)}
          onCancel={onCancelAdd}
        />
      )}
      
      {/* Inline Card Creation Interface */}
      {showCreateInterface && onCreateCard && onCancelCreate && (
        <CardCreateInterface
          brainId={brainId}
          onCardCreated={(card) => onCreateCard(card, streamCard.position)}
          onCancel={onCancelCreate}
        />
      )}
    </div>
  );
};

export default Card;