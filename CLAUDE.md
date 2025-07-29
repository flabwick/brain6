# Clarity: Knowledge Management & AI Prompting Software - Full Technical Specification

## 1. Product Overview

Clarity is a web-based knowledge management application that organizes information into "brains" containing "streams" of interconnected "cards." The system enables natural, stream-of-consciousness interaction with documents and AI, moving beyond traditional file-based organization.

### 1.1 Core Metaphors

- **Folders**: Organizational containers for users and brains in the file system
- **Brains**: Persistent knowledge bases containing all cards and files
- **Streams**: Temporary, tab-like views showing selected cards in sequence
- **Cards**: Individual pieces of content that can be text, prompts, or interfaces

## 2. System Architecture

### 2.1 Data Hierarchy

```
File System
├── Users (folders)
│   └── Brains (folders)
│       ├── Cards (with versions)
│       ├── Files (EPUB, PDF)
│       ├── Prompts (reusable)
│       └── Streams (temporary views)
│           └── StreamCards (ordered references)
```

### 2.2 Technology Stack

**Frontend:**
- React with TypeScript
- Responsive design for mobile/desktop web browsers
- Markdown rendering library (react-markdown)
- File upload handling
- Real-time token counting

**Backend:**
- Node.js/Express
- PostgreSQL database
- VPS file system storage with SSH access
- AI API integration (OpenAI, Anthropic, etc.)
- WebSocket support for sync
- File system monitoring for external imports

**Authentication & Storage:**
- User account system
- Cross-device synchronization
- File size limits and storage tracking
- Last-write-wins conflict resolution
- SSH-based file import system

### 2.3 File System Integration

**Direct Import Capabilities:**
- SSH access to VPS file system
- IDE-based file upload to user/brain folders
- Automatic file discovery and card creation
- Real-time sync between file system and database
- Support for bulk imports via file system operations

## 3. Core Data Models

### 3.1 User

```typescript
interface User {
  id: string
  username: string
  email: string
  folderPath: string // /users/{username}
  storageQuota: number
  storageUsed: number
  createdAt: Date
  updatedAt: Date
}
```

### 3.2 Brain

```typescript
interface Brain {
  id: string
  userId: string
  title: string
  folderPath: string // /users/{username}/brains/{brain-title}
  createdAt: Date
  updatedAt: Date
  storageUsed: number // bytes
}
```

### 3.3 Card

```typescript
interface Card {
  id: string
  brainId: string
  title: string // unique within brain
  currentVersionId: string
  filePath?: string // optional path if imported from file system
  createdAt: Date
  updatedAt: Date
}

interface CardVersion {
  id: string
  cardId: string
  versionNumber: number
  content: string // markdown
  isActive: boolean
  createdAt: Date
}
```

### 3.4 Stream

```typescript
interface Stream {
  id: string
  brainId: string
  title: string
  isFavorited: boolean
  createdAt: Date
  lastAccessedAt: Date
}

interface StreamCard {
  id: string
  streamId: string
  cardId: string
  position: number
  isInAIContext: boolean
  isCollapsed: boolean
  addedAt: Date
}
```

### 3.5 Card Links

```typescript
interface CardLink {
  id: string
  sourceCardId: string
  targetCardId: string
  linkText: string // the text inside [[]]
  createdAt: Date
}
```

### 3.6 Prompts

```typescript
interface Prompt {
  id: string
  brainId: string
  title: string
  content: string // with [[]] placeholders
  createdAt: Date
  updatedAt: Date
}
```

### 3.7 Files

```typescript
interface File {
  id: string
  brainId: string
  fileName: string
  fileType: 'epub' | 'pdf' | 'txt' | 'md' | 'other'
  fileSize: number
  filePath: string // actual file system path
  uploadedAt: Date
  importMethod: 'web_upload' | 'ssh_import' | 'ide_upload'
}
```

## 4. File System Management

### 4.1 Folder Structure

**User Organization:**
- Each user has a dedicated folder: `/users/{username}/`
- Brains are subfolders: `/users/{username}/brains/{brain-title}/`
- Files and cards can be organized within brain folders

### 4.2 Import Methods

**Web Upload:**
- Traditional drag-and-drop file upload
- Files stored in appropriate brain folder
- Automatic card creation from file content

**SSH Import:**
- Direct file placement via SSH into user/brain folders
- File system monitoring detects new files
- Automatic sync and card creation
- Preserves original file structure

**IDE Upload:**
- Direct upload through development environment
- Batch file operations supported
- Maintains file metadata and timestamps

### 4.3 File System Monitoring

**Real-time Sync:**
- File system watchers detect changes
- New files automatically processed into cards
- Modified files trigger card version updates
- Deleted files marked as inactive (soft delete)

**Sync Process:**
1. File system change detected
2. File metadata extracted
3. Content parsed and processed
4. Card created or updated in database
5. Stream references updated if applicable
6. WebSocket notification sent to connected clients

## 5. User Interface Specification

### 5.1 Main Layout

