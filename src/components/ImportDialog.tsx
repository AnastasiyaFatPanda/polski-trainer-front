import { useMemo, useState } from 'react';
import type { Vocabulary } from '../types';
import { applyImport, parseCsv, previewImport } from '../lib/csv';

interface Props {
  doc: Vocabulary;
  onCancel: () => void;
  onImport: (next: Vocabulary, summary: string) => void;
}

export default function ImportDialog({ doc, onCancel, onImport }: Props) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [defaultSet, setDefaultSet] = useState('');
  const [over, setOver] = useState(false);

  const rows = useMemo(
    () => (text.trim() ? parseCsv(text, defaultSet ? [defaultSet] : []) : []),
    [text, defaultSet],
  );
  const preview = useMemo(() => previewImport(doc, rows), [doc, rows]);

  const readFile = async (file: File): Promise<void> => {
    setFileName(file.name);
    setText(await file.text());
  };

  const confirm = (): void => {
    const next = applyImport(doc, rows);
    onImport(
      next,
      `Zaimportowano: ${preview.added.length} nowych, ${preview.merged.length} uzupełnionych.`,
    );
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Import z pliku CSV</h2>

        <div className="notice info">
          Kolumny: <code>pl, ru, type, sets, example_pl, example_ru</code> — rozpoznawane są też
          nagłówki polskie i rosyjskie. Wystarczą dwie pierwsze. Separator (<code>,</code>{' '}
          <code>;</code> tab) wykrywany automatycznie. Istniejące słowa są uzupełniane, nie
          nadpisywane.
        </div>

        <label
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void readFile(file);
          }}
        >
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          {fileName ? <strong>{fileName}</strong> : 'Przeciągnij plik CSV albo kliknij, aby wybrać'}
        </label>

        <label className="field" style={{ marginTop: 16 }}>
          <span>…albo wklej dane</span>
          <textarea
            rows={5}
            value={text}
            placeholder={'pl,ru,sets\nkoza,коза,Zwierzęta\nżaba,лягушка,Zwierzęta'}
            onChange={(e) => {
              setText(e.target.value);
              setFileName('');
            }}
          />
        </label>

        <label className="field">
          <span>Zestaw domyślny (dla wierszy bez kolumny „sets")</span>
          <input
            type="text"
            list="known-sets"
            value={defaultSet}
            placeholder="np. Jedzenie"
            onChange={(e) => setDefaultSet(e.target.value)}
          />
          <datalist id="known-sets">
            {doc.sets.map((set) => (
              <option key={set.id} value={set.name} />
            ))}
          </datalist>
        </label>

        {rows.length > 0 && (
          <>
            <div className="stat-row" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="value">{preview.added.length}</div>
                <div className="label">nowych</div>
              </div>
              <div className="stat">
                <div className="value">{preview.merged.length}</div>
                <div className="label">uzupełnionych</div>
              </div>
              <div className="stat">
                <div className="value">{preview.newSets.length}</div>
                <div className="label">nowych zestawów</div>
              </div>
              <div className="stat">
                <div className="value">{preview.skipped.length}</div>
                <div className="label">pominiętych</div>
              </div>
            </div>

            {preview.newSets.length > 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Powstaną zestawy: {preview.newSets.join(', ')}
              </p>
            )}

            <div className="table-scroll" style={{ maxHeight: 220 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Polski</th>
                    <th>Rosyjski</th>
                    <th>Typ</th>
                    <th>Zestawy</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((row, i) => (
                    <tr key={`${row.pl}-${i}`}>
                      <td className="pl">{row.pl}</td>
                      <td>{row.ru}</td>
                      <td className="muted">{row.type === 'phrase' ? 'zwrot' : 'słowo'}</td>
                      <td>
                        {row.sets.map((s) => (
                          <span className="tag" key={s}>
                            {s}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 40 && (
              <p className="muted" style={{ fontSize: 12.5 }}>
                …i {rows.length - 40} dalszych wierszy
              </p>
            )}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn ghost" onClick={onCancel}>
            Anuluj
          </button>
          <button className="btn primary" disabled={rows.length === 0} onClick={confirm}>
            Zaimportuj {rows.length > 0 ? `${rows.length} wierszy` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
