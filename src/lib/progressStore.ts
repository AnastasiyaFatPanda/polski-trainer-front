import type { ProgressMap } from '../types';
import { loadRemoteProgress, saveRemoteProgress } from './api';
import { loadProgress, mergeProgress, sameProgress, saveProgress } from './progress';

/**
 * Keeps learning progress in two places with `data/progress.json` as the source
 * of truth and localStorage as a local cache:
 *
 *  - on load, the file and the local copy are merged (newer `lastSeen` per word
 *    wins) so a cleared cache or a different browser recovers everything, and a
 *    session done while the server was down is not lost either;
 *  - every answer writes localStorage immediately — cheap, synchronous, never
 *    loses more than the current keystroke;
 *  - the file write is debounced, so a 40-answer lesson is a handful of writes
 *    rather than forty, and is flushed when the page is hidden or closed.
 */

const SAVE_DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: ProgressMap | null = null;
let lastWritten: ProgressMap = {};
let remoteAvailable = true;

/** True once a load has seen the server; false means we are localStorage-only. */
export function isRemoteAvailable(): boolean {
  return remoteAvailable;
}

/**
 * Reconcile the file with this browser's copy. Returns the merged map, already
 * persisted to both sides. Never throws — a missing server falls back to local.
 */
export async function loadMergedProgress(): Promise<ProgressMap> {
  const local = loadProgress();
  let remote: ProgressMap;
  try {
    remote = await loadRemoteProgress();
    remoteAvailable = true;
  } catch {
    remoteAvailable = false;
    lastWritten = local;
    return local;
  }

  const merged = mergeProgress(remote, local);
  lastWritten = merged;
  if (!sameProgress(merged, local)) saveProgress(merged);
  if (!sameProgress(merged, remote)) {
    // This browser knew something the file didn't — push it back.
    void saveRemoteProgress(merged).catch(() => {
      remoteAvailable = false;
    });
  }
  return merged;
}

async function writeNow(keepalive = false): Promise<void> {
  if (!pending) return;
  const map = pending;
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (sameProgress(map, lastWritten)) return;
  try {
    await saveRemoteProgress(map, keepalive);
    lastWritten = map;
    remoteAvailable = true;
  } catch {
    remoteAvailable = false;
    // Keep it queued so the next flush retries.
    pending = map;
  }
}

/** Record progress: localStorage now, the file shortly after. */
export function queueSaveProgress(map: ProgressMap): void {
  saveProgress(map);
  pending = map;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void writeNow(), SAVE_DEBOUNCE_MS);
}

/** Write immediately — end of a session, or the page going away. */
export function flushProgress(keepalive = false): Promise<void> {
  return writeNow(keepalive);
}

/** Replace everything, both sides, without debouncing. */
export async function resetProgress(): Promise<void> {
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saveProgress({});
  lastWritten = {};
  try {
    await saveRemoteProgress({});
  } catch {
    remoteAvailable = false;
  }
}

/** Flush on the way out so the last answers of a session always land. */
export function installProgressFlush(): () => void {
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void writeNow(true);
  };
  const onPageHide = (): void => void writeNow(true);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
}
