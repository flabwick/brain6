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
  const [showAddCardInterface, setShowAddCardInterface] = useState(false);
  const [showCreateCardInterface, setShowCreateCardInterface] = useState(false);
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

  const handleAddExistingCard = async (cardId: string) => {
    try {
      // Add existing card to stream
      await api.post(`/streams/${streamId}/cards`, {
        cardId: cardId,
        position: streamCards.length,
        isInAIContext: false,
        isCollapsed: false
      });

      // Refresh the stream to show the newly added card
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to add card to stream';
      setGlobalError(errorMessage);
    }
  };

  const handleAddNewCard = async (card: CardType) => {
    try {
      // Add newly created card to stream
      await api.post(`/streams/${streamId}/cards`, {
        cardId: card.id,
        position: streamCards.length,
        isInAIContext: false,
        isCollapsed: false
      });

      // Refresh the stream to show the newly created card
      await loadStream();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to add card to stream';
      setGlobalError(errorMessage);
    }
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
      {streamCards.map((streamCard) => (
        <Card
          key={streamCard.id}
          card={streamCard}
          streamCard={streamCard}  
          streamId={streamId}
          onUpdate={handleUpdateCard}
          onDelete={handleDeleteCard}
          onToggleCollapse={handleToggleCollapse}
        />
      ))}

      {/* Card Search Interface */}
      {showAddCardInterface && (
        <CardSearchInterface
          brainId={brainId}
          streamId={streamId}
          streamCards={streamCards}
          onCardSelected={(card) => {
            // Add existing card to stream
            handleAddExistingCard(card.id);
            setShowAddCardInterface(false);
          }}
          onCancel={() => setShowAddCardInterface(false)}
        />
      )}

      {/* Card Creation Interface */}
      {showCreateCardInterface && (
        <CardCreateInterface
          brainId={brainId}
          onCardCreated={(card) => {
            // Add newly created card to stream
            handleAddNewCard(card);
            setShowCreateCardInterface(false);
          }}
          onCancel={() => setShowCreateCardInterface(false)}
        />
      )}

      {/* Add/Create Card Buttons */}
      {!showAddCardInterface && !showCreateCardInterface && (
        <div className="card" style={{ borderStyle: 'dashed', opacity: 0.7 }}>
          <div className="text-center" style={{ padding: '1rem' }}>
            <div style={{ marginBottom: '1rem', color: '#6b7280', fontSize: '14px' }}>
              Cards belong to the brain. Add existing cards to this stream or create new ones.
            </div>
            <div className="flex gap-md justify-center">
              <button
                onClick={() => setShowAddCardInterface(true)}
                className="btn btn-primary"
                title="Add an existing card from this brain to this stream"
              >
                Add Card to Stream
              </button>
              <button
                onClick={() => setShowCreateCardInterface(true)}
                className="btn btn-secondary"
                title="Create a new card in this brain and add it to this stream"
              >
                Create New Card
              </button>
            </div>
          </div>
        </div>
      )}

      {streamCards.length === 0 && !showAddCardInterface && !showCreateCardInterface && (
        <div className="text-center" style={{ padding: '2rem', color: '#6b7280' }}>
          <p>This stream is empty.</p>
          <p>Add your first card above to get started.</p>
        </div>
      )}
    </div>
  );
};

export default StreamView;