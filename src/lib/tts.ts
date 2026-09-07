import { getClip, putClip } from './audioCache';

/**
 * Polish speech, best engine first.
 *
 *  piper  — Piper neural TTS (pl_PL-gosia-medium) compiled to WASM. Runs entirely
 *           in the browser, model is downloaded once (~60 MB) into the origin
 *           private file system and then works offline. Natural Polish prosody,
 *           correct ą/ę/ł/rz/sz handling — this is the one you want.
 *  system — the OS voice via speechSynthesis (macOS "Zosia"). Zero download,
 *           always available, noticeably more robotic. Used as fallback and
 *           while the Piper model is still downloading.
 */
export type TtsEngine = 'piper' | 'system';

export const PIPER_VOICES = [
  { id: 'pl_PL-gosia-medium', label: 'Gosia — female (recommended)' },
  { id: 'pl_PL-darkman-medium', label: 'Darkman — male' },
  { id: 'pl_PL-mc_speech-medium', label: 'MC Speech — male' },
] as const;

export type PiperVoiceId = (typeof PIPER_VOICES)[number]['id'];

export interface TtsSettings {
  engine: TtsEngine;
  piperVoice: PiperVoiceId;
  rate: number;
}

export const DEFAULT_TTS: TtsSettings = {
  engine: 'piper',
  piperVoice: 'pl_PL-gosia-medium',
  rate: 0.95,
};

type PiperModule = {
  predict(options: { text: string; voiceId: string }): Promise<Blob>;
  download(voiceId: string, onProgress?: (p: { loaded: number; total: number }) => void): Promise<void>;
  stored(): Promise<string[]>;
  remove(voiceId: string): Promise<void>;
};

let piperModule: PiperModule | null = null;
let piperBroken = false;

async function loadPiper(): Promise<PiperModule | null> {
  if (piperModule) return piperModule;
  if (piperBroken) return null;
  try {
    piperModule = (await import('@mintplex-labs/piper-tts-web')) as unknown as PiperModule;
    return piperModule;
  } catch (error) {
    console.warn('[tts] Piper unavailable, falling back to system voice:', error);
    piperBroken = true;
    return null;
  }
}

export async function piperStoredVoices(): Promise<string[]> {
  const piper = await loadPiper();
  if (!piper) return [];
  try {
    return await piper.stored();
  } catch {
    return [];
  }
}

export async function downloadPiperVoice(
  voiceId: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const piper = await loadPiper();
  if (!piper) throw new Error('Piper engine could not be loaded in this browser.');
  await piper.download(voiceId, (p) => {
    if (p.total > 0) onProgress?.(Math.round((p.loaded * 100) / p.total));
  });
}

export async function removePiperVoice(voiceId: string): Promise<void> {
  const piper = await loadPiper();
  if (piper) await piper.remove(voiceId);
}

/* ------------------------------------------------------------------ system */

let cachedSystemVoice: SpeechSynthesisVoice | null | undefined;

export function systemPolishVoice(): SpeechSynthesisVoice | null {
  if (cachedSystemVoice !== undefined) return cachedSystemVoice;
  if (typeof speechSynthesis === 'undefined') {
    cachedSystemVoice = null;
    return null;
  }
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null; // not loaded yet — don't cache the miss
  const polish = voices.filter((v) => v.lang.toLowerCase().startsWith('pl'));
  cachedSystemVoice = polish.find((v) => !v.localService) ?? polish[0] ?? null;
  return cachedSystemVoice;
}

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => {
    cachedSystemVoice = undefined;
  });
}

function speakWithSystem(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve();
    // speechSynthesis.speak() can throw outright (bad utterance, browser in a
    // state that refuses speech). This is the last link in the fallback chain,
    // so it must resolve rather than reject — see the invariant in AGENTS.md.
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = systemPolishVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = 'pl-PL';
      utterance.rate = rate;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn('[tts] system voice unavailable:', error);
      resolve();
    }
  });
}

/* ------------------------------------------------------------------ speak */

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

function playBlob(blob: Blob, rate: number): Promise<void> {
  return new Promise((resolve) => {
    stopSpeaking();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.playbackRate = rate;
    currentAudio = audio;
    const done = () => {
      URL.revokeObjectURL(audio.src);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  });
}

/**
 * Speak Polish text. Never throws — if the neural engine is missing, not yet
 * downloaded or errors mid-synthesis, the system voice takes over so a training
 * session is never blocked by audio.
 */
export async function speakPolish(text: string, settings: TtsSettings): Promise<void> {
  const clean = text.trim();
  if (!clean) return;

  if (settings.engine === 'piper') {
    const key = `${settings.piperVoice}:${clean}`;
    const cached = await getClip(key);
    if (cached) return playBlob(cached, settings.rate);

    const piper = await loadPiper();
    if (piper) {
      try {
        const wav = await piper.predict({ text: clean, voiceId: settings.piperVoice });
        void putClip(key, wav);
        return await playBlob(wav, settings.rate);
      } catch (error) {
        console.warn('[tts] Piper synthesis failed, using system voice:', error);
      }
    }
  }

  return speakWithSystem(clean, settings.rate);
}

/** Warm the cache for the next few questions so playback feels instant. */
export async function prefetchPolish(texts: string[], settings: TtsSettings): Promise<void> {
  if (settings.engine !== 'piper') return;
  const piper = await loadPiper();
  if (!piper) return;
  for (const text of texts) {
    const clean = text.trim();
    if (!clean) continue;
    const key = `${settings.piperVoice}:${clean}`;
    if (await getClip(key)) continue;
    try {
      const wav = await piper.predict({ text: clean, voiceId: settings.piperVoice });
      await putClip(key, wav);
    } catch {
      return; // engine unhappy — stop prefetching, playback will fall back
    }
  }
}
