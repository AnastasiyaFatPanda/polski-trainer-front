import type { EntryType, Example, SetDef, VocabEntry, Vocabulary } from '../types';
import { normalize } from './text';
import { nowStamp } from './vocabSort';
import { uniqueSlug } from './slug';

export interface ParsedRow {
  pl: string;
  ru: string;
  type: EntryType;
  sets: string[];
  examples: Example[];
  note?: string;
}

export interface ImportPreview {
  rows: ParsedRow[];
  added: ParsedRow[];
  merged: ParsedRow[];
  skipped: { row: number; reason: string }[];
  newSets: string[];
}

/** RFC-4180-ish splitter: handles quotes, escaped quotes and embedded newlines. */
function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
  ] as const;
  return [...counts].sort((a, b) => b[1] - a[1])[0][1] > 0
    ? [...counts].sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

const HEADER_ALIASES: Record<keyof ParsedRow | 'example', string[]> = {
  pl: ['pl', 'polski', 'polish', 'po polsku', 'słowo', 'slowo', 'польский', 'слово'],
  ru: ['ru', 'rosyjski', 'russian', 'русский', 'перевод', 'tłumaczenie', 'tlumaczenie'],
  type: ['type', 'typ', 'kind', 'тип'],
  sets: ['sets', 'set', 'zestaw', 'zestawy', 'kategoria', 'category', 'tags', 'tag', 'набор', 'категория'],
  examples: ['example', 'examples', 'przykład', 'przyklad', 'пример'],
  note: ['note', 'notes', 'uwagi', 'заметка', 'комментарий'],
  example: ['example_pl', 'przyklad_pl', 'przykład_pl', 'sentence_pl', 'пример_pl'],
};

function matchHeader(cell: string): string | null {
  const value = cell.trim().toLowerCase();
  if (!value) return null;
  if (HEADER_ALIASES.example.includes(value)) return 'example_pl';
  if (['example_ru', 'przyklad_ru', 'przykład_ru', 'sentence_ru', 'пример_ru'].includes(value)) {
    return 'example_ru';
  }
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (field === 'example') continue;
    if (aliases.includes(value)) return field;
  }
  return null;
}

