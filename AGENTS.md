# AGENTS.md

Local Polish↔Russian vocabulary trainer. Vite + React 18 + TypeScript, no backend —
a Vite middleware reads and writes `data/vocabulary.json` on disk. Single user
(Russian native speaker in Warsaw, working toward a Polish B1 exam), runs locally.

`README.md` covers running and using it. `Import csv konwencje.md` covers authoring
import files. **This file covers changing the code.** Don't duplicate those here.

## Git — manual only, never AI

AI assistants (Claude or any other coding agent) working in this repo must
**never** run `git commit`, `git push`, `git fetch`, or `git pull`, and must
never stage, commit, publish, or sync changes to the remote — not even if a
task explicitly asks for it. Publishing changes to git is done manually, by
Duchess, only. Read-only inspection (`git status`, `git diff`, `git log`) is
fine when it helps understand the current state.

## Commands

```bash
npm run dev         # localhost:5180
npm run selftest    # 160 assertions over the pure logic — no browser, ~1s
npm run typecheck   # tsc strict
npm run build
```

**Run `npm run selftest` after touching anything in `src/lib/`.** It covers CSV
parsing and merge, answer grading, distractor selection, question weighting, the
`addedAt` sort, set create/rename/delete, the progress thresholds and merge rule,
and the universal training's stage machine, and it validates `data/vocabulary.json`
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
- Learning progress is keyed by entry `id` (see the next section). **Changing an
  entry's `id` silently orphans its progress.** Ids are slugs of `pl`, assigned
  once at creation and never recomputed on edit.

## Where progress lives

`data/progress.json` is the source of truth; localStorage is a per-browser cache
of the same map. `src/lib/progressStore.ts` owns the reconciliation:

- **On load**, `loadMergedProgress()` fetches the file and merges it with the
  local copy — per word the record with the newer `lastSeen` wins **wholesale**.
  Never merge field-by-field: summing `correct` across two copies double-counts.
  A cleared cache or a new browser therefore recovers everything from the file,
  and a session done while the server was down is pushed up on the next load.
- **On every answer**, localStorage is written synchronously and the file write
  is debounced 2 s. A 40-answer lesson is a few writes, not forty.
- **Flushed** when a session ends, and on `visibilitychange`/`pagehide` with
  `keepalive: true` so a closed tab still lands its last answers.
- If the server is unreachable the app degrades to localStorage-only rather than
  failing — every path in that module swallows its error deliberately.

Progress is deliberately **not** inside `data/vocabulary.json`: it would rewrite
a 1.2 MB file per answer and bury real vocabulary changes in git diffs.

## Other browser-stored state

Per-browser and disposable — the files above are the durable store.

| Where | Key | Holds |
|---|---|---|
| `localStorage` | `polski-trainer:progress:v1` | cache of `data/progress.json` |
| `localStorage` | `polski-trainer:tts:v1` | engine, Piper voice, speech rate |
| `localStorage` | `polski-trainer:config:v1` | last training, sets, types, length |
| `IndexedDB` | `polski-trainer-audio` | synthesised clips, keyed `voiceId:text` |

Progress is written by `handleRecord` in `App` on every answer, from every
training mode including each stage of the universal lesson. `src/lib/progress.ts`
owns the shape and the derived figures:

- `matchesProgress(filter, p)` is the **single** definition of the buckets:
  `new` (no `lastSeen`), `practiced` (`lastSeen` set), `mastered`
  (`mastery >= 1`, i.e. `streak >= 3`), `review` (`wrong > correct`). The Postęp
  tiles, the słownik's Postęp dropdown and the training pool all call it — never
  re-derive a bucket inline, or the tile count and the lesson stop agreeing.
- `mastery(p)` = `streak / 3`, clamped 0–1; also the słownik's per-row bar.
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

11. **Progress merges, it never overwrites.** `mergeProgress()` takes the newer
    `lastSeen` record per word, whole. Replacing the file with whatever this
    browser happens to hold would silently discard a session done elsewhere;
    summing the counters would double-count. Both are easy mistakes to make in a
    "simplification".

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
data/progress.json        learning progress — source of truth, merged on load
server/vocabApi.ts        GET/PUT /api/vocabulary + /api/progress, POST /api/sentence
src/lib/tts.ts            Piper + system voice, IndexedDB clip cache, fallback chain
src/lib/csv.ts            parse / preview / merge / export
src/lib/session.ts        weighted picking, distractor selection
src/lib/vocabSort.ts      addedAt ranking and table sort modes
src/lib/sets.ts           set create / rename / delete / counts — pure, tested
src/lib/universal.ts      the universal lesson's stage machine — pure reducer
src/lib/slug.ts           the single slugifier for entry and set ids
src/lib/text.ts           Polish-aware grading (normalize, fold, edit distance)
src/lib/progress.ts       record shape, buckets, mastery, weighting, merge
src/lib/progressStore.ts  file <-> localStorage sync, debounce, flush
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
- `App` owns the Słownik set filter *and* progress filter so other screens can
  deep-link into a filtered list — the Zestawy page's "Pokaż słowa", and the
  Postęp tiles. Deleting the selected set clears the set filter.
- `entriesForConfig(doc, config, progress)` takes the progress map because
  `config.progressFilter` narrows the pool. **Every caller must pass it** — omit
  it and a bucket-filtered lesson silently comes back empty, which is exactly the
  bug the tile tests caught.
- A stat tile is a shortcut, not hidden state: the bucket it sets is also shown
  in the Postęp dropdown on the training screen, so the user can see and clear
  why their pool is small.
- Set ids never change on rename — entries and saved training filters point at
  them. Only the display name is editable.

## Open convention question

`Import csv konwencje.md` states set names follow `Polski / Русский`. The data
mostly doesn't: 11 of 12 sets are Polish-only (`Zwierzęta`, `Ciało i sylwetka`),
and only `Moda / Мода` carries the Russian half. Pick one and make the doc and the
data agree before the next import adds more drift.
