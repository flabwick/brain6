import React, { useState, useEffect } from 'react';
import { Brain, Stream, Card } from '../types';
import { useApp } from '../contexts/AppContext';
import api from '../services/api';
import BrainList from './BrainList';
import BrainManagement from './BrainManagement';

interface BrainInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
  onBrainSelect: (brain: Brain) => void;
  onStreamSelect: (stream: Stream) => void;
  initialBrain?: Brain | null; // Optional: if provided, opens directly to this brain's management
}

type View = 'brain-list' | 'brain-management';

const BrainInterface: React.FC<BrainInterfaceProps> = ({
  isOpen,
  onClose,
  onBrainSelect,
  onStreamSelect,
  initialBrain,
}) => {
  const [view, setView] = useState<View>('brain-list');
  const [selectedBrain, setSelectedBrain] = useState<Brain | null>(null);
  const [brains, setBrains] = useState<Brain[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { setError } = useApp();

  useEffect(() => {
    if (isOpen) {
      loadBrains();
      
      // If initialBrain is provided, set up the view to show that brain's management
      if (initialBrain) {
        setSelectedBrain(initialBrain);
        setView('brain-management');
      } else {
        setSelectedBrain(null);
        setView('brain-list');
      }
    }
  }, [isOpen, initialBrain]);

  // No longer needed for non-modal interface

  const loadBrains = async () => {
    try {
      setIsLoading(true);
      const response = await api.get('/brains');
      setBrains(response.data.brains || []);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to load brains';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBrainSelect = (brain: Brain) => {
    setSelectedBrain(brain);
    setView('brain-management');
  };

  const handleStreamSelect = (stream: Stream) => {
    onStreamSelect(stream);
    onClose();
  };

  const handleBrainChange = (brain: Brain) => {
    onBrainSelect(brain);
    onClose();
  };

  const handleBackToBrainList = () => {
    setView('brain-list');
    setSelectedBrain(null);
  };

  const handleCreateBrain = async (title: string) => {
    try {
      setIsLoading(true);
      const response = await api.post('/brains', { name: title });
      const newBrain = response.data.brain;
      setBrains([...brains, newBrain]);
      setSelectedBrain(newBrain);
      setView('brain-management');
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to create brain';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenameBrain = async (brain: Brain, newTitle: string) => {
    try {
      await api.put(`/brains/${brain.id}`, { name: newTitle });
      setBrains(brains.map(b => 
        b.id === brain.id ? { ...b, name: newTitle } as any : b
      ));
      // If this is the currently selected brain, update it too
      if (selectedBrain?.id === brain.id) {
        setSelectedBrain({ ...selectedBrain, name: newTitle } as any);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || 'Failed to rename brain';
      setError(errorMessage);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="brain-interface">
      <div className="brain-interface-header">
        <h1>
          {view === 'brain-list' ? 'Brains' : (selectedBrain as any)?.name || selectedBrain?.title}
        </h1>
        <button
          type="button"
          className="brain-interface-close"
          onClick={onClose}
          title="Back to Stream"
        >
          ← Back to Stream
        </button>
      </div>

      <div className="brain-interface-content">
        {view === 'brain-list' ? (
          <BrainList
            brains={brains}
            isLoading={isLoading}
            onBrainSelect={handleBrainSelect}
            onCreateBrain={handleCreateBrain}
            onRenameBrain={handleRenameBrain}
          />
        ) : selectedBrain ? (
          <BrainManagement
            brain={selectedBrain}
            onStreamSelect={handleStreamSelect}
            onBrainSelect={handleBrainChange}
            onBack={handleBackToBrainList}
          />
        ) : null}
      </div>
    </div>
  );
};

export default BrainInterface;