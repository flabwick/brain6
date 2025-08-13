import React, { useState, useEffect } from 'react';
import api from '../services/api';

interface FileViewerProps {
  file: any; // File data from stream
  streamId: string;
  brainId: string;
  depth?: number;
  onDelete: (fileId: string) => void;
  onMoveUp?: (fileId: string) => void;
  onMoveDown?: (fileId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
  // Control button handlers (same as Card component)
  onAddCardBelow?: (afterPosition: number) => void;
  onCreateCardBelow?: (afterPosition: number) => void;
  onGenerateCardBelow?: (afterPosition: number, prompt: string, model: string) => void;
  onUploadFileBelow?: (afterPosition: number) => void;
  onAddFileBelow?: (afterPosition: number) => void;
}

const FileViewer: React.FC<FileViewerProps> = ({
  file,
  streamId,
  brainId,
  depth = 0,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  onAddCardBelow,
  onCreateCardBelow,
  onGenerateCardBelow,
  onUploadFileBelow,
  onAddFileBelow,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    try {
      const response = await api.get(`/files/${file.id}/download`, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { 
        type: file.fileType === 'pdf' ? 'application/pdf' : 'application/epub+zip' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getFileIcon = () => {
    switch (file.fileType) {
      case 'pdf': return '📄';
      case 'epub': return '📚';
      default: return '📁';
    }
  };

  const getFileTypeColor = () => {
    switch (file.fileType) {
      case 'pdf': return '#dc2626'; // red
      case 'epub': return '#8b5cf6'; // purple
      default: return '#6b7280'; // gray
    }
  };

  return (
    <div className={`file-viewer ${file.fileType}-file ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* File Header - Always Visible */}
      <div className="file-viewer-header">
        <div 
          className="file-type-icon" 
          style={{ backgroundColor: `${getFileTypeColor()}15`, color: getFileTypeColor() }}
        >
          {getFileIcon()}
        </div>
        
        <div className="file-info-section">
          <h3 className="file-title">
            {file.title || file.fileName.replace(/\.(pdf|epub)$/i, '')}
          </h3>
          <div className="file-metadata-summary">
            <span 
              className="file-type-badge"
              style={{ backgroundColor: `${getFileTypeColor()}15`, color: getFileTypeColor() }}
            >
              {file.fileType.toUpperCase()}
            </span>
            {file.author && <span className="file-author">by {file.author}</span>}
            <span className="file-size">{formatFileSize(file.fileSize)}</span>
            {file.chapterCount && (
              <span className="file-chapters">{file.chapterCount} chapters</span>
            )}
            {file.pageCount && (
              <span className="file-pages">{file.pageCount} pages</span>
            )}
          </div>
        </div>

        <div className="file-controls">
          <button 
            className="file-control-btn expand-btn"
            onClick={handleToggleExpand}
            title={isExpanded ? "Close file view" : "Open file view"}
          >
            {isExpanded ? '📖' : '👁️'}
          </button>
          <button 
            className="file-control-btn download-btn"
            onClick={handleDownload}
            title="Download file"
          >
            📥
          </button>
          <button 
            className="file-control-btn delete-btn"
            onClick={() => onDelete(file.id)}
            title="Remove from stream"
          >
            🗑️
          </button>
          {onMoveUp && !isFirst && (
            <button 
              className="file-control-btn move-btn"
              onClick={() => onMoveUp(file.id)}
              title="Move up"
            >
              ⬆️
            </button>
          )}
          {onMoveDown && !isLast && (
            <button 
              className="file-control-btn move-btn"
              onClick={() => onMoveDown(file.id)}
              title="Move down"
            >
              ⬇️
            </button>
          )}
        </div>
      </div>
      
      {/* Expanded File Content */}
      {isExpanded && (
        <div className="file-viewer-content">
          {file.fileType === 'epub' && (
            <EPUBViewer file={file} />
          )}
          {file.fileType === 'pdf' && (
            <PDFViewer file={file} />
          )}
        </div>
      )}

      {/* Control Buttons - Always Visible at Bottom */}
      <div className="file-control-section">
        <div className="file-control-buttons">
          {onAddCardBelow && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onAddCardBelow(file.position)}
              title="Add existing card below this file"
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
          {onCreateCardBelow && (
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={() => onCreateCardBelow(file.position)}
              title="Create new card below this file"
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
          {onGenerateCardBelow && (
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => onGenerateCardBelow(file.position, '', '')} // Empty prompt/model for now
              title="Generate new card with AI below this file"
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              🤖 Generate Card
            </button>
          )}
          {onUploadFileBelow && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onUploadFileBelow(file.position)}
              title="Upload PDF or EPUB file below this file"
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#16a34a',
                color: 'white'
              }}
            >
              📁 Upload File
            </button>
          )}
          {onAddFileBelow && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onAddFileBelow(file.position)}
              title="Add existing file below this file"
              style={{ 
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: '#8b5cf6',
                color: 'white'
              }}
            >
              📚 Add File
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// EPUB Viewer Component
const EPUBViewer: React.FC<{ file: any }> = ({ file }) => {
  return (
    <div className="epub-viewer-portrait">
      <div className="epub-book-display">
        {/* Cover Image Column */}
        <div className="epub-cover-column">
          <div className="epub-cover-placeholder">
            <div className="cover-icon">📚</div>
            <div className="cover-text">
              <div className="cover-title">{file.title || file.fileName}</div>
              <div className="cover-author">{file.author || 'Unknown Author'}</div>
            </div>
          </div>
        </div>

        {/* Book Information Column */}
        <div className="epub-info-column">
          <div className="epub-title-section">
            <h2 className="epub-display-title">{file.title || file.fileName}</h2>
            <h3 className="epub-display-author">by {file.author || 'Unknown Author'}</h3>
          </div>

          <div className="epub-metadata-grid">
            <div className="metadata-row">
              <span className="metadata-label">Chapters:</span>
              <span className="metadata-value">{file.chapterCount || 'Unknown'}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">File Size:</span>
              <span className="metadata-value">{(file.fileSize / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Format:</span>
              <span className="metadata-value">EPUB</span>
            </div>
          </div>

          {/* Description */}
          {file.description && (
            <div className="epub-description">
              <h4>Description</h4>
              <div className="description-text">
                {file.description}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="epub-actions">
            <button 
              className="epub-action-btn primary" 
              onClick={() => {
                // Download handled by parent
                const event = new CustomEvent('download');
                document.dispatchEvent(event);
              }}
            >
              📥 Download EPUB
            </button>
            <button className="epub-action-btn secondary" disabled>
              📖 Read Online (Coming Soon)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// PDF Viewer Component
const PDFViewer: React.FC<{ file: any }> = ({ file }) => {
  return (
    <div className="pdf-viewer-portrait">
      <div className="pdf-viewer-container">
        <div className="pdf-viewer-header">
          <div className="pdf-file-info">
            <h3>{file.title || file.fileName}</h3>
            <div className="pdf-metadata">
              {file.author && <span>Author: {file.author}</span>}
              {file.pageCount && <span>Pages: {file.pageCount}</span>}
              <span>Size: {(file.fileSize / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          </div>
        </div>
        
        <div className="pdf-placeholder">
          <div className="pdf-icon">📄</div>
          <h4>PDF Viewer</h4>
          <p>Full PDF viewer coming soon</p>
          <button 
            className="pdf-action-btn primary"
            onClick={() => {
              // Download handled by parent
              const event = new CustomEvent('download');
              document.dispatchEvent(event);
            }}
          >
            📥 Download PDF
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileViewer;