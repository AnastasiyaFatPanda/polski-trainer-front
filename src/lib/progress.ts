import type { EntryProgress, ProgressFilter, ProgressMap } from '../types';

/**
 * The single definition of what "opanowane" and "do powtórki" mean — the stat
 * tiles, the słownik filter and the training pool all read them from here.
 */
export const PROGRESS_FILTER_LABELS: Record<ProgressFilter, string> = {
  all: 'Wszystkie',
  new: 'Nowe',
  practiced: 'Już ćwiczone',
  mastered: 'Opanowane',
  review: 'Do powtórki',
};

export function matchesProgress(filter: ProgressFilter, p: EntryProgress | undefined): boolean {
  switch (filter) {
    case 'new':
      return !p?.lastSeen;
    case 'practiced':
      return Boolean(p?.lastSeen);
    case 'mastered':
      return mastery(p) >= 1;
    case 'review':
      return Boolean(p && p.wrong > p.correct);
    case 'all':
    default:
      return true;
  }
}

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

/**
 * Merge two progress maps. Per word the record with the newer `lastSeen` wins
 * wholesale — never field-by-field, which would double-count answers.
 *
 * Used to reconcile `data/progress.json` (durable, shared) with localStorage
 * (this browser). On a tie the first argument keeps its record, so callers pass
 * the file first: identical timestamps mean identical records anyway.
 */
export function mergeProgress(base: ProgressMap, incoming: ProgressMap): ProgressMap {
  const out: ProgressMap = { ...base };
  for (const [id, record] of Object.entries(incoming)) {
    const existing = out[id];
    if (!existing || record.lastSeen > existing.lastSeen) out[id] = record;
  }
  return out;
}

/** True when the two maps hold the same records — used to skip pointless writes. */
export function sameProgress(a: ProgressMap, b: ProgressMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((id) => {
    const x = a[id];
    const y = b[id];
    return (
      y !== undefined &&
      x.correct === y.correct &&
      x.wrong === y.wrong &&
      x.streak === y.streak &&
      x.lastSeen === y.lastSeen
    );
  });
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
