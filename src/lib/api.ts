import type { Example, ProgressMap, Vocabulary } from '../types';
import { API_BASE_URL, AUTH_REQUIRED, clearToken, getToken } from './auth';

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function json<T>(response: Response): Promise<T> {
  if (response.status === 401 && AUTH_REQUIRED) {
    // The stored passphrase is gone/rotated/never set — clear it and let
    // AuthGate re-prompt on the next load rather than limping along.
    clearToken();
    window.location.reload();
    throw new Error('Sesja wygasła — zaloguj się ponownie.');
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep status text */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function loadVocabulary(): Promise<Vocabulary> {
  return fetch(apiUrl('/api/vocabulary'), { headers: authHeaders() }).then((r) => json<Vocabulary>(r));
}

export function saveVocabulary(doc: Vocabulary): Promise<{ ok: boolean; entries: number }> {
  return fetch(apiUrl('/api/vocabulary'), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(doc),
  }).then((r) => json(r));
}

export function loadRemoteProgress(): Promise<ProgressMap> {
  return fetch(apiUrl('/api/progress'), { headers: authHeaders() }).then((r) => json<ProgressMap>(r));
}

/**
 * `keepalive` lets the final flush survive the page being closed — the browser
 * finishes the request after the tab is gone.
 */
export function saveRemoteProgress(map: ProgressMap, keepalive = false): Promise<unknown> {
  return fetch(apiUrl('/api/progress'), {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(map),
    keepalive,
  }).then((r) => json(r));
}

/** Asks the API to generate one example sentence and persist it. */
export function generateSentence(entryId: string): Promise<Example> {
  return fetch(apiUrl('/api/sentence'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ entryId }),
  }).then((r) => json<Example>(r));
}

export interface ServerStatus {
  sentenceApi: boolean;
  model: string;
  file?: string;
  progressFile?: string;
  storage?: string;
}

export function getStatus(): Promise<ServerStatus> {
  return fetch(apiUrl('/api/status'), { headers: authHeaders() }).then((r) => json<ServerStatus>(r));
}
