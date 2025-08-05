import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card as CardType, StreamCard } from '../types';
import { useApp } from '../contexts/AppContext';

interface CardProps {
  card: CardType;
  streamCard: StreamCard;
  streamId: string;
  depth?: number;
  onUpdate: (cardId: string, updates: Partial<CardType>) => void;
  onDelete: (cardId: string) => void;
  onToggleCollapse: (streamCardId: string) => void;
}

const Card: React.FC<CardProps> = ({
  card,
  streamCard,
  streamId,
  depth = 0,
  onUpdate,
  onDelete,
  onToggleCollapse,
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [editContent, setEditContent] = useState(card.content || '');
  const { aiContextCards, toggleAIContext } = useApp();

  const isInAIContext = aiContextCards.includes(card.id);
  const isCollapsed = streamCard.isCollapsed;

  useEffect(() => {
    setEditTitle(card.title);
    setEditContent(card.content || '');
  }, [card.title, card.content]);

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
    if (editContent !== card.content) {
      await onUpdate(card.id, { content: editContent });
    }
    setIsEditingContent(false);
  };

  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditContent(card.content || '');
      setIsEditingContent(false);
    }
    // Ctrl+S to save
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleContentSubmit();
    }
  };

  const cardClasses = [
    'card',
    isInAIContext && 'card-ai-context',
    isCollapsed && 'card-collapsed',
    depth > 0 && 'card-nested'
  ].filter(Boolean).join(' ');

  const titleStyle = depth > 0 ? {
    fontSize: `${Math.max(13, 15 - depth)}px`
  } : {};

  return (
    <div className={cardClasses}>
      <div className="card-header" onClick={() => onToggleCollapse(streamCard.id)}>
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
              toggleAIContext(card.id);
            }}
            title={isInAIContext ? 'Remove from AI context' : 'Add to AI context'}
          >
            AI
          </button>
          
          <button
            type="button"
            className="btn btn-small"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingContent(true);
            }}
            title="Edit content"
          >
            Edit
          </button>
          
          <button
            type="button"
            className="btn btn-small"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Delete this card from the stream?')) {
                onDelete(card.id);
              }
            }}
            title="Delete card"
          >
            Del
          </button>
          
          <button
            type="button"
            className="btn btn-small"
            onClick={(e) => e.stopPropagation()}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="card-content">
          {isEditingContent ? (
            <div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleContentKeyDown}
                className="form-input form-textarea"
                style={{ width: '100%', marginBottom: '12px' }}
                autoFocus
                placeholder="Write your content in markdown..."
              />
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
                    setEditContent(card.content || '');
                    setIsEditingContent(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div 
              className="card-content-display"
              onDoubleClick={() => setIsEditingContent(true)}
            >
              {card.content ? (
                <ReactMarkdown>{card.content}</ReactMarkdown>
              ) : (
                <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
                  No content yet. Double-click to add content.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Card;