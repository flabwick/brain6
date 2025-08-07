import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Include cookies for session-based auth
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for error handling
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Don't redirect on 401 - let components handle authentication state
    // The AuthContext will manage redirects based on authentication status
    return Promise.reject(error);
  }
);

export default api;