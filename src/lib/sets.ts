import type { Vocabulary } from '../types';
import { uniqueSlug } from './slug';

/** How many entries belong to each set. */
export function setCounts(doc: Vocabulary): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of doc.entries) {
    for (const id of entry.sets) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function setNameTaken(doc: Vocabulary, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return doc.sets.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === wanted);
}

/** Returns the new document, or null when the name is empty or already used. */
export function createSet(doc: Vocabulary, name: string): Vocabulary | null {
  const clean = name.trim();
  if (!clean || setNameTaken(doc, clean)) return null;
  const id = uniqueSlug(clean, new Set(doc.sets.map((s) => s.id)), `set-${doc.sets.length + 1}`);
  return { ...doc, sets: [...doc.sets, { id, name: clean }] };
}

export function renameSet(doc: Vocabulary, id: string, name: string): Vocabulary | null {
  const clean = name.trim();
  if (!clean || setNameTaken(doc, clean, id)) return null;
  if (!doc.sets.some((s) => s.id === id)) return null;
  // The id stays put — entries reference it, and so do saved training filters.
  return { ...doc, sets: doc.sets.map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

/** Removes the set and its membership from every entry. Words themselves stay. */
export function deleteSet(doc: Vocabulary, id: string): Vocabulary {
  return {
    ...doc,
    sets: doc.sets.filter((s) => s.id !== id),
    entries: doc.entries.map((entry) =>
      entry.sets.includes(id) ? { ...entry, sets: entry.sets.filter((s) => s !== id) } : entry,
    ),
  };
}
