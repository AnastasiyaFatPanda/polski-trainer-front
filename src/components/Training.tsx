import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Answer, Example, ProgressMap, SessionConfig, VocabEntry, Vocabulary } from '../types';
import { buildOptions, entriesForConfig, pickEntries } from '../lib/session';
import { acceptedForms, countWords, editDistance, foldDiacritics, grade } from '../lib/text';
import { prefetchPolish, speakPolish, stopSpeaking, type TtsSettings } from '../lib/tts';
import { generateSentence } from '../lib/api';
import SpeakButton from './SpeakButton';

interface Props {
  doc: Vocabulary;
  config: SessionConfig;
  progress: ProgressMap;
  tts: TtsSettings;
  sentenceApi: boolean;
  onRecord: (entryId: string, correct: boolean) => void;
  onExampleSaved: (entryId: string, example: Example) => void;
  onExit: () => void;
}

const TRAINING_TITLE: Record<SessionConfig['training'], string> = {
  'pl-ru-choice': 'Polski → Rosyjski',
  'ru-pl-typed': 'Rosyjski → Polski',
  'audio-ru-choice': 'Słuchanie → Rosyjski',
  sentence: 'Zdania z nowym słowem',
};

/** Free translation is graded leniently — small typos shouldn't read as failure. */
function sentenceMatches(given: string, expected: string): boolean {
  const g = foldDiacritics(given);
  const e = foldDiacritics(expected);
  if (!g) return false;
  if (g === e) return true;
  const tolerance = Math.max(2, Math.round(e.length * 0.12));
  return editDistance(g, e) <= tolerance;
}