export function parseCsv(text: string, defaultSets: string[] = []): ParsedRow[] {
  const delimiter = detectDelimiter(text);
  const table = splitCsv(text.replace(/^﻿/, ''), delimiter);
  if (table.length === 0) return [];

  const headerCandidates = table[0].map(matchHeader);
  const hasHeader = headerCandidates.filter(Boolean).length >= 2;
  const columns = hasHeader
    ? headerCandidates
    : ['pl', 'ru', 'sets', 'example_pl', 'example_ru'].slice(0, table[0].length);
  const body = hasHeader ? table.slice(1) : table;

  const rows: ParsedRow[] = [];
  for (const cells of body) {
    const record: Record<string, string> = {};
    cells.forEach((cell, index) => {
      const key = columns[index];
      if (key) record[key] = cell.trim();
    });

    const pl = record.pl ?? '';
    const ru = record.ru ?? '';
    if (!pl || !ru) continue;

    const setNames = (record.sets ?? '')
      .split(/[|,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const examples: Example[] = [];
    if (record.example_pl && record.example_ru) {
      examples.push({ pl: record.example_pl, ru: record.example_ru, source: 'file' });
    }

    const declaredType = (record.type ?? '').toLowerCase();
    const type: EntryType =
      declaredType === 'phrase' || declaredType === 'fraza' || declaredType === 'фраза'
        ? 'phrase'
        : declaredType === 'word' || declaredType === 'słowo' || declaredType === 'слово'
          ? 'word'
          : pl.trim().includes(' ')
            ? 'phrase'
            : 'word';

    rows.push({
      pl,
      ru,
      type,
      sets: setNames.length ? setNames : defaultSets,
      examples,
      note: record.note || undefined,
    });
  }
  return rows;
}

/** Work out what an import would change, without changing anything yet. */
export function previewImport(doc: Vocabulary, rows: ParsedRow[]): ImportPreview {
  const byKey = new Map(doc.entries.map((e) => [normalize(e.pl), e]));
  const knownSetNames = new Map(doc.sets.map((s) => [s.name.toLowerCase(), s]));
  const knownSetIds = new Set(doc.sets.map((s) => s.id));

  const added: ParsedRow[] = [];
  const merged: ParsedRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const newSets = new Set<string>();

  rows.forEach((row, index) => {
    if (!row.pl || !row.ru) {
      skipped.push({ row: index + 1, reason: 'missing Polish or Russian side' });
      return;
    }
    for (const name of row.sets) {
      if (!knownSetNames.has(name.toLowerCase()) && !knownSetIds.has(name)) newSets.add(name);
    }
    if (byKey.has(normalize(row.pl))) merged.push(row);
    else added.push(row);
  });

  return { rows, added, merged, skipped, newSets: [...newSets] };
}

/** Apply an import, returning a new document. Existing entries are enriched, never replaced. */
export function applyImport(doc: Vocabulary, rows: ParsedRow[]): Vocabulary {
  const sets: SetDef[] = [...doc.sets];
  const setIdByName = new Map(sets.map((s) => [s.name.toLowerCase(), s.id]));
  const setIds = new Set(sets.map((s) => s.id));

  const resolveSet = (name: string): string => {
    if (setIds.has(name)) return name;
    const existing = setIdByName.get(name.toLowerCase());
    if (existing) return existing;
    const id = uniqueSlug(name, setIds, `set-${sets.length + 1}`);
    sets.push({ id, name });
    setIds.add(id);
    setIdByName.set(name.toLowerCase(), id);
    return id;
  };

  const entries = doc.entries.map((e) => ({ ...e, sets: [...e.sets], examples: [...e.examples] }));
  const byKey = new Map(entries.map((e) => [normalize(e.pl), e]));
  const usedIds = new Set(entries.map((e) => e.id));

  for (const row of rows) {
    const setRefs = row.sets.map(resolveSet);
    const existing = byKey.get(normalize(row.pl));

    if (existing) {
      for (const setId of setRefs) if (!existing.sets.includes(setId)) existing.sets.push(setId);
      const seen = new Set(existing.examples.map((ex) => normalize(ex.pl)));
      for (const ex of row.examples) {
        if (!seen.has(normalize(ex.pl))) {
          existing.examples.push(ex);
          seen.add(normalize(ex.pl));
        }
      }
      const translations = new Set(existing.ru.split(/\s*,\s*/).map((t) => t.toLowerCase()));
      if (!translations.has(row.ru.toLowerCase())) existing.ru = `${existing.ru}, ${row.ru}`;
      if (row.note && !existing.note) existing.note = row.note;
      continue;
    }

    const id = uniqueSlug(row.pl, usedIds, `entry-${usedIds.size + 1}`);
    usedIds.add(id);

    const entry: VocabEntry = {
      id,
      pl: row.pl,
      ru: row.ru,
      type: row.type,
      sets: setRefs,
      examples: row.examples,
      addedAt: nowStamp(),
      ...(row.note ? { note: row.note } : {}),
    };
    entries.push(entry);
    byKey.set(normalize(row.pl), entry);
  }

  return { ...doc, sets, entries };
}

export function toCsv(doc: Vocabulary): string {
  const setName = new Map(doc.sets.map((s) => [s.id, s.name]));
  const escape = (value: string): string =>
    /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = ['pl,ru,type,sets,example_pl,example_ru'];
  for (const entry of doc.entries) {
    const example = entry.examples[0];
    lines.push(
      [
        entry.pl,
        entry.ru,
        entry.type,
        entry.sets.map((id) => setName.get(id) ?? id).join('|'),
        example?.pl ?? '',
        example?.ru ?? '',
      ]
        .map(escape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
