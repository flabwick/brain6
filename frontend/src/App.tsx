import React, { useEffect, useRef } from 'react';
import './App.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppProvider, useApp } from './contexts/AppContext';
import Login from './components/Login';
import Header from './components/Header';
import StreamView from './components/StreamView';
import CommandBar from './components/CommandBar';
import { Brain, Stream } from './types';
import api from './services/api';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { selectedBrain, currentStream, setBrain, setStream, setError } = useApp();
  const addCardRef = useRef<(() => void) | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'n':
            e.preventDefault();
            if (addCardRef.current) {
              addCardRef.current();
            }
            break;
          default:
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBrainSelect = (brain: Brain) => {
    setBrain(brain);
    setStream(null); // Clear current stream when changing brains
  };

  const handleStreamSelect = (stream: Stream) => {
    setStream(stream);
  };

  const handleNewStream = async () => {
    if (!selectedBrain) return;

    try {
      const title = prompt('Enter stream title:');
      if (!title?.trim()) return;

      const response = await api.post('/streams', {
        brainId: selectedBrain.id,
        title: title.trim(),
        isFavorited: false
      });

      const newStream = response.data.data;
      setStream(newStream);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to create stream';
      setError(errorMessage);
    }
  };

  const handleAddCard = () => {
    // This will be called by keyboard shortcut
    // The actual add card functionality is handled in StreamView
    const addCardInput = document.querySelector('input[placeholder*="Enter card title"]') as HTMLInputElement;
    if (addCardInput) {
      addCardInput.focus();
    }
  };

  // Set up the ref for keyboard shortcuts
  useEffect(() => {
    addCardRef.current = handleAddCard;
  }, []);

  if (authLoading) {
    return (
      <div className="app">
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh' 
        }}>
          <div style={{ textAlign: 'center' }}>
            <span className="loading-spinner" style={{ width: '32px', height: '32px' }} />
            <p style={{ marginTop: '1rem' }}>Loading Clarity...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
        <Login />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        onBrainSelect={handleBrainSelect}
        onStreamSelect={handleStreamSelect}
        onNewStream={handleNewStream}
      />
      
      <main className="app-main">
        <div className="app-content">
          {selectedBrain && currentStream ? (
            <StreamView
              streamId={currentStream.id}
              brainId={selectedBrain.id}
            />
          ) : selectedBrain ? (
            <div className="text-center" style={{ padding: '2rem' }}>
              <p>Select a stream or create a new one to get started.</p>
              <button 
                onClick={handleNewStream}
                className="btn btn-primary"
              >
                Create New Stream
              </button>
            </div>
          ) : (
            <div className="text-center" style={{ padding: '2rem' }}>
              <p>Loading your brains...</p>
            </div>
          )}
        </div>
      </main>

      <CommandBar
        streamId={currentStream?.id}
        onAddCard={handleAddCard}
      />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
};

export default App;