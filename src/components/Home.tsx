import { useMemo } from 'react';
import type { EntryType, ProgressMap, SessionConfig, TrainingId, Vocabulary } from '../types';
import { entriesForConfig, sessionLengthOptions } from '../lib/session';
import { mastery } from '../lib/progress';

interface Props {
  doc: Vocabulary;
  progress: ProgressMap;
  config: SessionConfig;
  onConfigChange: (config: SessionConfig) => void;
  onStart: () => void;
}

const TRAININGS: { id: TrainingId; title: string; flow: string; desc: string }[] = [
  {
    id: 'pl-ru-choice',
    title: 'Rozpoznawanie',
    flow: 'PL → RU',
    desc: 'Widzisz polskie słowo, wybierasz jedno z pięciu znaczeń.',
  },
  {
    id: 'ru-pl-typed',
    title: 'Produkcja',
    flow: 'RU → PL',
    desc: 'Widzisz rosyjskie znaczenie, wpisujesz polskie słowo z ogonkami.',
  },
  {
    id: 'audio-ru-choice',
    title: 'Słuchanie',
    flow: '🔊 → RU',
    desc: 'Słyszysz polskie słowo, wybierasz jedno z pięciu znaczeń.',
  },
  {
    id: 'sentence',
    title: 'Zdania',
    flow: 'RU → PL',
    desc: 'Tłumaczysz krótkie zdanie (max 8 słówek) zawierające uczone słowo.',
  },
];

export default function Home({ doc, progress, config, onConfigChange, onStart }: Props) {
  const pool = useMemo(() => entriesForConfig(doc, config), [doc, config]);

  const countsBySet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of doc.entries) {
      for (const setId of entry.sets) counts.set(setId, (counts.get(setId) ?? 0) + 1);
    }
    return counts;
  }, [doc]);

  const stats = useMemo(() => {
    const seen = doc.entries.filter((e) => progress[e.id]?.lastSeen).length;
    const strong = doc.entries.filter((e) => mastery(progress[e.id]) >= 1).length;
    const weak = doc.entries.filter((e) => {
      const p = progress[e.id];
      return p && p.wrong > p.correct;
    }).length;
    return { total: doc.entries.length, seen, strong, weak };
  }, [doc, progress]);

  const toggleSet = (setId: string): void => {
    const next = config.setIds.includes(setId)
      ? config.setIds.filter((id) => id !== setId)
      : [...config.setIds, setId];
    onConfigChange({ ...config, setIds: next });
  };

  const toggleType = (type: EntryType): void => {
    const next = config.types.includes(type)
      ? config.types.filter((t) => t !== type)
      : [...config.types, type];
    onConfigChange({ ...config, types: next.length ? next : [type] });
  };

  const lengths = sessionLengthOptions(pool.length);

  return (
    <>
      <div className="card">
        <h2>Trening</h2>
        <p className="sub">Wybierz rodzaj ćwiczenia.</p>
        <div className="training-grid">
          {TRAININGS.map((training) => (
            <button
              key={training.id}
              className="training-card"
              aria-pressed={config.training === training.id}
              onClick={() => onConfigChange({ ...config, training: training.id })}
            >
              <span className="flow">{training.flow}</span>
              <span className="title">{training.title}</span>
              <span className="desc">{training.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Zestawy</h2>
        <p className="sub">
          Nic nie zaznaczone = cały słownik. Zaznacz zestawy, żeby ćwiczyć tylko je.
        </p>
        <div className="chips">
          <button
            className="chip"
            aria-pressed={config.setIds.length === 0}
            onClick={() => onConfigChange({ ...config, setIds: [] })}
          >
            Wszystko <span className="count">{doc.entries.length}</span>
          </button>
          {doc.sets.map((set) => (
            <button
              key={set.id}
              className="chip"
              aria-pressed={config.setIds.includes(set.id)}
              onClick={() => toggleSet(set.id)}
            >
              {set.name} <span className="count">{countsBySet.get(set.id) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <div className="chips">
            <button
              className="chip"
              aria-pressed={config.types.includes('word')}
              onClick={() => toggleType('word')}
            >
              Słowa
            </button>
            <button
              className="chip"
              aria-pressed={config.types.includes('phrase')}
              onClick={() => toggleType('phrase')}
            >
              Zwroty
            </button>
          </div>

          <label className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Pytań:
            </span>
            <select
              value={config.length}
              onChange={(e) => onConfigChange({ ...config, length: Number(e.target.value) })}
              style={{ width: 'auto' }}
            >
              {lengths.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row spread" style={{ marginTop: 20 }}>
          <span className="muted" style={{ fontSize: 13.5 }}>
            {pool.length === 0
              ? 'Brak słów dla tego filtra.'
              : `${pool.length} ${pool.length === 1 ? 'pozycja' : 'pozycji'} w puli`}
          </span>
          <button className="btn primary" disabled={pool.length === 0} onClick={onStart}>
            Zacznij trening →
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Postęp</h2>
        <p className="sub">Liczony lokalnie w tej przeglądarce.</p>
        <div className="stat-row">
          <div className="stat">
            <div className="value">{stats.total}</div>
            <div className="label">pozycji w słowniku</div>
          </div>
          <div className="stat">
            <div className="value">{stats.seen}</div>
            <div className="label">już ćwiczonych</div>
          </div>
          <div className="stat">
            <div className="value">{stats.strong}</div>
            <div className="label">opanowanych</div>
          </div>
          <div className="stat">
            <div className="value">{stats.weak}</div>
            <div className="label">do powtórki</div>
          </div>
        </div>
      </div>
    </>
  );
}
