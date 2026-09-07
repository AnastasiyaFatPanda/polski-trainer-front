/**
 * The universal training: one small batch of words taken through four stages.
 *
 *   intro     see + hear each word, no answering
 *   pl-ru     Polish shown, pick the Russian meaning (1 of 5)
 *   ru-pl     Russian shown, type the Polish word
 *   audio-pl  Polish played, type the Polish word
 *
 * A word answered wrongly comes back later in the same stage, up to
 * MAX_ATTEMPTS tries in that stage, then the lesson moves on regardless — so a
 * word you cannot get never stalls the session.
 *
 * All of this is a pure reducer so the retry and stage-advance rules can be
 * tested without a browser.
 */

export type Stage = 'intro' | 'pl-ru' | 'ru-pl' | 'audio-pl';

export const STAGES: Stage[] = ['intro', 'pl-ru', 'ru-pl', 'audio-pl'];

export const MAX_ATTEMPTS = 3;

export const STAGE_LABELS: Record<Stage, string> = {
  intro: 'Poznaj słówka',
  'pl-ru': 'Wybierz znaczenie',
  'ru-pl': 'Napisz po polsku',
  'audio-pl': 'Posłuchaj i napisz',
};

export const STAGE_HINTS: Record<Stage, string> = {
  intro: 'Przeczytaj i posłuchaj — Enter przechodzi dalej',
  'pl-ru': 'PL → RU · wybierz jedną z pięciu odpowiedzi',
  'ru-pl': 'RU → PL · wpisz słowo z polskimi znakami',
  'audio-pl': '🔊 → PL · wpisz to, co słyszysz',
};

export interface UniversalState {
  /** The lesson's words, in the order they were introduced. */
  entryIds: string[];
  stage: Stage;
  /** Remaining words in the current stage; the head is the current question. */
  queue: string[];
  /** Attempts per `${stage}:${entryId}`. */
  attempts: Record<string, number>;
  /** Words missed at least once, per stage — used for the summary. */
  missed: Record<string, string[]>;
  /** Answers given, including repeats. Drives the progress bar. */
  answered: number;
  done: boolean;
}

export type Shuffle = (ids: string[]) => string[];

const defaultShuffle: Shuffle = (ids) => {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export function startUniversal(entryIds: string[]): UniversalState {
  return {
    entryIds,
    stage: 'intro',
    // The intro keeps the order the words were picked in; later stages shuffle.
    queue: [...entryIds],
    attempts: {},
    missed: {},
    answered: 0,
    done: entryIds.length === 0,
  };
}

export function attemptsFor(state: UniversalState, entryId: string): number {
  return state.attempts[`${state.stage}:${entryId}`] ?? 0;
}

/** Put a missed word back a couple of places later, never immediately next. */
function requeue(rest: string[], entryId: string): string[] {
  const at = Math.min(2, rest.length);
  return [...rest.slice(0, at), entryId, ...rest.slice(at)];
}

/**
 * Record an answer for the current question and move on. `correct` is ignored
 * during the intro stage, which has no wrong answer.
 */
export function answerUniversal(
  state: UniversalState,
  correct: boolean,
  shuffle: Shuffle = defaultShuffle,
): UniversalState {
  if (state.done || state.queue.length === 0) return state;

  const [current, ...rest] = state.queue;
  const key = `${state.stage}:${current}`;
  const used = (state.attempts[key] ?? 0) + 1;
  const attempts = { ...state.attempts, [key]: used };
  const missed = { ...state.missed };

  let queue = rest;
  if (!correct && state.stage !== 'intro') {
    const already = missed[state.stage] ?? [];
    if (!already.includes(current)) missed[state.stage] = [...already, current];
    if (used < MAX_ATTEMPTS) queue = requeue(rest, current);
  }

  const answered = state.answered + 1;
  if (queue.length > 0) return { ...state, queue, attempts, missed, answered };

  const nextStage = STAGES[STAGES.indexOf(state.stage) + 1];
  if (!nextStage) {
    return { ...state, queue: [], attempts, missed, answered, done: true };
  }
  return {
    ...state,
    stage: nextStage,
    queue: shuffle(state.entryIds),
    attempts,
    missed,
    answered,
  };
}

/** Total answers a flawless run would take — the denominator for progress. */
export function perfectRunLength(wordCount: number): number {
  return wordCount * STAGES.length;
}

/** How many distinct words were missed at least once, across all stages. */
export function missedCount(state: UniversalState): number {
  const ids = new Set<string>();
  for (const list of Object.values(state.missed)) for (const id of list) ids.add(id);
  return ids.size;
}
