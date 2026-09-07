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
powtórki* — is real stored data, not a per-session count. It lives in your
browser's `localStorage` under the key `polski-trainer:progress:v1`, as one
record per word keyed by its entry `id`:

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

**This data is browser-local.** It is not in `data/vocabulary.json`, not in git,
and not backed up. A different browser or profile, cleared site data, or a
private window all start from zero. The vocabulary is safe in the file either
way — only the statistics are lost.

Progress is keyed by entry `id`, and ids never change once assigned, so editing a
word's spelling or meaning keeps its history. Deleting a word and re-adding it
does not.

**Ustawienia → Wyzeruj postęp** clears it deliberately.

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
