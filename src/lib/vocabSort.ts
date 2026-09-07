import type { VocabEntry } from '../types';

export type SortMode = 'newest' | 'oldest' | 'alpha';

export const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Najnowsze',
  oldest: 'Najstarsze',
  alpha: 'A → Ż',
};

/**
 * Rank entries by when they were added.
 *
 * `addedAt` is stamped on everything created from now on. Entries that predate
 * the field fall back to their position in the vocabulary file, which *is*
 * insertion order — both manual adds and CSV imports append. The offset keeps
 * every timestamped entry above every untimestamped one, which is correct:
 * anything carrying a stamp was added after the whole legacy block.
 */
export function addedRank(entries: VocabEntry[]): Map<string, number> {
  const OFFSET = 1e12;
  const rank = new Map<string, number>();
  entries.forEach((entry, index) => {
    const stamped = entry.addedAt ? Date.parse(entry.addedAt) : Number.NaN;
    rank.set(entry.id, Number.isNaN(stamped) ? index : OFFSET + stamped);
  });
  return rank;
}

/** Sort a filtered subset. `rank` must be built from the full entry list. */
export function sortEntries(
  entries: VocabEntry[],
  mode: SortMode,
  rank: Map<string, number>,
): VocabEntry[] {
  const out = [...entries];
  if (mode === 'alpha') {
    return out.sort((a, b) => a.pl.localeCompare(b.pl, 'pl'));
  }
  const direction = mode === 'newest' ? -1 : 1;
  return out.sort((a, b) => direction * ((rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)));
}

export function nowStamp(): string {
  return new Date().toISOString();
}
