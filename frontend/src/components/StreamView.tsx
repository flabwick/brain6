import React, { useState, useEffect } from 'react';
import Card from './Card';
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
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
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
      setStream(streamResponse.data.data);

      // Load stream cards
      const cardsResponse = await api.get(`/streams/${streamId}/cards`);
      setStreamCards(cardsResponse.data.data || []);
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
      
      // Update the card in streamCards
      setStreamCards(prev => prev.map(sc => 
        sc.card?.id === cardId 
          ? { ...sc, card: { ...sc.card, ...updates } }
          : sc
      ));
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to update card';
      setGlobalError(errorMessage);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      // Find the stream card to remove
      const streamCard = streamCards.find(sc => sc.card?.id === cardId);
      if (!streamCard) return;

      await api.delete(`/streams/${streamId}/cards/${streamCard.id}`);
      
      // Remove from local state
      setStreamCards(prev => prev.filter(sc => sc.card?.id !== cardId));
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to delete card';
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

      // Update local state
      setStreamCards(prev => prev.map(sc => 
        sc.id === streamCardId 
          ? { ...sc, isCollapsed: newCollapsedState }
          : sc
      ));
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to toggle card collapse';
      setGlobalError(errorMessage);
    }
  };

  const handleAddCard = async () => {
    if (!newCardTitle.trim()) return;

    try {
      setIsAddingCard(true);

      // Create the card
      const cardResponse = await api.post('/cards', {
        title: newCardTitle.trim(),
        content: '',
        brainId: brainId
      });

      const newCard = cardResponse.data.data;

      // Add card to stream
      const streamCardResponse = await api.post(`/streams/${streamId}/cards`, {
        cardId: newCard.id,
        position: streamCards.length,
        isInAIContext: false,
        isCollapsed: false
      });

      const newStreamCard = streamCardResponse.data.data;
      newStreamCard.card = newCard;

      // Update local state
      setStreamCards(prev => [...prev, newStreamCard]);
      setNewCardTitle('');
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to add card';
      setGlobalError(errorMessage);
    } finally {
      setIsAddingCard(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddCard();
    }
    if (e.key === 'Escape') {
      setNewCardTitle('');
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

  return (
    <div className="stream-view">
      {/* Stream cards */}
      {streamCards.map((streamCard) => (
        streamCard.card && (
          <Card
            key={streamCard.id}
            card={streamCard.card}
            streamCard={streamCard}
            streamId={streamId}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onToggleCollapse={handleToggleCollapse}
          />
        )
      ))}

      {/* Add new card interface */}
      <div className="card" style={{ borderStyle: 'dashed', opacity: 0.7 }}>
        <div className="form-group">
          <input
            type="text"
            value={newCardTitle}
            onChange={(e) => setNewCardTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            className="form-input"
            placeholder="Enter card title and press Enter..."
            disabled={isAddingCard}
          />
        </div>
        <div className="flex gap-sm">
          <button
            onClick={handleAddCard}
            className="btn btn-primary btn-small"
            disabled={!newCardTitle.trim() || isAddingCard}
          >
            {isAddingCard ? (
              <>
                <span className="loading-spinner" />
                Adding...
              </>
            ) : (
              'Add Card'
            )}
          </button>
          {newCardTitle && (
            <button
              onClick={() => setNewCardTitle('')}
              className="btn btn-small"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {streamCards.length === 0 && !newCardTitle && (
        <div className="text-center" style={{ padding: '2rem', color: '#6b7280' }}>
          <p>This stream is empty.</p>
          <p>Add your first card above to get started.</p>
        </div>
      )}
    </div>
  );
};

export default StreamView;