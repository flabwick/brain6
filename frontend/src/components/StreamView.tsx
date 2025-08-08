import React, { useState, useEffect } from 'react';
import Card from './Card';
import CardSearchInterface from './CardSearchInterface';
import CardCreateInterface from './CardCreateInterface';
import { Stream, StreamCard, Card as CardType } from '../types';
import api from '../services/api';
import { useApp } from '../contexts/AppContext';

interface StreamViewProps {
  streamId: string;
  brainId: string;
}

const StreamView: React.FC<StreamViewProps> = ({ streamId, brainId }) => {
  const [stream, setStream] = useState<Stream | null>(null);
  const [streamCards, setStreamCards] = useState<StreamCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCardIdForAdd, setActiveCardIdForAdd] = useState<string | null>(null);
  const [activeCardIdForCreate, setActiveCardIdForCreate] = useState<string | null>(null);
  const { setError: setGlobalError } = useApp();

  useEffect(() => {
    loadStream();
  }, [streamId]);

  const loadStream = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load stream data
      const streamResponse = await api.get(`/streams/${streamId}`);
      setStream(streamResponse.data.stream);

      // Load stream cards
      const cardsResponse = await api.get(`/streams/${streamId}/cards`);
      setStreamCards(cardsResponse.data.cards || []);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to load stream';
      setError(errorMessage);
      setGlobalError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateCard = async (cardId: string, updates: Partial<CardType>) => {
    try {
      await api.put(`/cards/${cardId}`, updates);
      
      // Refresh the stream to get latest data from server
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to update card';
      setGlobalError(errorMessage);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      // Remove card from stream (card remains in brain)
      await api.delete(`/streams/${streamId}/cards/${cardId}`);
      
      // Refresh the stream to reflect the removal
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to remove card from stream';
      setGlobalError(errorMessage);
    }
  };

  const handleToggleCollapse = async (streamCardId: string) => {
    try {
      const streamCard = streamCards.find(sc => sc.id === streamCardId);
      if (!streamCard) return;

      const newCollapsedState = !streamCard.isCollapsed;
      
      await api.put(`/streams/${streamId}/cards/${streamCardId}`, {
        isCollapsed: newCollapsedState
      });

      // Refresh the stream to reflect the collapse state change
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to toggle card collapse';
      setGlobalError(errorMessage);
    }
  };


  // Position management functions
  const handleAddCardBelow = (afterPosition: number) => {
    const cardAtPosition = streamCards.find(sc => sc.position === afterPosition);
    if (cardAtPosition) {
      setActiveCardIdForAdd(cardAtPosition.cardId || cardAtPosition.id || '');
      setActiveCardIdForCreate(null); // Close any create interface
    }
  };

  const handleCreateCardBelow = (afterPosition: number) => {
    const cardAtPosition = streamCards.find(sc => sc.position === afterPosition);
    if (cardAtPosition) {
      setActiveCardIdForCreate(cardAtPosition.cardId || cardAtPosition.id || '');
      setActiveCardIdForAdd(null); // Close any add interface
    }
  };

  const handleMoveUp = async (cardId: string) => {
    try {
      const currentIndex = streamCards.findIndex(sc => (sc.cardId || sc.id) === cardId);
      if (currentIndex <= 0) return; // Already at top

      const currentCard = streamCards[currentIndex];
      const targetCard = streamCards[currentIndex - 1];

      // Swap positions: use negative temp position to avoid validation limits
      const tempPosition = -1;

      // First move current card to temp position
      await api.put(`/streams/${streamId}/cards/${cardId}`, {
        position: tempPosition
      });

      // Move target card to current card's position
      await api.put(`/streams/${streamId}/cards/${targetCard.cardId || targetCard.id}`, {
        position: currentCard.position
      });

      // Move current card to target card's position
      await api.put(`/streams/${streamId}/cards/${cardId}`, {
        position: targetCard.position
      });

      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to move card';
      setGlobalError(errorMessage);
    }
  };

  const handleMoveDown = async (cardId: string) => {
    try {
      const currentIndex = streamCards.findIndex(sc => (sc.cardId || sc.id) === cardId);
      if (currentIndex >= streamCards.length - 1) return; // Already at bottom

      const currentCard = streamCards[currentIndex];
      const targetCard = streamCards[currentIndex + 1];

      // Swap positions: use negative temp position to avoid validation limits
      const tempPosition = -1;

      // First move current card to temp position
      await api.put(`/streams/${streamId}/cards/${cardId}`, {
        position: tempPosition
      });

      // Move target card to current card's position
      await api.put(`/streams/${streamId}/cards/${targetCard.cardId || targetCard.id}`, {
        position: currentCard.position
      });

      // Move current card to target card's position
      await api.put(`/streams/${streamId}/cards/${cardId}`, {
        position: targetCard.position
      });

      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to move card';
      setGlobalError(errorMessage);
    }
  };

  // Inline interface handlers
  const handleInlineAddCard = async (cardId: string, insertAfterPosition: number | null) => {
    try {
      const requestBody: any = {
        cardId: cardId,
        isInAIContext: false,
        isCollapsed: false
      };
      
      // Only add position if it's not null (null means add at end)
      if (insertAfterPosition !== null) {
        requestBody.position = insertAfterPosition;
      }

      await api.post(`/streams/${streamId}/cards`, requestBody);

      setActiveCardIdForAdd(null);
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to add card to stream';
      setGlobalError(errorMessage);
    }
  };

  const handleInlineCreateCard = async (card: CardType, insertAfterPosition: number | null) => {
    try {
      const requestBody: any = {
        cardId: card.id,
        isInAIContext: false,
        isCollapsed: false
      };
      
      // Only add position if it's not null (null means add at end)
      if (insertAfterPosition !== null) {
        requestBody.position = insertAfterPosition;
      }

      await api.post(`/streams/${streamId}/cards`, requestBody);

      setActiveCardIdForCreate(null);
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to add card to stream';
      setGlobalError(errorMessage);
    }
  };

  const handleCancelAdd = () => {
    setActiveCardIdForAdd(null);
  };

  const handleCancelCreate = () => {
    setActiveCardIdForCreate(null);
  };

  if (isLoading) {
    return (
      <div className="stream-view">
        <div className="text-center" style={{ padding: '2rem' }}>
          <span className="loading-spinner" style={{ width: '24px', height: '24px' }} />
          <p style={{ marginTop: '1rem' }}>Loading stream...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stream-view">
        <div className="error-message">
          {error}
        </div>
        <button 
          onClick={loadStream} 
          className="btn btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="stream-view">
        <div className="error-message">
          Stream not found
        </div>
      </div>
    );
  }


  const handleRefreshStream = async () => {
    await loadStream();
  };

  return (
    <div className="stream-view">
      {/* Stream header with refresh button */}
      <div className="stream-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid #e5e7eb'
      }}>
        <div style={{ color: '#6b7280', fontSize: '14px' }}>
          {streamCards.length} card{streamCards.length !== 1 ? 's' : ''} in stream
        </div>
        <button
          onClick={handleRefreshStream}
          className="btn btn-small"
          disabled={isLoading}
          title="Refresh stream to see latest changes"
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          {isLoading ? (
            <>
              <span className="loading-spinner" style={{ width: '12px', height: '12px' }} />
              Loading...
            </>
          ) : (
            <>
              🔄 Refresh
            </>
          )}
        </button>
      </div>

      {/* Stream cards */}
      {streamCards.map((streamCard, index) => {
        const cardId = streamCard.cardId || streamCard.id || '';
        return (
          <Card
            key={cardId}
            card={streamCard as any} // StreamCard contains all Card properties
            streamCard={streamCard}  
            streamId={streamId}
            brainId={brainId}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onToggleCollapse={handleToggleCollapse}
            onAddCardBelow={handleAddCardBelow}
            onCreateCardBelow={handleCreateCardBelow}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            isFirst={index === 0}
            isLast={index === streamCards.length - 1}
            showAddInterface={activeCardIdForAdd === cardId}
            showCreateInterface={activeCardIdForCreate === cardId}
            onAddCard={handleInlineAddCard}
            onCreateCard={handleInlineCreateCard}
            onCancelAdd={handleCancelAdd}
            onCancelCreate={handleCancelCreate}
          />
        );
      })}


      {streamCards.length === 0 && (
        <div className="text-center" style={{ padding: '2rem', color: '#6b7280' }}>
          <p>This stream is empty.</p>
          <div className="flex gap-md justify-center" style={{ marginTop: '1rem' }}>
            <button
              onClick={() => setActiveCardIdForAdd('empty-stream')}
              className="btn btn-primary btn-small"
              title="Add an existing card from this brain"
            >
              📎 Add Card
            </button>
            <button
              onClick={() => setActiveCardIdForCreate('empty-stream')}
              className="btn btn-secondary btn-small"
              title="Create a new card in this brain"
            >
              ✨ Create Card
            </button>
          </div>
        </div>
      )}
      
      {/* Empty stream interfaces */}
      {streamCards.length === 0 && activeCardIdForAdd === 'empty-stream' && (
        <CardSearchInterface
          brainId={brainId}
          streamId={streamId}
          streamCards={[]}
          onCardSelected={(card) => handleInlineAddCard(card.id, null)}
          onCancel={handleCancelAdd}
        />
      )}
      
      {streamCards.length === 0 && activeCardIdForCreate === 'empty-stream' && (
        <CardCreateInterface
          brainId={brainId}
          onCardCreated={(card) => handleInlineCreateCard(card, null)}
          onCancel={handleCancelCreate}
        />
      )}
    </div>
  );
};

export default StreamView;