import type { ProgressMap, SessionConfig, TrainingId, VocabEntry, Vocabulary } from '../types';
import { normalize } from './text';
import { weight } from './progress';

export function entriesForConfig(doc: Vocabulary, config: SessionConfig): VocabEntry[] {
  const wanted = new Set(config.setIds);
  return doc.entries.filter((entry) => {
    if (!config.types.includes(entry.type)) return false;
    if (wanted.size === 0) return true;
    return entry.sets.some((setId) => wanted.has(setId));
  });
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Weighted sample without replacement — weak and unseen words come up more often. */
export function pickEntries(pool: VocabEntry[], count: number, progress: ProgressMap): VocabEntry[] {
  const remaining = pool.map((entry) => ({ entry, w: weight(progress[entry.id]) }));
  const chosen: VocabEntry[] = [];
  const target = Math.min(count, remaining.length);

  while (chosen.length < target && remaining.length > 0) {
    const total = remaining.reduce((sum, item) => sum + item.w, 0);
    let tick = Math.random() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i += 1) {
      tick -= remaining[i].w;
      if (tick <= 0) {
        index = i;
        break;
      }
    }
    chosen.push(remaining[index].entry);
    remaining.splice(index, 1);
  }
  return chosen;
}

/**
 * Four wrong options plus the right one. Distractors are drawn from the same set
 * first (so "koza" competes with other animals, not with "Japonia"), and are
 * de-duplicated on the answer text itself.
 */
export function buildOptions(
  entry: VocabEntry,
  pool: VocabEntry[],
  side: 'pl' | 'ru',
  total = 5,
): string[] {
  const answer = entry[side];
  const taken = new Set([normalize(answer)]);
  const options: string[] = [];

  const sameSet = pool.filter((e) => e.id !== entry.id && e.sets.some((s) => entry.sets.includes(s)));
  const sameType = pool.filter((e) => e.id !== entry.id && e.type === entry.type);
  const rest = pool.filter((e) => e.id !== entry.id);

  for (const group of [sameSet, sameType, rest]) {
    for (const candidate of shuffle(group)) {
      if (options.length >= total - 1) break;
      const value = candidate[side];
      if (taken.has(normalize(value))) continue;
      taken.add(normalize(value));
      options.push(value);
    }
    if (options.length >= total - 1) break;
  }

  return shuffle([answer, ...options]);
}

/** The universal lesson is a small fixed batch; a smaller set just uses what it has. */
export const UNIVERSAL_LENGTHS = [6, 10];

export function sessionLengthOptions(poolSize: number, training: TrainingId): number[] {
  if (training === 'universal') return [...UNIVERSAL_LENGTHS];
  return [10, 20, 30, 50].filter((n) => n <= Math.max(10, poolSize));
}
