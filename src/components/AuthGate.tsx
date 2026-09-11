import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { API_BASE_URL, AUTH_REQUIRED, getToken, setToken } from '../lib/auth';

interface Props {
  children: ReactNode;
}

/**
 * Gates the app behind a shared passphrase when talking to a remote API
 * (VITE_API_URL set at build time, see lib/auth.ts). Local dev against the
 * Vite middleware needs nothing — AUTH_REQUIRED is false and this renders
 * children straight through, exactly as before this existed.
 */
export default function AuthGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(() => !AUTH_REQUIRED || Boolean(getToken()));
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  if (unlocked) return <>{children}</>;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!passphrase || checking) return;
    setChecking(true);
    setError('');
    void fetch(`${API_BASE_URL}/api/status`, { headers: { Authorization: `Bearer ${passphrase}` } })
      .then((res) => {
        if (res.status === 401) {
          setError('Nieprawidłowe hasło.');
          return;
        }
        if (!res.ok) {
          setError(`Serwer odpowiedział błędem (${res.status}).`);
          return;
        }
        setToken(passphrase);
        setUnlocked(true);
      })
      .catch(() => setError('Nie udało się połączyć z serwerem. Spróbuj ponownie.'))
      .finally(() => setChecking(false));
  };

  return (
    <div className="app">
      <div className="card" style={{ maxWidth: 360, margin: '80px auto 0' }}>
        <h2>Polski Trainer</h2>
        <p className="sub muted">Podaj hasło, aby uzyskać dostęp.</p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Hasło</span>
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={checking}
            />
          </label>
          {error && <div className="notice error">{error}</div>}
          <button
            type="submit"
            className="btn primary"
            disabled={checking || !passphrase}
            style={{ width: '100%' }}
          >
            {checking ? 'Sprawdzanie…' : 'Wejdź'}
          </button>
        </form>
      </div>
    </div>
  );
}
