import React from 'react';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';

interface CommandBarProps {
  streamId?: string;
}

const CommandBar: React.FC<CommandBarProps> = ({ streamId }) => {
  const { aiContextCards, clearAIContext, currentStream } = useApp();
  const { user } = useAuth();

  // Calculate estimated token count (rough estimation: ~4 chars per token)
  const estimatedTokens = Math.ceil(aiContextCards.length * 100); // Rough estimate

  return (
    <div className="app-command-bar">
      <div className="flex items-center gap-md">
        {/* Stream actions */}
        {streamId && (
          <>
            <button
              className="btn btn-small"
              disabled
              title="Stream settings (coming soon)"
            >
              Settings
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-md">
        {/* AI Context info */}
        <div className="flex items-center gap-sm">
          <span className="body-text" style={{ fontSize: '12px' }}>
            AI Context:
          </span>
          <span 
            className="body-text" 
            style={{ 
              fontSize: '12px', 
              fontWeight: 600,
              color: aiContextCards.length > 0 ? 'var(--ai-context-border)' : 'var(--text-primary)'
            }}
          >
            {aiContextCards.length} cards (~{estimatedTokens} tokens)
          </span>
          {aiContextCards.length > 0 && (
            <button
              onClick={clearAIContext}
              className="btn btn-small"
              style={{ fontSize: '10px', padding: '2px 6px' }}
              title="Clear AI context selection"
            >
              Clear
            </button>
          )}
        </div>

        {/* Storage info */}
        {user && (
          <div className="flex items-center gap-sm">
            <span className="body-text" style={{ fontSize: '12px', color: '#6b7280' }}>
              Storage: {Math.round((user.storageUsed / user.storageQuota) * 100)}% used
            </span>
          </div>
        )}

        {/* Stream info */}
        {currentStream && (
          <div className="flex items-center gap-sm">
            <span className="body-text" style={{ fontSize: '12px', color: '#6b7280' }}>
              {currentStream.isFavorited && '★ '}
              Last accessed: {new Date(currentStream.lastAccessedAt).toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Sync status */}
        <div className="flex items-center gap-sm">
          <span 
            className="body-text" 
            style={{ 
              fontSize: '12px', 
              color: '#22c55e',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ 
              width: '6px', 
              height: '6px', 
              borderRadius: '50%', 
              backgroundColor: '#22c55e' 
            }} />
            Synced
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommandBar;