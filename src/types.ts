export type EntryType = 'word' | 'phrase';

export interface Example {
  pl: string;
  ru: string;
  source?: 'file' | 'generated';
}

export interface VocabEntry {
  id: string;
  pl: string;
  ru: string;
  type: EntryType;
  sets: string[];
  note?: string;
  examples: Example[];
  /** ISO timestamp, set when the entry is created. Absent on entries that
   *  predate the field — those fall back to file position. See lib/vocabSort. */
  addedAt?: string;
}

export interface SetDef {
  id: string;
  name: string;
}

export interface Vocabulary {
  version: number;
  sets: SetDef[];
  entries: VocabEntry[];
}

export type TrainingId =
  | 'universal'
  | 'pl-ru-choice'
  | 'ru-pl-typed'
  | 'audio-ru-choice'
  | 'sentence';

export interface EntryProgress {
  correct: number;
  wrong: number;
  streak: number;
  lastSeen: number;
}

export type ProgressMap = Record<string, EntryProgress>;

export interface Answer {
  entryId: string;
  correct: boolean;
  given: string;
  expected: string;
}

export interface SessionConfig {
  training: TrainingId;
  setIds: string[];
  types: EntryType[];
  length: number;
}
