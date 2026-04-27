import axios from 'axios';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';

/**
 * Auth tokens live in httpOnly cookies issued by the backend. We send them
 * automatically by setting `withCredentials` on every request — the browser
 * attaches `eavesight_access` and `eavesight_refresh` to same-origin
 * /api/* calls, and Next.js's rewrite forwards them to the NestJS backend.
 *
 * No `Authorization` header is set, no `localStorage.getItem('token')`
 * anywhere — XSS can't exfiltrate what JS can't read.
 */
export const api = axios.create({
  baseURL: apiUrl || undefined,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Refresh-on-401 retry. On 401 we POST /auth/refresh with no body — the
// browser's eavesight_refresh cookie is the credential. The server rotates
// both cookies and we replay the original request (cookie also rotated).
let isRefreshing = false;
let failedQueue: Array<{ resolve: () => void; reject: (error: any) => void }> = [];

const processQueue = (error: any) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve();
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't retry the auth endpoints themselves.
      if (
        originalRequest.url?.includes('/auth/login') ||
        originalRequest.url?.includes('/auth/register') ||
        originalRequest.url?.includes('/auth/refresh')
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<void>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // No body — cookie carries the refresh token.
        await axios.post(`${apiUrl}/auth/refresh`, {}, { withCredentials: true });
        processQueue(null);
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
