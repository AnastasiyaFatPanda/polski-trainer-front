import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProgressMap, VocabEntry, Vocabulary } from '../types';
import type { TtsSettings } from '../lib/tts';
import { toCsv } from '../lib/csv';
import { mastery } from '../lib/progress';
import { setCounts } from '../lib/sets';
import { normalize } from '../lib/text';
import { SORT_LABELS, addedRank, sortEntries, type SortMode } from '../lib/vocabSort';
import EntryEditor from './EntryEditor';
import ImportDialog from './ImportDialog';
import SpeakButton from './SpeakButton';

/**
 * Rows painted at once. Filtering 3000 entries costs ~1 ms; painting 3000 table
 * rows costs over a second and makes every keystroke in the search box lag, so
 * the list is paginated. Keep the default modest.
 */
const PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

interface Props {
  doc: Vocabulary;
  progress: ProgressMap;
  tts: TtsSettings;
  onChange: (next: Vocabulary, note?: string) => void;
  /** Controlled by App so the Zestawy page can deep-link into a filtered list. */
  setFilter: string;
  onSetFilterChange: (setId: string) => void;
  onOpenSets: () => void;
}

export default function VocabularyView({
  doc,
  progress,
  tts,
  onChange,
  setFilter,
  onSetFilterChange,
  onOpenSets,
}: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<VocabEntry | null | 'new'>(null);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<SortMode>('newest');

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPage(1), [query, setFilter, sort, pageSize]);
  // Land at the top of the new page rather than mid-list.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page, sort, pageSize, query, setFilter]);

  const setName = useMemo(() => new Map(doc.sets.map((s) => [s.id, s.name])), [doc.sets]);

  const visible = useMemo(() => {
    const q = normalize(query);
    return doc.entries.filter((entry) => {
      if (setFilter && !entry.sets.includes(setFilter)) return false;
      if (!q) return true;
      return normalize(entry.pl).includes(q) || normalize(entry.ru).includes(q);
    });
  }, [doc.entries, query, setFilter]);

  const rank = useMemo(() => addedRank(doc.entries), [doc.entries]);
  const sorted = useMemo(() => sortEntries(visible, sort, rank), [visible, sort, rank]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A delete or a filter change can leave us past the end.
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * pageSize;
  const shown = useMemo(
    () => sorted.slice(firstIndex, firstIndex + pageSize),
    [sorted, firstIndex, pageSize],
  );

  const countsBySet = useMemo(() => setCounts(doc), [doc]);

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
        <div className="row spread" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Słownik</h2>
          <div className="row">
            <button className="btn ghost" onClick={onOpenSets}>
              Zestawy →
            </button>
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

        <div className="row" style={{ marginBottom: 14 }}>
          <input
            type="search"
            value={query}
            placeholder="Szukaj po polsku albo po rosyjsku…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <label className="row" style={{ gap: 7 }}>
            <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              Zestaw:
            </span>
            <select
              value={setFilter}
              onChange={(e) => onSetFilterChange(e.target.value)}
              style={{ width: 'auto', maxWidth: 220 }}
            >
              <option value="">Wszystkie ({doc.entries.length})</option>
              {doc.sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name} ({countsBySet.get(set.id) ?? 0})
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 7 }}>
            <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
              Sortuj:
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              style={{ width: 'auto' }}
            >
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll" ref={scrollRef}>
          <table className="table">
            <thead>
              <tr>
                <th>Polski</th>
                <th>Rosyjski</th>
                <th>Zestawy</th>
                <th>Zdania</th>
                <th>Dodano</th>
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
                  <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                    {entry.addedAt
                      ? new Date(entry.addedAt).toLocaleDateString('pl-PL', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                        })
                      : '—'}
                  </td>
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
                  <td colSpan={7} className="muted center" style={{ padding: 28 }}>
                    Nic nie znaleziono.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row spread" style={{ marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {sorted.length === 0
              ? 'Brak wyników'
              : `${firstIndex + 1}–${firstIndex + shown.length} z ${sorted.length}`}
            {sorted.length !== doc.entries.length && ` · w słowniku ${doc.entries.length}`}
          </span>

          <div className="row" style={{ gap: 7 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Na stronie:
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ width: 'auto' }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn small"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              aria-label="Poprzednia strona"
            >
              ←
            </button>
            <span className="counter">
              {currentPage} / {pageCount}
            </span>
            <button
              className="btn small"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
              aria-label="Następna strona"
            >
              →
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8, marginBottom: 0 }}>
          zapisywane do <code>data/vocabulary.json</code>
        </p>
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
