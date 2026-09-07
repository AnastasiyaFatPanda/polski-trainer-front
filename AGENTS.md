# AGENTS.md

Local Polish↔Russian vocabulary trainer. Vite + React 18 + TypeScript, no backend —
a Vite middleware reads and writes `data/vocabulary.json` on disk. Single user
(Russian native speaker in Warsaw, working toward a Polish B1 exam), runs locally.

`README.md` covers running and using it. `Import csv konwencje.md` covers authoring
import files. **This file covers changing the code.** Don't duplicate those here.

## Commands

```bash
npm run dev         # localhost:5180
npm run selftest    # 125 assertions over the pure logic — no browser, ~1s
npm run typecheck   # tsc strict
npm run build
```

**Run `npm run selftest` after touching anything in `src/lib/`.** It covers CSV
parsing and merge, answer grading, distractor selection, question weighting, the
`addedAt` sort, set create/rename/delete, the progress thresholds and the
universal training's stage machine, and it validates `data/vocabulary.json`
itself (unique ids, resolvable set refs, the 8-słówek limit). It is fast and it
catches real regressions — use it.

There is no browser test in the repo. If you change training flow or the
vocabulary table, drive it manually before claiming it works.

## The data file is the source of truth

`data/vocabulary.json` is not a cache or a seed — it is the user's actual
vocabulary, accumulated over time, with hand-authored and reviewed sentences.

- Never regenerate, reformat or reorder it wholesale.
- Never write it directly from a script. Writes go through `PUT /api/vocabulary`,
  which backs up the previous version and writes atomically via a temp file.
- Learning progress lives in `localStorage`, keyed by entry `id`. **Changing an
  entry's `id` silently orphans its progress.** Ids are slugs of `pl`, assigned
  once at creation and never recomputed on edit.

## Browser-stored state

Four keys, none of which are in the repo or in `data/vocabulary.json`. All of it
is per-browser and disposable — treat the file as the only durable store.

| Where | Key | Holds |
|---|---|---|
| `localStorage` | `polski-trainer:progress:v1` | learning progress, `{ [entryId]: { correct, wrong, streak, lastSeen } }` |
| `localStorage` | `polski-trainer:tts:v1` | engine, Piper voice, speech rate |
| `localStorage` | `polski-trainer:config:v1` | last training, sets, types, length |
| `IndexedDB` | `polski-trainer-audio` | synthesised clips, keyed `voiceId:text` |

Progress is written by `handleRecord` in `App` on every answer, from every
training mode including each stage of the universal lesson. `src/lib/progress.ts`
owns the shape and the derived figures:

- `mastery(p)` = `streak / 3`, clamped 0–1. The Postęp card's **opanowanych** is
  `mastery >= 1`, i.e. three correct in a row; the słownik's per-row bar is the
  same value.
- **do powtórki** is `wrong > correct` (lifetime), computed in `Home`.
- **już ćwiczonych** is `lastSeen` being set.
- `weight(p)` decides how often a word is asked: unseen scores 6, each miss adds
  2, each streak step subtracts 1.5, and anything answered within 3 hours is
  damped to 0.3× so it does not repeat immediately.

Changing any of those thresholds changes both the statistics and the question
mix — they are the same numbers. Keep the derivations in `progress.ts` rather
than recomputing them in components.

Orphan records are never cleaned up: deleting a word leaves its progress row
behind under the old id forever. Harmless (it is a few bytes and nothing reads
it), but do not treat the key count as a word count.

## Invariants

Things that look like they could be simplified, and cannot:

1. **`speakPolish()` must never throw or reject.** The chain is Piper WASM →
   system `speechSynthesis` → silence, with every failure caught. Audio is not
   allowed to block a training session. Piper's model download can and does fail
   (offline, blocked network, first run) — that path is exercised, not theoretical.

2. **Pagination in `VocabularyView` (default 50 rows).** Filtering 3,000 entries
   costs ~1 ms; painting 3,000 rows costs ~1.3 s and made every keystroke in the
   search box lag ~2 s. Paginating brought it to 160 ms / 95 ms and cut the JS heap
   from 93 MB to 25 MB. Measured, not guessed. If you replace it, replace it with
   virtualisation — don't just render everything.

3. **`addedAt` is write-once.** Stamped when an entry is created (manual add or
   CSV import), preserved verbatim on edit. Entries predating the field have none;
   `addedRank()` in `src/lib/vocabSort.ts` falls back to their position in the file,
   which is insertion order because both creation paths append. Never backfill
   invented timestamps and never re-stamp on edit — sorting silently degrades to
   "recently touched" instead of "recently added".

