import { useMemo } from 'react';
import type { EntryType, ProgressMap, SessionConfig, TrainingId, Vocabulary } from '../types';
import { entriesForConfig, sessionLengthOptions } from '../lib/session';
import { PROGRESS_FILTER_LABELS, matchesProgress } from '../lib/progress';
import type { ProgressFilter } from '../types';

interface Props {
  doc: Vocabulary;
  progress: ProgressMap;
  config: SessionConfig;
  onConfigChange: (config: SessionConfig) => void;
  onStart: () => void;
  /** Stat tile → open the słownik filtered to that bucket. */
  onOpenVocabulary: (filter: ProgressFilter) => void;
  /** Stat tile → start a universal lesson built from that bucket. */
  onTrainBucket: (filter: ProgressFilter) => void;
}

const TRAININGS: { id: TrainingId; title: string; flow: string; desc: string }[] = [
  {
    id: 'universal',
    title: 'Uniwersalny',
    flow: '📖 → PL/RU → 🔊',
    desc: 'Mała porcja słówek przez cztery etapy: poznaj, rozpoznaj, napisz, posłuchaj i napisz.',
  },
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

export default function Home({
  doc,
  progress,
  config,
  onConfigChange,
  onStart,
  onOpenVocabulary,
  onTrainBucket,
}: Props) {
  const pool = useMemo(() => entriesForConfig(doc, config, progress), [doc, config, progress]);
  const bucket = config.progressFilter ?? 'all';

  const countsBySet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of doc.entries) {
      for (const setId of entry.sets) counts.set(setId, (counts.get(setId) ?? 0) + 1);
    }
    return counts;
  }, [doc]);

  const count = (filter: ProgressFilter): number =>
    doc.entries.filter((e) => matchesProgress(filter, progress[e.id])).length;

  const stats = useMemo(
    () => ({
      total: doc.entries.length,
      seen: count('practiced'),
      strong: count('mastered'),
      weak: count('review'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, progress],
  );

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

  const lengths = sessionLengthOptions(pool.length, config.training);

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
              onClick={() => {
                const allowed = sessionLengthOptions(pool.length, training.id);
                onConfigChange({
                  ...config,
                  training: training.id,
                  length: allowed.includes(config.length) ? config.length : allowed[0],
                });
              }}
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

          <label className="row" style={{ gap: 7 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Postęp:
            </span>
            <select
              value={bucket}
              onChange={(e) =>
                onConfigChange({ ...config, progressFilter: e.target.value as ProgressFilter })
              }
              style={{ width: 'auto' }}
            >
              {(Object.keys(PROGRESS_FILTER_LABELS) as ProgressFilter[]).map((f) => (
                <option key={f} value={f}>
                  {PROGRESS_FILTER_LABELS[f]} ({count(f)})
                </option>
              ))}
            </select>
          </label>

          <label className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {config.training === 'universal' ? 'Słówek:' : 'Pytań:'}
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
              : config.training === 'universal'
                ? `Lekcja: ${Math.min(config.length, pool.length)} ${
                    Math.min(config.length, pool.length) === 1 ? 'słówko' : 'słówek'
                  } × 4 etapy${pool.length < config.length ? ' (tyle jest w zestawie)' : ''}`
                : `${pool.length} ${pool.length === 1 ? 'pozycja' : 'pozycji'} w puli`}
          </span>
          <button className="btn primary" disabled={pool.length === 0} onClick={onStart}>
            Zacznij trening →
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Postęp</h2>
        <p className="sub">
          Liczony lokalnie w tej przeglądarce. Kliknij kafelek, żeby otworzyć te słowa.
        </p>
        <div className="stat-row">
          <button
            type="button"
            className="stat clickable"
            onClick={() => onOpenVocabulary('all')}
            title="Otwórz słownik"
          >
            <div className="value">{stats.total}</div>
            <div className="label">pozycji w słowniku</div>
            <div className="go">Słownik →</div>
          </button>

          <button
            type="button"
            className="stat clickable"
            disabled={stats.seen === 0}
            onClick={() => onOpenVocabulary('practiced')}
            title="Pokaż te słowa w słowniku"
          >
            <div className="value">{stats.seen}</div>
            <div className="label">już ćwiczonych</div>
            <div className="go">Słownik →</div>
          </button>

          <button
            type="button"
            className="stat clickable"
            disabled={stats.strong === 0}
            onClick={() => onTrainBucket('mastered')}
            title="Powtórz opanowane słowa w treningu uniwersalnym"
          >
            <div className="value">{stats.strong}</div>
            <div className="label">opanowanych</div>
            <div className="go">Ćwicz →</div>
          </button>

          <button
            type="button"
            className="stat clickable"
            disabled={stats.weak === 0}
            onClick={() => onTrainBucket('review')}
            title="Przećwicz słabe słowa w treningu uniwersalnym"
          >
            <div className="value">{stats.weak}</div>
            <div className="label">do powtórki</div>
            <div className="go">Ćwicz →</div>
          </button>
        </div>
      </div>
    </>
  );
}
