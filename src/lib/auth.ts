const TOKEN_KEY = 'polski-trainer:token:v1';

/** Base URL for the API. Empty in local dev — same-origin fetch to the Vite
 *  middleware, unchanged from before. Set to the Render URL for production
 *  builds via VITE_API_URL. */
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Only a remote API needs a passphrase. Local dev (no VITE_API_URL) skips the gate entirely. */
export const AUTH_REQUIRED = API_BASE_URL !== '';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private browsing / storage disabled — falls back to re-prompting next load */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