4. **Imports enrich, never overwrite.** `applyImport` appends set memberships,
   example sentences and translation variants to an existing entry. Re-importing
   the same file is a no-op. This is what makes it safe to build import files
   incrementally, and it is the property most easily broken by a "cleanup" refactor.

5. **The API key never reaches the browser.** `ANTHROPIC_API_KEY` is read by the
   Vite server process in `server/vocabApi.ts`. Do not move sentence generation
   client-side, do not expose it through `import.meta.env`, do not log it.

6. **Polish diacritics are load-bearing.** `ą ć ę ł ń ó ś ź ż` must survive every
   transform. Answer grading deliberately distinguishes "correct" from "missing
   diacritics" — folding them away destroys the feature. `foldDiacritics()` exists
   only for comparison, never for storage.

7. **Generated sentences are capped at 8 słówek** and must contain the target word.
   A user requirement, not a style preference. Enforced in the prompt in
   `server/vocabApi.ts` and asserted in the selftest.

8. **Generated sentences are persisted back into the file** when created, so a
   sentence is never paid for twice. Keep that write.

9. **UI copy is Polish.** Code, comments and docs are English.

10. **The universal lesson's rules live in `src/lib/universal.ts`, not in the
    component.** `answerUniversal()` is a pure reducer: a missed word returns two
    places later in the same stage, is asked at most `MAX_ATTEMPTS` (3) times in
    that stage, and the stage ends regardless so an unlearnable word cannot stall
    the lesson. Attempts are counted per stage, so a word missed in `pl-ru`
    starts fresh in `ru-pl`. Change these rules there, with a test, not by
    editing `UniversalTraining`.

## Map

```
data/vocabulary.json      the vocabulary — source of truth
server/vocabApi.ts        GET/PUT /api/vocabulary, POST /api/sentence, GET /api/status
src/lib/tts.ts            Piper + system voice, IndexedDB clip cache, fallback chain
src/lib/csv.ts            parse / preview / merge / export
src/lib/session.ts        weighted picking, distractor selection
src/lib/vocabSort.ts      addedAt ranking and table sort modes
src/lib/sets.ts           set create / rename / delete / counts — pure, tested
src/lib/universal.ts      the universal lesson's stage machine — pure reducer
src/lib/slug.ts           the single slugifier for entry and set ids
src/lib/text.ts           Polish-aware grading (normalize, fold, edit distance)
src/lib/progress.ts       localStorage, mastery and weighting
src/components/Training.tsx   the four single-mode trainings
src/components/UniversalTraining.tsx  the four-stage lesson
src/components/SetsView.tsx   the Zestawy page — the only place sets are edited
scripts/selftest.ts       the test suite
```

## Gotchas

- `tsconfig.json` is strict with `verbatimModuleSyntax` and `noUnusedLocals`.
  Type-only imports need `import type`; an unused parameter fails the build.
- `optimizeDeps.exclude` holds `@mintplex-labs/piper-tts-web` — it ships prebuilt
  WASM that Vite's pre-bundler mangles. Leave it excluded.
- Writes in `server/vocabApi.ts` are serialised through a promise chain. Keep new
  write paths inside `queueWrite`.
- A word can belong to several sets, and most currently do (source set +
  thematic sets). Set filtering is OR — never assume one set per entry.
- Sets are created, renamed and deleted **only** on the Zestawy page
  (`SetsView`). Słownik filters by set through a dropdown but never mutates one.
  Set mutations live in `src/lib/sets.ts` as pure functions — keep them there so
  they stay testable, and keep returning `null` for rejected names rather than
  throwing.
- `UniversalTraining` and `Training` are separate components on purpose: the
  stage machine and the flat question queue are different flows, and merging them
  would put four working modes at risk. They share the libs (`session`, `text`,
  `tts`), not the JSX — some markup is duplicated, deliberately.
- `App` owns the Słownik set filter so the Zestawy page can deep-link into a
  filtered list ("Pokaż słowa"). Deleting the selected set clears it.
- Set ids never change on rename — entries and saved training filters point at
  them. Only the display name is editable.

## Open convention question

`Import csv konwencje.md` states set names follow `Polski / Русский`. The data
mostly doesn't: 11 of 12 sets are Polish-only (`Zwierzęta`, `Ciało i sylwetka`),
and only `Moda / Мода` carries the Russian half. Pick one and make the doc and the
data agree before the next import adds more drift.