export default function Training(props: Props) {
  const { doc, config, progress, tts, sentenceApi, onRecord, onExampleSaved, onExit } = props;

  const pool = useMemo(() => entriesForConfig(doc, config), [doc, config]);
  const [queue] = useState<VocabEntry[]>(() => pickEntries(pool, config.length, progress));

  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<'correct' | 'diacritics' | 'wrong' | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);

  const [example, setExample] = useState<Example | null>(null);
  const [exampleState, setExampleState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [exampleError, setExampleError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const entry = queue[index];
  const isChoice = config.training === 'pl-ru-choice' || config.training === 'audio-ru-choice';
  const finished = index >= queue.length;

  const options = useMemo(
    () => (entry && isChoice ? buildOptions(entry, pool, 'ru') : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id, isChoice],
  );

  /* Warm the audio cache a few questions ahead so playback is instant. */
  useEffect(() => {
    const upcoming = queue.slice(0, 6).map((e) => e.pl);
    void prefetchPolish(upcoming, tts);
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Resolve the example sentence: file first, API only when nothing is stored. */
  useEffect(() => {
    if (config.training !== 'sentence' || !entry) return;
    setExample(null);
    setExampleError('');

    const stored = entry.examples;
    if (stored.length > 0) {
      setExample(stored[Math.floor(Math.random() * stored.length)]);
      setExampleState('idle');
      return;
    }
    if (!sentenceApi) {
      setExampleState('error');
      setExampleError(
        'Brak zdania w pliku, a klucz API nie jest ustawiony. Dodaj ANTHROPIC_API_KEY do .env albo dopisz przykład w słowniku.',
      );
      return;
    }

    let cancelled = false;
    setExampleState('loading');
    generateSentence(entry.id)
      .then((created) => {
        if (cancelled) return;
        setExample(created);
        setExampleState('idle');
        onExampleSaved(entry.id, created);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setExampleState('error');
        setExampleError(error.message);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, config.training, sentenceApi]);

  /* Auto-play the word in the listening training. */
  useEffect(() => {
    if (config.training !== 'audio-ru-choice' || !entry || answered) return;
    void speakPolish(entry.pl, tts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, config.training]);

  useEffect(() => {
    if (!answered && !isChoice) inputRef.current?.focus();
  }, [index, answered, isChoice]);

  const spokenAnswer = config.training === 'sentence' ? (example?.pl ?? '') : (entry?.pl ?? '');

  const commit = useCallback(
    (correct: boolean, given: string, expected: string) => {
      setAnswered(true);
      setAnswers((prev) => [...prev, { entryId: entry.id, correct, given, expected }]);
      onRecord(entry.id, correct);
      // Always read the correct Polish back — the point of the exercise.
      if (spokenAnswer) void speakPolish(spokenAnswer, tts);
    },
    [entry, onRecord, spokenAnswer, tts],
  );

  const answerChoice = (option: string): void => {
    if (answered) return;
    setChosen(option);
    const correct = option === entry.ru;
    setVerdict(correct ? 'correct' : 'wrong');
    commit(correct, option, entry.ru);
  };

  const answerTyped = (): void => {
    if (answered || !typed.trim()) return;
    if (config.training === 'sentence') {
      const expected = example?.pl ?? '';
      const correct = sentenceMatches(typed, expected);
      setVerdict(correct ? 'correct' : 'wrong');
      commit(correct, typed.trim(), expected);
      return;
    }
    const result = grade(typed, acceptedForms(entry.pl));
    const correct = result.verdict === 'correct' || result.verdict === 'diacritics';
    setVerdict(result.verdict === 'diacritics' ? 'diacritics' : correct ? 'correct' : 'wrong');
    commit(correct, typed.trim(), entry.pl);
  };

  /** Free translation can be right without matching the reference sentence. */
  const overrideCorrect = (): void => {
    setVerdict('correct');
    setAnswers((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && !last.correct) {
        next[next.length - 1] = { ...last, correct: true };
        onRecord(last.entryId, true);
      }
      return next;
    });
  };

  const next = useCallback((): void => {
    stopSpeaking();
    setAnswered(false);
    setChosen(null);
    setTyped('');
    setVerdict(null);
    setIndex((i) => i + 1);
  }, []);

  /* Keyboard: 1–5 pick an option, Enter answers or advances. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (finished) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (answered) next();
        else if (!isChoice) answerTyped();
        return;
      }
      if (isChoice && !answered && /^[1-5]$/.test(event.key)) {
        const option = options[Number(event.key) - 1];
        if (option) answerChoice(option);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------------------------------------- results */

  if (finished) {
    const correctCount = answers.filter((a) => a.correct).length;
    const percent = answers.length ? Math.round((correctCount * 100) / answers.length) : 0;
    const byId = new Map(doc.entries.map((e) => [e.id, e]));

    return (
      <div className="card">
        <div className="center">
          <div className="score">
            {correctCount}/{answers.length}
          </div>
          <p className="muted">{percent}% poprawnych — {TRAINING_TITLE[config.training]}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button className="btn primary" onClick={onExit}>
              Zakończ
            </button>
          </div>
        </div>

        <div className="review">
          {answers.map((answer, i) => {
            const item = byId.get(answer.entryId);
            return (
              <div className="review-row" key={`${answer.entryId}-${i}`}>
                <span className="mark">{answer.correct ? '✓' : '✗'}</span>
                <span className="pl">
                  {item?.pl}
                  {item && <SpeakButton text={item.pl} settings={tts} />}
                </span>
                <span className="ru">{item?.ru}</span>
                {!answer.correct && answer.given && <span className="given">ty: {answer.given}</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="card center">
        <p>Brak słów spełniających te kryteria.</p>
        <button className="btn" onClick={onExit}>
          Wróć
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------------- question */

  const percentDone = Math.round((index * 100) / queue.length);

  return (
    <div>
      <div className="session-head">
        <button className="btn ghost small" onClick={onExit}>
          ← Wyjdź
        </button>
        <div className="progressbar">
          <div style={{ width: `${percentDone}%` }} />
        </div>
        <span className="counter">
          {index + 1} / {queue.length}
        </span>
      </div>

      <div className="card">
        <div className="prompt">
          {config.training === 'pl-ru-choice' && (
            <>
              <div className="label">Co to znaczy?</div>
              <div className="word">
                {entry.pl} <SpeakButton text={entry.pl} settings={tts} />
              </div>
            </>
          )}

          {config.training === 'ru-pl-typed' && (
            <>
              <div className="label">Napisz po polsku</div>
              <div className="word">{entry.ru}</div>
              <div className="hint">{entry.type === 'phrase' ? 'zwrot' : 'słowo'}</div>
            </>
          )}

          {config.training === 'audio-ru-choice' && (
            <>
              <div className="label">Posłuchaj i wybierz znaczenie</div>
              <SpeakButton text={entry.pl} settings={tts} variant="big" />
              <div className="hint">{answered ? entry.pl : 'kliknij, aby powtórzyć'}</div>
            </>
          )}

          {config.training === 'sentence' && (
            <>
              <div className="label">
                Przetłumacz na polski · użyj słowa <strong>{entry.pl}</strong>
              </div>
              {exampleState === 'loading' && (
                <div className="muted">
                  <span className="spinner" /> układam zdanie…
                </div>
              )}
              {exampleState === 'error' && <div className="notice error">{exampleError}</div>}
              {example && <div className="word small">{example.ru}</div>}
              {example && (
                <div className="hint">
                  max 8 słówek · {countWords(example.pl)} w zdaniu wzorcowym
                </div>
              )}
            </>
          )}
        </div>

        {isChoice && (
          <div className="options">
            {options.map((option, i) => {
              const isAnswer = option === entry.ru;
              const isPicked = option === chosen;
              const className = !answered
                ? 'option'
                : isAnswer
                  ? 'option correct'
                  : isPicked
                    ? 'option wrong'
                    : 'option dim';
              return (
                <button
                  key={option}
                  className={className}
                  disabled={answered}
                  onClick={() => answerChoice(option)}
                >
                  <span className="key">{i + 1}</span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        )}

        {!isChoice && (
          <div className="row" style={{ marginTop: 4 }}>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              disabled={answered || exampleState === 'loading'}
              placeholder={config.training === 'sentence' ? 'Napisz zdanie po polsku…' : 'Po polsku…'}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              lang="pl"
              style={{ flex: 1, minWidth: 220 }}
            />
            {!answered ? (
              <button className="btn primary" disabled={!typed.trim()} onClick={answerTyped}>
                Sprawdź
              </button>
            ) : (
              <button className="btn primary" onClick={next}>
                Dalej →
              </button>
            )}
          </div>
        )}

        {answered && (
          <>
            <div
              className={`verdict ${verdict === 'correct' ? 'correct' : verdict === 'diacritics' ? 'partial' : 'wrong'}`}
            >
              {verdict === 'correct' && <>Dobrze! </>}
              {verdict === 'diacritics' && <>Prawie — brakuje polskich znaków: </>}
              {verdict === 'wrong' && <>Poprawnie: </>}
              <strong>{config.training === 'sentence' ? example?.pl : entry.pl}</strong>
              <SpeakButton text={spokenAnswer} settings={tts} />
              {config.training !== 'sentence' && <span className="muted"> — {entry.ru}</span>}
              {config.training === 'sentence' && verdict === 'wrong' && (
                <>
                  {' '}
                  <button className="btn small ghost" onClick={overrideCorrect}>
                    moje też jest dobre
                  </button>
                </>
              )}
            </div>

            {isChoice && (
              <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                <button className="btn primary" onClick={next}>
                  Dalej →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="muted center" style={{ fontSize: 12.5, marginTop: 12 }}>
        {isChoice ? '1–5 wybiera odpowiedź · Enter przechodzi dalej' : 'Enter sprawdza i przechodzi dalej'}
      </p>
    </div>
  );
}
