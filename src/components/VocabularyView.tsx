import { useEffect, useMemo, useState } from 'react';
import type { ProgressMap, VocabEntry, Vocabulary } from '../types';
import type { TtsSettings } from '../lib/tts';
import { toCsv } from '../lib/csv';
import { mastery } from '../lib/progress';
import { normalize } from '../lib/text';
import EntryEditor from './EntryEditor';
import ImportDialog from './ImportDialog';
import SpeakButton from './SpeakButton';

/**
 * Rows painted at once. Filtering 3000 entries costs ~1 ms; painting 3000 table
 * rows costs over a second and makes every keystroke in the search box lag, so
 * the list is capped and extended on demand.
 */
const PAGE_SIZE = 200;

interface Props {
  doc: Vocabulary;
  progress: ProgressMap;
  tts: TtsSettings;
  onChange: (next: Vocabulary, note?: string) => void;
}

function slug(value: string): string {
  const fold: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return value
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => fold[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function VocabularyView({ doc, progress, tts, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState<string>('');
  const [editing, setEditing] = useState<VocabEntry | null | 'new'>(null);
  const [importing, setImporting] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => setLimit(PAGE_SIZE), [query, setFilter]);

  const setName = useMemo(() => new Map(doc.sets.map((s) => [s.id, s.name])), [doc.sets]);

  const visible = useMemo(() => {
    const q = normalize(query);
    return doc.entries.filter((entry) => {
      if (setFilter && !entry.sets.includes(setFilter)) return false;
      if (!q) return true;
      return normalize(entry.pl).includes(q) || normalize(entry.ru).includes(q);
    });
  }, [doc.entries, query, setFilter]);

  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);

  const countsBySet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of doc.entries) {
      for (const id of entry.sets) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [doc.entries]);

  const saveEntry = (entry: VocabEntry): void => {
    const exists = doc.entries.some((e) => e.id === entry.id);
    const entries = exists
      ? doc.entries.map((e) => (e.id === entry.id ? entry : e))
      : [...doc.entries, entry];
    onChange({ ...doc, entries }, exists ? 'Zapisano zmiany.' : `Dodano „${entry.pl}".`);
    setEditing(null);
  };

  const deleteEntry = (entry: VocabEntry): void => {
    if (!confirm(`Usunąć „${entry.pl}" ze słownika?`)) return;
    onChange({ ...doc, entries: doc.entries.filter((e) => e.id !== entry.id) }, `Usunięto „${entry.pl}".`);
  };

  const addSet = (): void => {
    const name = newSetName.trim();
    if (!name) return;
    if (doc.sets.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    let id = slug(name) || `set-${doc.sets.length + 1}`;
    const used = new Set(doc.sets.map((s) => s.id));
    while (used.has(id)) id = `${id}-1`;
    onChange({ ...doc, sets: [...doc.sets, { id, name }] }, `Utworzono zestaw „${name}".`);
    setNewSetName('');
  };

  const renameSet = (id: string): void => {
    const current = setName.get(id) ?? '';
    const name = prompt('Nowa nazwa zestawu:', current);
    if (!name?.trim() || name === current) return;
    onChange({ ...doc, sets: doc.sets.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)) });
  };

  const deleteSet = (id: string): void => {
    const count = countsBySet.get(id) ?? 0;
    if (!confirm(`Usunąć zestaw „${setName.get(id)}"? Słowa (${count}) zostaną w słowniku.`)) return;
    onChange(
      {
        ...doc,
        sets: doc.sets.filter((s) => s.id !== id),
        entries: doc.entries.map((e) => ({ ...e, sets: e.sets.filter((s) => s !== id) })),
      },
      'Zestaw usunięty.',
    );
    if (setFilter === id) setSetFilter('');
  };

  const exportCsv = (): void => {
    const blob = new Blob([toCsv(doc)], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `slownik-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div>
            <h2>Zestawy</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Grupy słów, które można ćwiczyć osobno.
            </p>
          </div>
        </div>

        <div className="chips" style={{ marginTop: 14 }}>
          <button className="chip" aria-pressed={setFilter === ''} onClick={() => setSetFilter('')}>
            Wszystko <span className="count">{doc.entries.length}</span>
          </button>
          {doc.sets.map((set) => (
            <span key={set.id} className="row" style={{ gap: 2 }}>
              <button
                className="chip"
                aria-pressed={setFilter === set.id}
                onClick={() => setSetFilter(setFilter === set.id ? '' : set.id)}
              >
                {set.name} <span className="count">{countsBySet.get(set.id) ?? 0}</span>
              </button>
              <button className="btn small ghost" title="Zmień nazwę" onClick={() => renameSet(set.id)}>
                ✎
              </button>
              <button
                className="btn small ghost danger"
                title="Usuń zestaw"
                onClick={() => deleteSet(set.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <input
            type="text"
            value={newSetName}
            placeholder="Nazwa nowego zestawu…"
            onChange={(e) => setNewSetName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSet()}
            style={{ maxWidth: 280 }}
          />
          <button className="btn" disabled={!newSetName.trim()} onClick={addSet}>
            + Zestaw
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row spread" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Słownik</h2>
          <div className="row">
            <button className="btn" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button className="btn" onClick={exportCsv}>
              Eksport CSV
            </button>
            <button className="btn primary" onClick={() => setEditing('new')}>
              + Dodaj
            </button>
          </div>
        </div>

        <input
          type="search"
          value={query}
          placeholder="Szukaj po polsku albo po rosyjsku…"
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 14 }}
        />

        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Polski</th>
                <th>Rosyjski</th>
                <th>Zestawy</th>
                <th>Zdania</th>
                <th>Postęp</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  <td className="pl">
                    {entry.pl} <SpeakButton text={entry.pl} settings={tts} />
                    {entry.type === 'phrase' && <span className="tag">zwrot</span>}
                  </td>
                  <td>{entry.ru}</td>
                  <td>
                    {entry.sets.map((id) => (
                      <span className="tag" key={id}>
                        {setName.get(id) ?? id}
                      </span>
                    ))}
                  </td>
                  <td className="muted">{entry.examples.length || '—'}</td>
                  <td>
                    <div className="mastery" title={`${Math.round(mastery(progress[entry.id]) * 100)}%`}>
                      <div style={{ width: `${mastery(progress[entry.id]) * 100}%` }} />
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small ghost" onClick={() => setEditing(entry)}>
                      ✎
                    </button>
                    <button className="btn small ghost danger" onClick={() => deleteEntry(entry)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center" style={{ padding: 28 }}>
                    Nic nie znaleziono.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row spread" style={{ marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {shown.length < visible.length
              ? `${shown.length} z ${visible.length} pasujących`
              : `${visible.length} z ${doc.entries.length} pozycji`}{' '}
            · zapisywane do <code>data/vocabulary.json</code>
          </span>
          {shown.length < visible.length && (
            <button className="btn small" onClick={() => setLimit((n) => n + PAGE_SIZE * 5)}>
              Pokaż więcej
            </button>
          )}
        </div>
      </div>

      {editing && (
        <EntryEditor
          doc={doc}
          entry={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={saveEntry}
        />
      )}

      {importing && (
        <ImportDialog
          doc={doc}
          onCancel={() => setImporting(false)}
          onImport={(next, summary) => {
            onChange(next, summary);
            setImporting(false);
          }}
        />
      )}
    </>
  );
}
