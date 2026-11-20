'use client';

const LEGACY_SESSION_STORAGE_KEY = 'sl_auth_session_token';

/**
 * Purges any legacy sessionStorage token left behind by earlier builds.
 * Active authentication now relies exclusively on HttpOnly + Secure + SameSite cookies.
 */
export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    window.localStorage.removeItem('school_library_session_token');
  } catch {
    // Ignore storage access errors in restricted browsing contexts
  }
}

// Run one-time cleanup when loaded in the browser
if (typeof window !== 'undefined') {
  clearSessionToken();
}

/**
 * Authenticated fetch wrapper relying strictly on HttpOnly session cookies (no JS-accessible tokens).
 */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
  });
}
