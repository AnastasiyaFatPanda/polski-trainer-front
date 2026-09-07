import { useState } from 'react';
import { speakPolish, type TtsSettings } from '../lib/tts';

interface Props {
  text: string;
  settings: TtsSettings;
  variant?: 'inline' | 'big';
  autoLabel?: string;
}

export default function SpeakButton({ text, settings, variant = 'inline', autoLabel }: Props) {
  const [playing, setPlaying] = useState(false);

  const play = async (): Promise<void> => {
    setPlaying(true);
    try {
      await speakPolish(text, settings);
    } finally {
      setPlaying(false);
    }
  };

  if (variant === 'big') {
    return (
      <button
        type="button"
        className={`speaker${playing ? ' playing' : ''}`}
        onClick={() => void play()}
        aria-label={autoLabel ?? 'Odtwórz nagranie'}
      >
        {playing ? '🔉' : '🔊'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="speak-inline"
      onClick={() => void play()}
      aria-label={autoLabel ?? `Przeczytaj: ${text}`}
      title="Przeczytaj po polsku"
    >
      {playing ? '🔉' : '🔊'}
    </button>
  );
}