- **Header**: Brain selector, stream title, settings, import status
- **Stream View**: Vertical column of cards
- **Footer**: AI context token counter, storage usage, sync status

### 5.2 Import Interface

**Import Status Panel:**
- Recently imported files
- Import queue status
- SSH connection status
- File system sync indicators

**Import Options:**
- Web upload interface
- SSH import instructions
- IDE integration guide
- Batch import tools

### 5.3 Card Interface

#### 5.3.1 Card States
- **Collapsed**: Shows only title and controls
- **Expanded**: Shows full content with markdown rendering
- **Edit Mode**: Raw markdown editing interface

#### 5.3.2 Card Controls

**Bottom Controls** (add content below card):
- Create New Card
- Add Existing Card
- Generate AI Card
- Add File Interface
- Import from File System

**Side Controls:**
- Rewrite (create new version)
- Open to Side
- View Original File (if imported)
- All bottom controls available for side placement

**Card Header:**
- Title (clickable to expand/collapse)
- AI Context Toggle (checkbox icon)
- Edit Button
- Import Source Indicator
- Card Options Menu

#### 5.3.3 Card Content
- Markdown rendering in view mode
- Raw markdown editing in edit mode
- Inline card embedding via `[[card-title]]` syntax
- Embedded cards show as collapsed subheadings by default
- File source links for imported content

### 5.4 AI Context System

#### 5.4.1 Context Selection
- Each card has toggle for inclusion in AI context
- Real-time token counter in footer
- Visual indicators for selected cards

#### 5.4.2 AI Generation Interface
When "Generate AI Card" is clicked:
- Prompt selection dropdown (search + create new)
- Model selection with token limits shown
- Substitute resolution for `[[substitute]]` placeholders
- Generate button

#### 5.4.3 Prompt System
- Brain-wide prompt library
- Prompts contain `[[card-title]]` for direct links
- Prompts contain `[[substitute]]` for user-provided cards
- Substitutes autocomplete from card titles in current brain
- Cross-brain card references: `[[other-brain-title/card-title]]`

### 5.5 File Processing Interface

#### 5.5.1 File Upload
- Drag-and-drop or click to upload
- EPUB, PDF, and text file support
- File size validation against storage limits
- SSH import instructions and status

#### 5.5.2 File Splitting Interface
Appears as card-like interface in stream:
- Preview of file content
- Splitting options:
  - By chapters/sections
  - By word count
  - By token count
  - By custom page ranges
- Generate Cards button creates individual cards
- Original file reference maintained

### 5.6 Stream Management

#### 5.6.1 Stream Navigation
- Stream history (like browser tabs)
- Favorite/unfavorite streams
- Create new stream
- Stream search

#### 5.6.2 Cross-Brain Access
- Add cards from other brains to current stream
- Cards maintain origin brain identity
- Option to duplicate card to current brain vs. reference

## 6. Core Features Specification

### 6.1 Card Management

#### 6.1.1 Card Creation
- Manual creation with title and content
- AI generation from prompts and context
- File splitting into multiple cards
- Card duplication with new versions
- Automatic creation from imported files

#### 6.1.2 Card Editing
- Inline markdown editing
- Save to brain permanently
- Add to AI context
- Remove from stream (with brain removal option)
- Edit imported file cards with version tracking

#### 6.1.3 Card Linking
- `[[card-title]]` syntax for linking
- Automatic card embedding in content
- Click embedded cards to expand inline
- "Open in new stream" option for any card

#### 6.1.4 Card Versioning
- Manual version creation via "Rewrite" function
- Version history per card
- Default linking to latest version
- Specific version linking: `[[card-title:v2]]`
- Automatic versioning for updated imported files

### 6.2 Import System

#### 6.2.1 File System Integration
- Real-time monitoring of user/brain folders
- Automatic card creation from new files
- Preservation of file metadata and structure
- Support for nested folder organization

#### 6.2.2 Import Processing
- Content extraction from various file formats
- Automatic title generation from filenames
- Metadata preservation (creation date, file path, etc.)
- Batch processing for multiple files

#### 6.2.3 Sync Management
- Conflict resolution for simultaneous edits
- File system change detection
- Database synchronization
- Error handling and retry mechanisms

### 6.3 Stream Operations

#### 6.3.1 Card Organization
- Drag-and-drop reordering (future feature)
- Add cards at any position in stream
- Nested card support through linking
- Multiple parent card relationships

#### 6.3.2 Stream States
- Persistent stream history
- Last accessed tracking
- Favoriting system
- Cross-device synchronization

### 6.4 AI Integration

#### 6.4.1 Context Management
- Token counting across selected cards
- Real-time context updates
- Model-specific token limits
- Context optimization suggestions

#### 6.4.2 Prompt Execution
- Template variable resolution
- Cross-brain card substitution
- Multiple AI model support
- Generated card placement control

### 6.5 File Processing

#### 6.5.1 EPUB Processing
- Text extraction and structure parsing
- Chapter-based splitting
- Metadata preservation
- Image handling for illustrated books

