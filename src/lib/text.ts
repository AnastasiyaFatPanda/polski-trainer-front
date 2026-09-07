/** Polish-aware text helpers used by the typed-answer trainings. */

const PL_FOLD: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/** Lowercase, strip punctuation and collapse whitespace — diacritics preserved. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:"'`„”«»()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same as normalize() but also folds ą→a, ż→z … so we can spot diacritic-only misses. */
export function foldDiacritics(value: string): string {
  return normalize(value).replace(/[ąćęłńóśźż]/g, (ch) => PL_FOLD[ch] ?? ch);
}

export type Verdict = 'correct' | 'diacritics' | 'close' | 'wrong';

/** Levenshtein distance, capped for speed on short strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Grade a typed Polish answer against one or more accepted forms.
 * "diacritics" means the letters are right but ogonki/kreski are missing —
 * worth telling the learner about rather than marking as plain wrong.
 */
export function grade(given: string, accepted: string[]): { verdict: Verdict; matched: string } {
  const g = normalize(given);
  const gFolded = foldDiacritics(given);
  let best: { verdict: Verdict; matched: string } = { verdict: 'wrong', matched: accepted[0] ?? '' };

  for (const candidate of accepted) {
    const c = normalize(candidate);
    if (g === c) return { verdict: 'correct', matched: candidate };
    if (gFolded === foldDiacritics(candidate)) {
      best = { verdict: 'diacritics', matched: candidate };
      continue;
    }
    if (best.verdict === 'wrong') {
      const distance = editDistance(gFolded, foldDiacritics(candidate));
      if (distance > 0 && distance <= (c.length > 8 ? 2 : 1)) {
        best = { verdict: 'close', matched: candidate };
      }
    }
  }
  return best;
}

/** Accepted variants for an entry: "kot, kotek" and "kot (zwierzę)" both work. */
export function acceptedForms(value: string): string[] {
  const forms = new Set<string>();
  forms.add(value);
  for (const part of value.split(/[,;/]/)) {
    const trimmed = part.trim();
    if (trimmed) forms.add(trimmed);
  }
  const withoutParens = value.replace(/\([^)]*\)/g, '').trim();
  if (withoutParens) forms.add(withoutParens);
  return [...forms].filter(Boolean);
}

export function countWords(sentence: string): number {
  return normalize(sentence).split(' ').filter(Boolean).length;
}
