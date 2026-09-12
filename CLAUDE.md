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
npm run selftest    # 43 assertions over the pure logic — no browser, ~1s
npm run typecheck   # tsc strict
npm run build
```

**Run `npm run selftest` after touching anything in `src/lib/`.** It covers CSV
parsing and merge, answer grading, distractor selection and question weighting,
and it validates `data/vocabulary.json` itself (unique ids, resolvable set refs,
the 8-słówek limit). It is fast and it catches real regressions — use it.

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

## Invariants

Things that look like they could be simplified, and cannot:

1. **`speakPolish()` must never throw or reject.** The chain is Piper WASM →
   system `speechSynthesis` → silence, with every failure caught. Audio is not
   allowed to block a training session. Piper's model download can and does fail
   (offline, blocked network, first run) — that path is exercised, not theoretical.

2. **The 200-row cap in `VocabularyView`.** Filtering 3,000 entries costs ~1 ms;
   painting 3,000 rows costs ~1.3 s and made every keystroke in the search box lag
   ~2 s. Capping brought it to 160 ms / 95 ms and cut the JS heap from 93 MB to
   25 MB. Measured, not guessed. If you replace it, replace it with virtualisation —
   don't just remove it.

3. **Imports enrich, never overwrite.** `applyImport` appends set memberships,
   example sentences and translation variants to an existing entry. Re-importing
   the same file is a no-op. This is what makes it safe to build import files
   incrementally, and it is the property most easily broken by a "cleanup" refactor.

4. **The API key never reaches the browser.** `ANTHROPIC_API_KEY` is read by the
   Vite server process in `server/vocabApi.ts`. Do not move sentence generation
   client-side, do not expose it through `import.meta.env`, do not log it.

5. **Polish diacritics are load-bearing.** `ą ć ę ł ń ó ś ź ż` must survive every
   transform. Answer grading deliberately distinguishes "correct" from "missing
   diacritics" — folding them away destroys the feature. `foldDiacritics()` exists
   only for comparison, never for storage.

6. **Generated sentences are capped at 8 słówek** and must contain the target word.
   A user requirement, not a style preference. Enforced in the prompt in
   `server/vocabApi.ts` and asserted in the selftest.

7. **Generated sentences are persisted back into the file** when created, so a
   sentence is never paid for twice. Keep that write.

8. **UI copy is Polish.** Code, comments and docs are English.

## Map

```
data/vocabulary.json      the vocabulary — source of truth
server/vocabApi.ts        GET/PUT /api/vocabulary, POST /api/sentence, GET /api/status
src/lib/tts.ts            Piper + system voice, IndexedDB clip cache, fallback chain
src/lib/csv.ts            parse / preview / merge / export
src/lib/session.ts        weighted picking, distractor selection
src/lib/text.ts           Polish-aware grading (normalize, fold, edit distance)
src/lib/progress.ts       localStorage, mastery and weighting
src/components/Training.tsx   all four training modes
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

## Open convention question

`Import csv konwencje.md` states set names follow `Polski / Русский`. The data
mostly doesn't: 11 of 12 sets are Polish-only (`Zwierzęta`, `Ciało i sylwetka`),
and only `Moda / Мода` carries the Russian half. Pick one and make the doc and the
data agree before the next import adds more drift.
