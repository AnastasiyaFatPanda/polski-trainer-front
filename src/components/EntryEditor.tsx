import { useState } from 'react';
import type { EntryType, VocabEntry, Vocabulary } from '../types';

interface Props {
  doc: Vocabulary;
  entry: VocabEntry | null;
  onCancel: () => void;
  onSave: (entry: VocabEntry) => void;
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

export default function EntryEditor({ doc, entry, onCancel, onSave }: Props) {
  const [pl, setPl] = useState(entry?.pl ?? '');
  const [ru, setRu] = useState(entry?.ru ?? '');
  const [type, setType] = useState<EntryType>(entry?.type ?? 'word');
  const [sets, setSets] = useState<string[]>(entry?.sets ?? []);
  const [note, setNote] = useState(entry?.note ?? '');
  const [examples, setExamples] = useState(entry?.examples ?? []);

  const toggleSet = (id: string): void =>
    setSets((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const save = (): void => {
    if (!pl.trim() || !ru.trim()) return;
    const used = new Set(doc.entries.map((e) => e.id));
    let id = entry?.id;
    if (!id) {
      id = slug(pl) || `entry-${used.size + 1}`;
      while (used.has(id)) id = `${id}-1`;
    }
    onSave({
      id,
      pl: pl.trim(),
      ru: ru.trim(),
      type,
      sets,
      examples: examples.filter((ex) => ex.pl.trim() && ex.ru.trim()),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{entry ? 'Edytuj pozycję' : 'Nowa pozycja'}</h2>

        <label className="field">
          <span>Po polsku</span>
          <input type="text" value={pl} lang="pl" onChange={(e) => setPl(e.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>Po rosyjsku — kilka wariantów oddziel przecinkiem</span>
          <input type="text" value={ru} lang="ru" onChange={(e) => setRu(e.target.value)} />
        </label>

        <label className="field">
          <span>Typ</span>
          <select value={type} onChange={(e) => setType(e.target.value as EntryType)}>
            <option value="word">słowo</option>
            <option value="phrase">zwrot</option>
          </select>
        </label>

        <div className="field">
          <span
            style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 5 }}
          >
            Zestawy
          </span>
          <div className="chips">
            {doc.sets.map((set) => (
              <button
                key={set.id}
                type="button"
                className="chip"
                aria-pressed={sets.includes(set.id)}
                onClick={() => toggleSet(set.id)}
              >
                {set.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span
            style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginBottom: 5 }}
          >
            Zdania przykładowe (max 8 słówek) — używane w treningu „Zdania"
          </span>
          {examples.map((example, i) => (
            <div className="row" key={i} style={{ marginBottom: 8, alignItems: 'flex-start' }}>
              <input
                type="text"
                lang="pl"
                placeholder="po polsku"
                value={example.pl}
                onChange={(e) =>
                  setExamples((prev) =>
                    prev.map((ex, j) => (j === i ? { ...ex, pl: e.target.value } : ex)),
                  )
                }
                style={{ flex: 1, minWidth: 160 }}
              />
              <input
                type="text"
                lang="ru"
                placeholder="по-русски"
                value={example.ru}
                onChange={(e) =>
                  setExamples((prev) =>
                    prev.map((ex, j) => (j === i ? { ...ex, ru: e.target.value } : ex)),
                  )
                }
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                type="button"
                className="btn small ghost danger"
                onClick={() => setExamples((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn small"
            onClick={() => setExamples((prev) => [...prev, { pl: '', ru: '', source: 'file' }])}
          >
            + zdanie
          </button>
        </div>

        <label className="field">
          <span>Notatka (opcjonalnie)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
          <button className="btn primary" disabled={!pl.trim() || !ru.trim()} onClick={save}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
