import axios from 'axios';
import { router } from '@/router/index';
import { getActivePinia } from 'pinia';
import { useAuthStore } from '@/stores/auth';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// Token có thể nằm ở localStorage (ghi nhớ) hoặc sessionStorage (phiên tạm).
function readToken(): string | null {
  return localStorage.getItem('token') || sessionStorage.getItem('token');
}

// JWT interceptor
api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const currentToken = readToken();
      const sentToken = error.config?.headers?.Authorization ?? error.config?.headers?.authorization;
      // A delayed response from an older/anonymous request must not log out a new session.
      if (currentToken && error.config && sentToken !== `Bearer ${currentToken}`) {
        return Promise.reject(error);
      }
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      const pinia = getActivePinia();
      if (pinia) useAuthStore(pinia).logout();
      // Use Vue Router instead of hard reload to prevent redirect loops
      const currentPath = router.currentRoute.value.path;
      if (currentPath !== '/login' && currentPath !== '/setup') {
        router.replace('/login');
      }
    }
    return Promise.reject(error);
  },
);

export { api, readToken };
