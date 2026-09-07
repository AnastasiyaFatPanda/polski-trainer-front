import { useMemo, useState } from 'react';
import type { Vocabulary } from '../types';
import { createSet, deleteSet, renameSet, setCounts } from '../lib/sets';

interface Props {
  doc: Vocabulary;
  onChange: (next: Vocabulary, note?: string) => void;
  onOpenVocabulary: (setId: string) => void;
  onBack: () => void;
}

export default function SetsView({ doc, onChange, onOpenVocabulary, onBack }: Props) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');

  const counts = useMemo(() => setCounts(doc), [doc]);
  const unassigned = useMemo(() => doc.entries.filter((e) => e.sets.length === 0).length, [doc]);

  const add = (): void => {
    const next = createSet(doc, newName);
    if (!next) {
      setError(
        newName.trim() ? `Zestaw „${newName.trim()}" już istnieje.` : 'Podaj nazwę zestawu.',
      );
      return;
    }
    onChange(next, `Utworzono zestaw „${newName.trim()}".`);
    setNewName('');
    setError('');
  };

  const startEdit = (id: string, name: string): void => {
    setEditingId(id);
    setDraftName(name);
    setError('');
  };

  const commitEdit = (): void => {
    if (!editingId) return;
    const next = renameSet(doc, editingId, draftName);
    if (!next) {
      setError(
        draftName.trim() ? `Nazwa „${draftName.trim()}" jest już zajęta.` : 'Nazwa nie może być pusta.',
      );
      return;
    }
    onChange(next, 'Zmieniono nazwę zestawu.');
    setEditingId(null);
    setError('');
  };

  const remove = (id: string, name: string): void => {
    const count = counts.get(id) ?? 0;
    const message =
      count > 0
        ? `Usunąć zestaw „${name}"?\n\n${count} ${count === 1 ? 'słowo zostanie' : 'słów zostanie'} w słowniku — zniknie tylko przypisanie do tego zestawu.`
        : `Usunąć pusty zestaw „${name}"?`;
    if (!confirm(message)) return;
    onChange(deleteSet(doc, id), `Usunięto zestaw „${name}".`);
  };

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div>
            <h2>Zestawy</h2>
            <p className="sub" style={{ marginBottom: 0 }}>
              Grupy słów, które można ćwiczyć osobno. Jedno słowo może należeć do kilku zestawów.
            </p>
          </div>
          <button className="btn ghost" onClick={onBack}>
            ← Słownik
          </button>
        </div>

        {error && (
          <div className="notice error" style={{ marginTop: 14, marginBottom: 0 }}>
            {error}
          </div>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <input
            type="text"
            value={newName}
            placeholder="Nazwa nowego zestawu…"
            onChange={(e) => {
              setNewName(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={{ maxWidth: 320 }}
          />
          <button className="btn primary" disabled={!newName.trim()} onClick={add}>
            + Utwórz zestaw
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th style={{ width: 90 }}>Słów</th>
                <th style={{ width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {doc.sets.map((set) => {
                const count = counts.get(set.id) ?? 0;
                const isEditing = editingId === set.id;
                return (
                  <tr key={set.id}>
                    <td className="pl">
                      {isEditing ? (
                        <input
                          type="text"
                          value={draftName}
                          autoFocus
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          style={{ maxWidth: 320 }}
                        />
                      ) : (
                        <>
                          {set.name}
                          <div className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>
                            <code>{set.id}</code>
                          </div>
                        </>
                      )}
                    </td>
                    <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {count}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button className="btn small primary" onClick={commitEdit}>
                            Zapisz
                          </button>{' '}
                          <button className="btn small ghost" onClick={() => setEditingId(null)}>
                            Anuluj
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn small ghost"
                            disabled={count === 0}
                            onClick={() => onOpenVocabulary(set.id)}
                          >
                            Pokaż słowa
                          </button>{' '}
                          <button
                            className="btn small ghost"
                            onClick={() => startEdit(set.id, set.name)}
                          >
                            ✎
                          </button>{' '}
                          <button
                            className="btn small ghost danger"
                            onClick={() => remove(set.id, set.name)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {doc.sets.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted center" style={{ padding: 28 }}>
                    Nie ma jeszcze żadnych zestawów.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="muted" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
          {doc.sets.length} {doc.sets.length === 1 ? 'zestaw' : 'zestawów'} · {doc.entries.length}{' '}
          pozycji w słowniku
          {unassigned > 0 && ` · ${unassigned} bez zestawu`}
          <br />
          Usunięcie zestawu nie usuwa słów — znika tylko przypisanie.
        </p>
      </div>
    </>
  );
}
