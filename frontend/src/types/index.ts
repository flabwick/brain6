// User types
export interface User {
  id: string;
  username: string;
  email: string;
  folderPath: string;
  storageQuota: number;
  storageUsed: number;
  createdAt: string;
  updatedAt: string;
}

// Brain types
export interface Brain {
  id: string;
  userId: string;
  title: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  storageUsed: number;
}

// Card types
export interface Card {
  id: string;
  brainId: string;
  title: string;
  currentVersionId: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
  content?: string; // From current version
}

export interface CardVersion {
  id: string;
  cardId: string;
  versionNumber: number;
  content: string;
  isActive: boolean;
  createdAt: string;
}

// Stream types
export interface Stream {
  id: string;
  brainId: string;
  title: string;
  isFavorited: boolean;
  createdAt: string;
  lastAccessedAt: string;
}

export interface StreamCard {
  id: string;
  streamId: string;
  cardId: string;
  position: number;
  isInAIContext: boolean;
  isCollapsed: boolean;
  addedAt: string;
  card?: Card; // Populated when fetching stream cards
}

// Card links
export interface CardLink {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  linkText: string;
  createdAt: string;
}

// Authentication types
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// UI State types
export interface AppState {
  selectedBrain: Brain | null;
  currentStream: Stream | null;
  aiContextCards: string[]; // Array of card IDs
  isLoading: boolean;
  error: string | null;
}

// API Response types
export interface ApiResponse<T = any> {
  data: T;
  success: boolean;
  message?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}