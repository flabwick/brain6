import React, { useState, useEffect } from 'react';
import { Brain, Stream } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useApp } from '../contexts/AppContext';
import api from '../services/api';

interface HeaderProps {
  onBrainSelect: (brain: Brain) => void;
  onStreamSelect: (stream: Stream) => void;
  onNewStream: () => void;
}

const Header: React.FC<HeaderProps> = ({ onBrainSelect, onStreamSelect, onNewStream }) => {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [isLoadingBrains, setIsLoadingBrains] = useState(true);
  const [isLoadingStreams, setIsLoadingStreams] = useState(false);
  const { user, logout } = useAuth();
  const { selectedBrain, currentStream, setError } = useApp();

  useEffect(() => {
    loadBrains();
  }, []);

  useEffect(() => {
    if (selectedBrain) {
      loadStreams(selectedBrain.id);
    }
  }, [selectedBrain]);

  const loadBrains = async () => {
    try {
      setIsLoadingBrains(true);
      const response = await api.get('/brains');
      setBrains(response.data.data || []);
      
      // Auto-select first brain if none selected
      if (!selectedBrain && response.data.data?.length > 0) {
        onBrainSelect(response.data.data[0]);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to load brains';
      setError(errorMessage);
    } finally {
      setIsLoadingBrains(false);
    }
  };

  const loadStreams = async (brainId: string) => {
    try {
      setIsLoadingStreams(true);
      const response = await api.get(`/streams?brainId=${brainId}`);
      setStreams(response.data.data || []);
      
      // Auto-select first stream if none selected
      if (!currentStream && response.data.data?.length > 0) {
        onStreamSelect(response.data.data[0]);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to load streams';
      setError(errorMessage);
    } finally {
      setIsLoadingStreams(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      await logout();
    }
  };

  return (
    <header className="app-header">
      <div className="flex items-center gap-md">
        {/* Brain selector */}
        <div className="flex items-center gap-sm">
          <label htmlFor="brain-select" className="body-text" style={{ fontWeight: 500 }}>
            Brain:
          </label>
          <select
            id="brain-select"
            value={selectedBrain?.id || ''}
            onChange={(e) => {
              const brain = brains.find(b => b.id === e.target.value);
              if (brain) onBrainSelect(brain);
            }}
            className="form-input"
            style={{ minWidth: '200px' }}
            disabled={isLoadingBrains}
          >
            {isLoadingBrains ? (
              <option>Loading brains...</option>
            ) : brains.length === 0 ? (
              <option>No brains found</option>
            ) : (
              brains.map(brain => (
                <option key={brain.id} value={brain.id}>
                  {brain.title}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Stream selector */}
        <div className="flex items-center gap-sm">
          <label htmlFor="stream-select" className="body-text" style={{ fontWeight: 500 }}>
            Stream:
          </label>
          <select
            id="stream-select"
            value={currentStream?.id || ''}
            onChange={(e) => {
              const stream = streams.find(s => s.id === e.target.value);
              if (stream) onStreamSelect(stream);
            }}
            className="form-input"
            style={{ minWidth: '200px' }}
            disabled={isLoadingStreams || !selectedBrain}
          >
            {isLoadingStreams ? (
              <option>Loading streams...</option>
            ) : streams.length === 0 ? (
              <option>No streams found</option>
            ) : (
              streams.map(stream => (
                <option key={stream.id} value={stream.id}>
                  {stream.title}
                </option>
              ))
            )}
          </select>
        </div>

        <button
          onClick={onNewStream}
          className="btn btn-small"
          disabled={!selectedBrain}
          title="Create new stream"
        >
          New Stream
        </button>
      </div>

      <div className="flex items-center gap-md">
        {/* Current stream title */}
        {currentStream && (
          <h1 className="stream-title">
            {currentStream.title}
          </h1>
        )}

        {/* User info and logout */}
        <div className="flex items-center gap-sm">
          <span className="body-text" style={{ fontSize: '12px', color: '#6b7280' }}>
            {user?.username}
          </span>
          <button
            onClick={handleLogout}
            className="btn btn-small"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;