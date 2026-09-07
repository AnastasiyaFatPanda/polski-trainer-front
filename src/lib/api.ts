import type { Example, ProgressMap, Vocabulary } from '../types';

async function json<T>(response: Response): Promise<T> {
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
  return fetch('/api/vocabulary').then((r) => json<Vocabulary>(r));
}

export function saveVocabulary(doc: Vocabulary): Promise<{ ok: boolean; entries: number }> {
  return fetch('/api/vocabulary', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  }).then((r) => json(r));
}

export function loadRemoteProgress(): Promise<ProgressMap> {
  return fetch('/api/progress').then((r) => json<ProgressMap>(r));
}

/**
 * `keepalive` lets the final flush survive the page being closed — the browser
 * finishes the request after the tab is gone.
 */
export function saveRemoteProgress(map: ProgressMap, keepalive = false): Promise<unknown> {
  return fetch('/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(map),
    keepalive,
  }).then((r) => json(r));
}

/** Asks the dev server to generate one example sentence and persist it to disk. */
export function generateSentence(entryId: string): Promise<Example> {
  return fetch('/api/sentence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId }),
  }).then((r) => json<Example>(r));
}

export interface ServerStatus {
  sentenceApi: boolean;
  model: string;
  file: string;
  progressFile: string;
}

export function getStatus(): Promise<ServerStatus> {
  return fetch('/api/status').then((r) => json<ServerStatus>(r));
}
