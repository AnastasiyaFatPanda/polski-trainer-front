import { useEffect, useState } from 'react';
import type { ServerStatus } from '../lib/api';
import {
  DEFAULT_TTS,
  PIPER_VOICES,
  downloadPiperVoice,
  piperStoredVoices,
  removePiperVoice,
  speakPolish,
  systemPolishVoice,
  type PiperVoiceId,
  type TtsSettings,
} from '../lib/tts';
import { clearClips, countClips } from '../lib/audioCache';
import { flushProgress } from '../lib/progressStore';

interface Props {
  tts: TtsSettings;
  onTtsChange: (settings: TtsSettings) => void;
  status: ServerStatus | null;
  onResetProgress: () => void;
}

const TEST_SENTENCE = 'Cześć! Dziś ćwiczymy polskie słówka — źdźbło, węże, ślimak.';

export default function SettingsView({ tts, onTtsChange, status, onResetProgress }: Props) {
  const [stored, setStored] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  const [clips, setClips] = useState(0);
  const [systemVoiceName, setSystemVoiceName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = (): void => {
    void piperStoredVoices().then(setStored);
    void countClips().then(setClips);
    setSystemVoiceName(systemPolishVoice()?.name ?? null);
  };

  useEffect(() => {
    refresh();
    const timer = setTimeout(refresh, 800); // system voices load asynchronously
    return () => clearTimeout(timer);
  }, []);

  const download = async (voiceId: string): Promise<void> => {
    setDownloading(true);
    setError('');
    setPercent(0);
    try {
      await downloadPiperVoice(voiceId, setPercent);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const voiceReady = stored.includes(tts.piperVoice);

  return (
    <>
      <div className="card">
        <h2>Wymowa</h2>
        <p className="sub">Czym aplikacja czyta polskie słowa i zdania.</p>

        <div className="chips" style={{ marginBottom: 18 }}>
          <button
            className="chip"
            aria-pressed={tts.engine === 'piper'}
            onClick={() => onTtsChange({ ...tts, engine: 'piper' })}
          >
            Piper — głos neuronowy
          </button>
          <button
            className="chip"
            aria-pressed={tts.engine === 'system'}
            onClick={() => onTtsChange({ ...tts, engine: 'system' })}
          >
            Głos systemowy macOS
          </button>
        </div>

        {tts.engine === 'piper' && (
          <>
            <div className="notice info">
              Piper to model neuronowy uczony na polskim głosie — czyta ą, ę, rz, sz i akcent
              poprawnie, w przeciwieństwie do głosu systemowego. Model (~60 MB) pobiera się raz i
              działa potem offline. Zanim go pobierzesz, czyta głos systemowy.
            </div>

            <label className="field">
              <span>Głos</span>
              <select
                value={tts.piperVoice}
                onChange={(e) => onTtsChange({ ...tts, piperVoice: e.target.value as PiperVoiceId })}
              >
                {PIPER_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                    {stored.includes(voice.id) ? ' — pobrany' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="row">
              {voiceReady ? (
                <>
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    ✓ Model gotowy, działa offline.
                  </span>
                  <button
                    className="btn small ghost danger"
                    onClick={() => void removePiperVoice(tts.piperVoice).then(refresh)}
                  >
                    Usuń model
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  disabled={downloading}
                  onClick={() => void download(tts.piperVoice)}
                >
                  {downloading ? `Pobieram… ${percent}%` : 'Pobierz model głosu'}
                </button>
              )}
            </div>

            {error && (
              <div className="notice error" style={{ marginTop: 12 }}>
                {error} — aplikacja będzie czytać głosem systemowym.
              </div>
            )}
          </>
        )}

        {tts.engine === 'system' && (
          <div className={`notice ${systemVoiceName ? 'info' : 'warn'}`}>
            {systemVoiceName ? (
              <>Używany głos: <strong>{systemVoiceName}</strong>.</>
            ) : (
              <>
                Nie znaleziono polskiego głosu w systemie. Zainstaluj go w{' '}
                <strong>Ustawienia systemowe → Dostępność → Treść mówiona → Głos systemowy →
                Zarządzaj głosami</strong> (polski: Zosia), albo przełącz się na Piper.
              </>
            )}
          </div>
        )}

        <label className="field" style={{ marginTop: 18 }}>
          <span>Tempo mowy — {tts.rate.toFixed(2)}×</span>
          <input
            type="range"
            min={0.6}
            max={1.3}
            step={0.05}
            value={tts.rate}
            onChange={(e) => onTtsChange({ ...tts, rate: Number(e.target.value) })}
          />
        </label>

        <div className="row">
          <button className="btn" onClick={() => void speakPolish(TEST_SENTENCE, tts)}>
            🔊 Przetestuj
          </button>
          <button className="btn ghost" onClick={() => onTtsChange(DEFAULT_TTS)}>
            Ustawienia domyślne
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Zdania generowane</h2>
        <p className="sub">
          Trening „Zdania" bierze zdania najpierw z pliku. Jeśli słowo nie ma żadnego, prosi o nie
          Claude i dopisuje wynik do <code>data/vocabulary.json</code> — więc każde zdanie powstaje
          tylko raz.
        </p>
        {status ? (
          <div className={`notice ${status.sentenceApi ? 'info' : 'warn'}`}>
            {status.sentenceApi ? (
              <>
                ✓ Klucz API wykryty. Model: <code>{status.model}</code>.
              </>
            ) : (
              <>
                Brak <code>ANTHROPIC_API_KEY</code>. Skopiuj <code>.env.example</code> do{' '}
                <code>.env</code>, wpisz klucz i zrestartuj <code>npm run dev</code>. Bez klucza
                trening „Zdania" działa tylko na słowach, które mają przykłady w pliku.
              </>
            )}
          </div>
        ) : (
          <div className="notice warn">Serwer nie odpowiada — uruchom <code>npm run dev</code>.</div>
        )}
        {status && (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            Plik słownika: <code>{status.file}</code>
          </p>
        )}
      </div>

      <div className="card">
        <h2>Postęp nauki</h2>
        <p className="sub">
          Zapisywany do pliku, więc przetrwa wyczyszczenie przeglądarki i działa też po zmianie
          przeglądarki.
        </p>
        <div className={`notice ${status ? 'info' : 'warn'}`}>
          {status ? (
            <>
              ✓ Zapisywany do <code>{status.progressFile}</code>. Przy starcie plik i kopia w
              przeglądarce są scalane — dla każdego słowa wygrywa nowszy wynik.
            </>
          ) : (
            <>
              Serwer nie odpowiada — postęp zapisuje się tylko w tej przeglądarce i trafi do pliku
              przy następnym uruchomieniu <code>npm run dev</code>.
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Dane</h2>
        <p className="sub">Postęp i cache audio trzymane są w tej przeglądarce.</p>
        <div className="row">
          <span className="muted" style={{ fontSize: 13.5, marginRight: 'auto' }}>
            {clips} nagrań w cache
          </span>
          <button className="btn" onClick={() => void clearClips().then(refresh)}>
            Wyczyść cache audio
          </button>
          <button className="btn" onClick={() => void flushProgress().then(() => setSaved(true))}>
            {saved ? '✓ Zapisano' : 'Zapisz postęp teraz'}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Wyzerować cały postęp nauki?')) onResetProgress();
            }}
          >
            Wyzeruj postęp
          </button>
        </div>
      </div>
    </>
  );
}
