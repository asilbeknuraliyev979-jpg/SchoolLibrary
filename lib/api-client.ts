'use client';

const SESSION_STORAGE_KEY = 'sl_auth_session_token';

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null | undefined) {
  if (typeof window === 'undefined' || !token) return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // ignore storage restriction
  }
}

export function clearSessionToken() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const nextHeaders = new Headers(init.headers);
  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: nextHeaders,
  });
}
