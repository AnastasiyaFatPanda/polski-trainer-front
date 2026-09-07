import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProgressMap, SessionConfig, VocabEntry, Vocabulary } from '../types';
import { buildOptions, entriesForConfig, pickEntries } from '../lib/session';
import { acceptedForms, grade } from '../lib/text';
import { prefetchPolish, speakPolish, stopSpeaking, type TtsSettings } from '../lib/tts';
import {
  MAX_ATTEMPTS,
  STAGES,
  STAGE_HINTS,
  STAGE_LABELS,
  answerUniversal,
  attemptsFor,
  missedCount,
  perfectRunLength,
  startUniversal,
} from '../lib/universal';
import SpeakButton from './SpeakButton';

interface Props {
  doc: Vocabulary;
  config: SessionConfig;
  progress: ProgressMap;
  tts: TtsSettings;
  onRecord: (entryId: string, correct: boolean) => void;
  onExit: () => void;
}

export default function UniversalTraining({ doc, config, progress, tts, onRecord, onExit }: Props) {
  const pool = useMemo(() => entriesForConfig(doc, config, progress), [doc, config, progress]);
  const [lesson] = useState<VocabEntry[]>(() => pickEntries(pool, config.length, progress));
  const byId = useMemo(() => new Map(lesson.map((e) => [e.id, e])), [lesson]);

  const [state, setState] = useState(() => startUniversal(lesson.map((e) => e.id)));
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<'correct' | 'diacritics' | 'wrong' | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentId = state.queue[0];
  const entry = currentId ? byId.get(currentId) : undefined;
  const answered = verdict !== null;
  const isChoice = state.stage === 'pl-ru';
  const isTyped = state.stage === 'ru-pl' || state.stage === 'audio-pl';
  const lastTry = entry ? attemptsFor(state, entry.id) >= MAX_ATTEMPTS - 1 : false;

  const options = useMemo(
    () => (entry && isChoice ? buildOptions(entry, pool, 'ru') : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.id, isChoice, state.answered],
  );

  useEffect(() => {
    void prefetchPolish(
      lesson.map((e) => e.pl),
      tts,
    );
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The intro reads every word aloud; the listening stage plays it as the prompt. */
  useEffect(() => {
    if (!entry || answered) return;
    if (state.stage === 'intro' || state.stage === 'audio-pl') void speakPolish(entry.pl, tts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, state.stage, state.answered]);

  useEffect(() => {
    if (isTyped && !answered) inputRef.current?.focus();
  }, [currentId, isTyped, answered, state.stage]);

  const commit = useCallback(
    (correct: boolean) => {
      if (!entry) return;
      setVerdict(correct ? 'correct' : 'wrong');
      onRecord(entry.id, correct);
      void speakPolish(entry.pl, tts);
    },
    [entry, onRecord, tts],
  );

  const answerChoice = (option: string): void => {
    if (answered || !entry) return;
    setChosen(option);
    commit(option === entry.ru);
  };

  const answerTyped = (): void => {
    if (answered || !entry || !typed.trim()) return;
    const result = grade(typed, acceptedForms(entry.pl));
    const correct = result.verdict === 'correct' || result.verdict === 'diacritics';
    setVerdict(result.verdict === 'diacritics' ? 'diacritics' : correct ? 'correct' : 'wrong');
    onRecord(entry.id, correct);
    void speakPolish(entry.pl, tts);
  };

  const next = useCallback((): void => {
    stopSpeaking();
    setState((prev) => answerUniversal(prev, verdict !== 'wrong'));
    setTyped('');
    setVerdict(null);
    setChosen(null);
  }, [verdict]);

  /* Intro has no answer step — Enter just moves along. */
  const advanceIntro = useCallback((): void => {
    stopSpeaking();
    setState((prev) => answerUniversal(prev, true));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (state.done) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (state.stage === 'intro') advanceIntro();
        else if (answered) next();
        else if (isTyped) answerTyped();
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

  /* ------------------------------------------------------------ summary */

  if (state.done || !entry) {
    const missed = missedCount(state);
    const perfect = perfectRunLength(lesson.length);
    return (
      <div className="card">
        <div className="center">
          <div className="score">
            {lesson.length - missed}/{lesson.length}
          </div>
          <p className="muted">
            {missed === 0
              ? 'Bez błędu przez wszystkie cztery etapy.'
              : `${missed} ${missed === 1 ? 'słowo wymagało' : 'słów wymagało'} powtórki.`}
            {state.answered > perfect && ` · ${state.answered} odpowiedzi zamiast ${perfect}`}
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button className="btn primary" onClick={onExit}>
              Zakończ
            </button>
          </div>
        </div>

        <div className="review">
          {lesson.map((item) => {
            const stagesMissed = STAGES.filter((s) => (state.missed[s] ?? []).includes(item.id));
            return (
              <div className="review-row" key={item.id}>
                <span className="mark">{stagesMissed.length === 0 ? '✓' : '✗'}</span>
                <span className="pl">
                  {item.pl}
                  <SpeakButton text={item.pl} settings={tts} />
                </span>
                <span className="ru">{item.ru}</span>
                {stagesMissed.length > 0 && (
                  <span className="given">
                    {stagesMissed.map((s) => STAGE_LABELS[s].toLowerCase()).join(', ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ question */

  const stageIndex = STAGES.indexOf(state.stage);
  const perfect = perfectRunLength(lesson.length);
  const percent = Math.min(100, Math.round((state.answered * 100) / Math.max(1, perfect)));

  return (
    <div>
      <div className="session-head">
        <button className="btn ghost small" onClick={onExit}>
          ← Wyjdź
        </button>
        <div className="progressbar">
          <div style={{ width: `${percent}%` }} />
        </div>
        <span className="counter">
          {stageIndex + 1} / {STAGES.length}
        </span>
      </div>

      <div className="chips" style={{ marginBottom: 16, justifyContent: 'center' }}>
        {STAGES.map((s, i) => (
          <span
            key={s}
            className="chip"
            aria-pressed={s === state.stage}
            aria-disabled={i > stageIndex}
            style={{ cursor: 'default', opacity: i > stageIndex ? 0.45 : 1 }}
          >
            {i < stageIndex ? '✓ ' : ''}
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="card">
        <div className="prompt">
          <div className="label">{STAGE_HINTS[state.stage]}</div>

          {state.stage === 'intro' && (
            <>
              <div className="word">
                {entry.pl} <SpeakButton text={entry.pl} settings={tts} />
              </div>
              <div className="hint" style={{ fontSize: 17, marginTop: 6 }}>
                {entry.ru}
              </div>
              {entry.examples[0] && (
                <div className="hint" style={{ marginTop: 14 }}>
                  {entry.examples[0].pl}
                  <SpeakButton text={entry.examples[0].pl} settings={tts} />
                  <br />
                  <span style={{ opacity: 0.75 }}>{entry.examples[0].ru}</span>
                </div>
              )}
            </>
          )}

          {state.stage === 'pl-ru' && (
            <div className="word">
              {entry.pl} <SpeakButton text={entry.pl} settings={tts} />
            </div>
          )}

          {state.stage === 'ru-pl' && <div className="word">{entry.ru}</div>}

          {state.stage === 'audio-pl' && (
            <>
              <SpeakButton text={entry.pl} settings={tts} variant="big" />
              <div className="hint">{answered ? entry.pl : 'kliknij, aby powtórzyć'}</div>
            </>
          )}

          {!answered && lastTry && state.stage !== 'intro' && (
            <div className="hint" style={{ color: 'var(--warn)' }}>
              ostatnia próba tego słowa w tym etapie
            </div>
          )}
        </div>

        {state.stage === 'intro' && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={advanceIntro}>
              {state.queue.length > 1 ? 'Dalej →' : 'Zacznij ćwiczyć →'}
            </button>
          </div>
        )}

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

        {isTyped && (
          <div className="row" style={{ marginTop: 4 }}>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              disabled={answered}
              placeholder="Po polsku…"
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
              <strong>{entry.pl}</strong>
              <SpeakButton text={entry.pl} settings={tts} />
              <span className="muted"> — {entry.ru}</span>
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
        {state.stage === 'intro'
          ? `Słówko ${lesson.length - state.queue.length + 1} z ${lesson.length} · Enter przechodzi dalej`
          : `Pozostało w tym etapie: ${state.queue.length} · ${isChoice ? '1–5 wybiera odpowiedź · ' : ''}Enter przechodzi dalej`}
      </p>
    </div>
  );
}
