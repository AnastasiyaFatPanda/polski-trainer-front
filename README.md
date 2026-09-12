# Polski Trainer

Local Polish ↔ Russian vocabulary trainer. Runs entirely on your machine — the
vocabulary lives in a plain JSON file you can edit, diff and back up.

```bash
npm install
npm run dev          # http://localhost:5180
```

## The four trainings

| Training | Prompt | Answer |
|---|---|---|
| **Rozpoznawanie** | Polish word | pick 1 of 5 Russian meanings |
| **Produkcja** | Russian meaning | type the Polish word |
| **Słuchanie** | Polish audio | pick 1 of 5 Russian meanings |
| **Zdania** | Russian sentence | type the Polish translation (max 8 słówek) |

After every answer the app reads the correct Polish out loud.

Keyboard: `1`–`5` pick an option, `Enter` checks the answer and moves on.

Typed answers are graded Polish-aware — a missing `ą`/`ę`/`ł` is flagged as
"almost" rather than wrong, and sentence translations accept small typos plus a
*"moje też jest dobre"* override, since a free translation can be right without
matching the reference.

## Where the data lives

`data/vocabulary.json` is the single source of truth. The Vite dev server serves
it at `/api/vocabulary` and writes it back on every edit (previous version kept
as `data/vocabulary.backup.json`). Learning progress and the audio cache stay in
the browser; the vocabulary stays in the file. See **Progress** below for what
that means in practice.

```jsonc
{
  "id": "kot",
  "pl": "kot",
  "ru": "кот, кошка",          // comma-separated variants are all accepted
  "type": "word",               // "word" | "phrase"
  "sets": ["zwierzeta"],
  "examples": [{ "pl": "Kot śpi na moim łóżku.", "ru": "Кот спит на моей кровати." }]
}
```

## Progress

The **Postęp** card on the training screen — *już ćwiczonych / opanowanych / do
powtórki* — is real stored data, not a per-session count. It lives in
`data/progress.json`, one record per word keyed by its entry `id`:

```jsonc
{
  "kot":  { "correct": 7, "wrong": 1, "streak": 4, "lastSeen": 1757238910000 },
  "koza": { "correct": 1, "wrong": 3, "streak": 0, "lastSeen": 1757239001000 }
}
```

- `correct` / `wrong` — lifetime answer counts for that word
- `streak` — consecutive correct answers, reset to 0 by any miss
- `lastSeen` — epoch ms of the last answer

The three figures on screen are derived from those, across every training mode:

| Figure | Means |
|---|---|
| **już ćwiczonych** | `lastSeen` is set — the word has been answered at least once |
| **opanowanych** | `streak >= 3` — answered right three times running |
| **do powtórki** | `wrong > correct` — missed more often than not, lifetime |

The same records drive **which words come up**: unseen words start at the
highest weight, misses raise it, a streak lowers it, and a word answered in the
last few hours is damped so it doesn't repeat immediately. That's why a fresh
session doesn't just reshuffle — it leads with what you're weakest on.

**It survives a cleared browser.** The file is the source of truth;
`localStorage` is just a fast local copy. On startup the two are merged — for
each word the more recent result wins — so clearing site data, switching
browsers, or moving to another machine with the repo all recover your history
rather than starting from zero. Practising with the dev server down still works;
those answers are pushed into the file the next time you open the app.

Writes to the file are debounced by two seconds and flushed when a session ends
or the tab closes, so a 40-answer lesson is a handful of writes rather than
forty. The previous version is kept as `data/progress.backup.json` (gitignored).

Progress is deliberately kept out of `data/vocabulary.json` — otherwise every
answer would rewrite that whole file and bury real vocabulary changes in the
diff.

Progress is keyed by entry `id`, and ids never change once assigned, so editing a
word's spelling or meaning keeps its history. Deleting a word and re-adding it
does not.

**Ustawienia → Wyzeruj postęp** clears it deliberately.

### The Postęp tiles are clickable

Each figure opens the words behind it:

| Tile | Does |
|---|---|
| **pozycji w słowniku** | opens Słownik, unfiltered |
| **już ćwiczonych** | opens Słownik showing only those words |
| **opanowanych** | starts a universal lesson built from those words |
| **do powtórki** | starts a universal lesson built from your weakest words |

A tile with a count of 0 is disabled. The bucket a tile picks is also shown in
the **Postęp** dropdown on the training screen and in Słownik's toolbar, so it is
never invisible state — change or clear it there. It composes with the set
filter, so *Zwierzęta* + *Do powtórki* trains only the animals you keep missing.

