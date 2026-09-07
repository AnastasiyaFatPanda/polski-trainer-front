import type { EntryProgress, ProgressMap } from '../types';

const KEY = 'polski-trainer:progress:v1';

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function saveProgress(map: ProgressMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota — progress is a nicety, not the source of truth */
  }
}

export function blank(): EntryProgress {
  return { correct: 0, wrong: 0, streak: 0, lastSeen: 0 };
}

export function record(map: ProgressMap, entryId: string, correct: boolean): ProgressMap {
  const prev = map[entryId] ?? blank();
  return {
    ...map,
    [entryId]: {
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      streak: correct ? prev.streak + 1 : 0,
      lastSeen: Date.now(),
    },
  };
}

/** 0 = never seen, 1 = answered right three times running. */
export function mastery(p: EntryProgress | undefined): number {
  if (!p) return 0;
  return Math.max(0, Math.min(1, p.streak / 3));
}

/**
 * Higher weight = more likely to be asked. New words rank high, words you keep
 * missing rank higher, and anything answered correctly today drops back.
 */
export function weight(p: EntryProgress | undefined): number {
  if (!p) return 6;
  const recencyHours = (Date.now() - p.lastSeen) / 3_600_000;
  const base = 1 + p.wrong * 2 - p.streak * 1.5;
  const rested = recencyHours > 12 ? 1.5 : recencyHours > 3 ? 1 : 0.3;
  return Math.max(0.4, base) * rested;
}
