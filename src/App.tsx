import { useCallback, useEffect, useState } from 'react';
import type { Example, ProgressMap, SessionConfig, Vocabulary } from './types';
import { getStatus, loadVocabulary, saveVocabulary, type ServerStatus } from './lib/api';
import { loadProgress, record, saveProgress } from './lib/progress';
import { DEFAULT_TTS, type TtsSettings } from './lib/tts';
import { useLocalStorage } from './lib/useLocalStorage';
import Home from './components/Home';
import Training from './components/Training';
import UniversalTraining from './components/UniversalTraining';
import VocabularyView from './components/VocabularyView';
import SetsView from './components/SetsView';
import SettingsView from './components/SettingsView';

type View = 'home' | 'vocab' | 'sets' | 'settings' | 'training';

const DEFAULT_CONFIG: SessionConfig = {
  training: 'pl-ru-choice',
  setIds: [],
  types: ['word', 'phrase'],
  length: 20,
};

export default function App() {
  const [doc, setDoc] = useState<Vocabulary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [view, setView] = useState<View>('home');
  const [toast, setToast] = useState('');
  // Lifted so the Zestawy page can open the słownik already filtered.
  const [vocabSetFilter, setVocabSetFilter] = useState('');

  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [tts, setTts] = useLocalStorage<TtsSettings>('polski-trainer:tts:v1', DEFAULT_TTS);
  const [config, setConfig] = useLocalStorage<SessionConfig>(
    'polski-trainer:config:v1',
    DEFAULT_CONFIG,
  );

  useEffect(() => {
    loadVocabulary().then(setDoc).catch((e: Error) => setLoadError(e.message));
    getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Every change to the vocabulary is written straight back to the file on disk. */
  const updateDoc = useCallback((next: Vocabulary, note?: string): void => {
    setDoc(next);
    saveVocabulary(next)
      .then(() => note && setToast(note))
      .catch((e: Error) => setToast(`Nie zapisano do pliku: ${e.message}`));
  }, []);

  const handleRecord = useCallback((entryId: string, correct: boolean): void => {
    setProgress((prev) => {
      const next = record(prev, entryId, correct);
      saveProgress(next);
      return next;
    });
  }, []);

  /** A sentence generated during training was already persisted server-side. */
  const handleExampleSaved = useCallback((entryId: string, example: Example): void => {
    setDoc((prev) =>
      prev
        ? {
            ...prev,
            entries: prev.entries.map((e) =>
              e.id === entryId ? { ...e, examples: [...e.examples, example] } : e,
            ),
          }
        : prev,
    );
  }, []);

  if (loadError) {
    return (
      <div className="app">
        <div className="card">
          <div className="notice error">Nie udało się wczytać słownika: {loadError}</div>
          <p className="muted">
            Uruchom aplikację przez <code>npm run dev</code> — plik <code>data/vocabulary.json</code>{' '}
            jest podawany przez serwer deweloperski.
          </p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="app">
        <p className="muted center" style={{ marginTop: 80 }}>
          <span className="spinner" /> Wczytuję słownik…
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Polski <span>Trainer</span>
        </div>
        {view !== 'training' && (
          <nav className="nav">
            <button aria-current={view === 'home'} onClick={() => setView('home')}>
              Trening
            </button>
            <button
              aria-current={view === 'vocab' || view === 'sets'}
              onClick={() => setView('vocab')}
            >
              Słownik
            </button>
            <button aria-current={view === 'settings'} onClick={() => setView('settings')}>
              Ustawienia
            </button>
          </nav>
        )}
      </header>

      {toast && <div className="notice info">{toast}</div>}

      {view === 'home' && (
        <Home
          doc={doc}
          progress={progress}
          config={config}
          onConfigChange={setConfig}
          onStart={() => setView('training')}
        />
      )}

      {view === 'training' && config.training === 'universal' && (
        <UniversalTraining
          key={`universal-${config.setIds.join('.')}-${config.length}`}
          doc={doc}
          config={config}
          progress={progress}
          tts={tts}
          onRecord={handleRecord}
          onExit={() => setView('home')}
        />
      )}

      {view === 'training' && config.training !== 'universal' && (
        <Training
          key={`${config.training}-${config.setIds.join('.')}-${config.length}`}
          doc={doc}
          config={config}
          progress={progress}
          tts={tts}
          sentenceApi={Boolean(status?.sentenceApi)}
          onRecord={handleRecord}
          onExampleSaved={handleExampleSaved}
          onExit={() => setView('home')}
        />
      )}

      {view === 'vocab' && (
        <VocabularyView
          doc={doc}
          progress={progress}
          tts={tts}
          onChange={updateDoc}
          setFilter={vocabSetFilter}
          onSetFilterChange={setVocabSetFilter}
          onOpenSets={() => setView('sets')}
        />
      )}

      {view === 'sets' && (
        <SetsView
          doc={doc}
          onChange={(next, note) => {
            // A deleted set must not stay selected as a filter.
            if (!next.sets.some((s) => s.id === vocabSetFilter)) setVocabSetFilter('');
            updateDoc(next, note);
          }}
          onOpenVocabulary={(setId) => {
            setVocabSetFilter(setId);
            setView('vocab');
          }}
          onBack={() => setView('vocab')}
        />
      )}

      {view === 'settings' && (
        <SettingsView
          tts={tts}
          onTtsChange={setTts}
          status={status}
          onResetProgress={() => {
            setProgress({});
            saveProgress({});
            setToast('Postęp wyzerowany.');
          }}
        />
      )}
    </div>
  );
}