## Sets

Create sets in **Słownik → Zestawy**, assign words by editing an entry, then pick
sets on the training screen — selecting *Zwierzęta* trains only animals, and
multiple-choice distractors are drawn from the same set so the options stay
plausible.

## CSV import

**Słownik → Import CSV.** Drag a file or paste text. Columns:

```csv
pl,ru,type,sets,example_pl,example_ru
koza,коза,word,Zwierzęta,Koza je trawę przy domu.,Коза ест траву возле дома.
```

Only `pl` and `ru` are required. Polish and Russian header names are recognised
too (`polski`/`слово`, `rosyjski`/`перевод`, `zestaw`/`категория`, …), the
delimiter (`,` `;` tab) is auto-detected, and a file with no header row is read
as `pl,ru,sets,example_pl,example_ru`. Multiple sets per row: `Zwierzęta|Ferma`.

Existing words are **enriched, not overwritten** — new sets, new example
sentences and new translation variants are merged into the entry you already
have. The preview shows exactly what will change before you commit.

## Audio

Two engines, switchable in **Ustawienia**:

- **Piper** (default) — a neural TTS model trained on Polish speech
  (`pl_PL-gosia-medium`), compiled to WASM and run in the browser. Handles ą, ę,
  rz, sz and stress correctly. The ~60 MB model downloads once into the origin
  private file system, then works offline. Press *Pobierz model głosu* to fetch it.
- **Głos systemowy** — macOS `speechSynthesis`. No download, noticeably more
  robotic. Needs a Polish voice installed: *System Settings → Accessibility →
  Spoken Content → System Voice → Manage Voices* (Polish: Zosia).

Synthesised clips are cached in IndexedDB, so each word is generated once.
If Piper fails to load for any reason the app silently falls back to the system
voice — audio never blocks a training session.

## Generated sentences (optional)

The **Zdania** training uses example sentences from `vocabulary.json` first. When
a word has none, the dev server asks Claude for one and **writes it back into the
file**, so it is on disk from then on and never generated twice.

```bash
cp .env.example .env
# ANTHROPIC_API_KEY=sk-ant-...
```

The key is read by the Vite server process only — it is never bundled into the
browser. Without a key the training still works on every word that has sentences
in the file (all seeded ones do).

## Running it everywhere (production deployment)

Local `npm run dev` still works exactly as documented above — nothing here
changes it. For using the app away from this machine (e.g. on an iPhone), the
same frontend can instead talk to a real backend + database:

- **[polski-trainer-api](https://github.com/AnastasiyaFatPanda/polski-trainer-api)**
  — Express + MongoDB, same `/api/*` contract as `server/vocabApi.ts`, deployed
  on Render.
- **[polski-trainer-db](https://github.com/AnastasiyaFatPanda/polski-trainer-db)**
  — schema docs + the one-time migration script that seeds Atlas from
  `data/vocabulary.json` / `data/progress.json`, plus a backup script (Atlas's
  free tier has no automatic backups).

Build the frontend against that API instead of the dev middleware:

```bash
VITE_API_URL=https://your-render-service.onrender.com npm run build
```

Setting `VITE_API_URL` does two things: `src/lib/api.ts` calls that origin
instead of same-origin `/api/*`, and `AuthGate` (src/components/AuthGate.tsx)
requires the shared passphrase (`APP_PASSPHRASE` on the API) before rendering
the app. With `VITE_API_URL` unset, both are inert — local dev is unaffected.

Deploy `dist/` to Vercel (or Netlify) for free static HTTPS hosting — HTTPS is
required for the install prompt. Once it's up:

- **Desktop Chrome** shows an install icon in the address bar → installs as a
  windowed app using `public/manifest.webmanifest` + the `Pł` icon.
- **iPhone Safari** → Share → *Add to Home Screen* does the same.

`public/sw.js` is a small hand-written service worker (no build plugin) that
caches the app shell for offline load; it never caches `/api/*`, so vocabulary
and progress are always fetched fresh.

## Structure

```
data/vocabulary.json      source of truth
server/vocabApi.ts        dev-server routes: read/write the file, generate sentences
src/lib/tts.ts            Piper + system voice, cache, fallback chain
src/lib/csv.ts            CSV parse / preview / merge / export
src/lib/session.ts        weighted question picking, distractor choice
src/lib/text.ts           Polish-aware answer grading
src/components/           UI
```