#### 6.5.2 PDF Processing
- Text extraction with OCR fallback
- Page-based or section-based splitting
- Image extraction as separate cards
- Text-to-image card linking

#### 6.5.3 Text File Processing
- Markdown file support
- Plain text processing
- Code file syntax preservation
- Automatic format detection

## 7. Technical Implementation Details

### 7.1 Data Storage

#### 7.1.1 Database Schema
- PostgreSQL with JSON fields for flexible content
- Efficient querying for card relationships
- Version history with soft deletes
- Full-text search capabilities
- File path indexing for import tracking

#### 7.1.2 File Storage
- VPS file system storage
- Organized folder structure per user/brain
- Direct SSH access for imports
- File integrity monitoring
- Storage quota enforcement

### 7.2 File System Integration

#### 7.2.1 Monitoring System
- File system watchers (inotify/fsevents)
- Change detection and processing queue
- Batch processing for multiple changes
- Error handling and logging

#### 7.2.2 SSH Access
- Secure SSH key management
- User-specific access controls
- File permission management
- Connection monitoring and logging

### 7.3 Synchronization

#### 7.3.1 Conflict Resolution
- Last-write-wins for card content
- Timestamp-based conflict detection
- Graceful handling of concurrent edits
- Sync status indicators

#### 7.3.2 Real-time Updates
- WebSocket connections for live updates
- File system change propagation
- Cross-device synchronization
- Offline support with sync queues

### 7.4 Performance Optimization

#### 7.4.1 Loading Strategies
- Lazy loading for large streams
- Card content pagination
- Efficient markdown parsing
- Image optimization

#### 7.4.2 Search and Indexing
- Full-text search across cards
- File content indexing
- Real-time search suggestions
- Search result ranking
- Cross-brain search capabilities

## 8. Security and Privacy

### 8.1 Authentication
- Secure user registration/login
- Session management
- Password security requirements
- Account recovery system

### 8.2 Data Protection
- Encrypted data storage
- Secure file system access
- SSH key security
- API rate limiting
- Input sanitization

### 8.3 File System Security
- User-specific folder permissions
- SSH access controls
- File integrity verification
- Secure import processing

### 8.4 AI Integration Security
- API key management
- Request rate limiting
- Content filtering
- Usage tracking and limits

## 9. Storage and Limits

### 9.1 Storage Management
- Per-user storage quotas
- Real-time usage tracking
- File system monitoring
- Storage optimization suggestions
- Cleanup of unused files

### 9.2 Performance Limits
- Maximum cards per stream
- File size restrictions
- Import queue limits
- API request throttling
- Token usage limits

## 10. MVP Feature Priority

### 10.1 Core MVP (Phase 1)
- Brain and stream creation with folder structure
- Text cards with markdown support
- Basic file system import via SSH
- Card linking and embedding
- Basic AI context selection
- Simple prompt system
- Card versioning
- Cross-device sync

### 10.2 Extended MVP (Phase 2)
- Advanced file upload and processing
- Real-time file system monitoring
- IDE integration tools
- Advanced prompt features
- Multiple AI model support
- Stream history and favorites
- Cross-brain card access
- Storage management

### 10.3 Future Features (Phase 3)
- Drag-and-drop reordering
- Side-by-side card viewing
- Advanced search and filtering
- Backlink visualization
- Export capabilities
- Collaboration features
- Advanced import tools

## 11. API Specification

### 11.1 REST Endpoints
- `/api/users` - User and folder management
- `/api/brains` - Brain CRUD operations
- `/api/streams` - Stream management
- `/api/cards` - Card operations
- `/api/prompts` - Prompt library
- `/api/files` - File upload/processing
- `/api/import` - Import management and status
- `/api/ai` - AI generation requests

### 11.2 WebSocket Events
- Card content updates
- Stream modifications
- File system changes
- Import status updates
- Real-time sync events
- Connection status

### 11.3 Import API
- `/api/import/status` - Import queue and processing status
- `/api/import/trigger` - Manual import trigger
- `/api/import/history` - Import history and logs
- `/api/import/ssh` - SSH connection management

## 12. File System Structure Example

```
/clarity-data/
├── users/
│   ├── john-doe/
│   │   ├── brains/
│   │   │   ├── research-notes/
│   │   │   │   ├── papers/
│   │   │   │   │   ├── ai-safety.pdf
│   │   │   │   │   └── machine-learning.epub
│   │   │   │   ├── notes/
│   │   │   │   │   ├── meeting-notes.md
│   │   │   │   │   └── ideas.txt
│   │   │   │   └── .clarity/
│   │   │   │       ├── cards.json
│   │   │   │       └── streams.json
│   │   │   └── personal/
│   │   │       ├── documents/
│   │   │       └── .clarity/
│   │   └── .user-config
│   └── jane-smith/
│       └── brains/
│           └── work-projects/
└── system/
    ├── templates/
    ├── logs/
    └── backups/
```

This specification provides a comprehensive foundation for building Clarity with integrated file system support, enabling seamless import and synchronization of content through multiple channels while maintaining the core knowledge management functionality.