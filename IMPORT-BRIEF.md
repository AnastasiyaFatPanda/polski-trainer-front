# Polski Trainer — brief for preparing CSV import files

Handoff note for a fresh chat. Everything needed to produce import files for an
existing local app; no other context from the previous conversation is required.

---

## 1. What the app is

A local Polish↔Russian vocabulary trainer at `~/Documents/polski-trainer`
(Vite + React + TypeScript, run with `npm run dev` on port 5180). The user is a
Russian native speaker living in Warsaw, learning Polish, aiming at a **B1 exam**.

The vocabulary lives in a plain file, `data/vocabulary.json`, which the app reads
and writes directly. New words get in through **Słownik → Import CSV**.

Four training modes consume the data, which is what shapes the requirements below:

| Training | Prompt | Answer | Needs |
|---|---|---|---|
| Rozpoznawanie | Polish word | pick 1 of 5 Russian meanings | `pl`, `ru` |
| Produkcja | Russian meaning | type the Polish word | `pl`, `ru` |
| Słuchanie | Polish audio | pick 1 of 5 Russian meanings | `pl`, `ru` |
| Zdania | Russian sentence | type the Polish translation | `example_pl`, `example_ru` |

---

## 2. The CSV contract

```csv
pl,ru,type,sets,example_pl,example_ru
koza,коза,word,Zwierzęta,Koza je trawę przy domu.,Коза ест траву возле дома.
```

**Only `pl` and `ru` are required.** Everything else is optional.

| Column | Meaning | Notes |
|---|---|---|
| `pl` | the Polish word or phrase | dedupe key — see §3 |
| `ru` | Russian meaning | multiple variants separated by commas: `кот, кошка` — all are accepted as correct answers when typing |
| `type` | `word` or `phrase` | optional; auto-detected from whether `pl` contains a space. Also accepts `słowo`/`слово`, `fraza`/`фраза` |
| `sets` | group name(s) | multiple separated by `\|` — `Jedzenie\|Zakupy`. Named by display name, not id; unknown names create new sets |
| `example_pl` | example sentence in Polish | **max 8 słówek** — see §4 |
| `example_ru` | that sentence in Russian | must be supplied together with `example_pl`; a row with only one of the pair drops both |

**Parser tolerances** — the file does not have to be pretty:

- Delimiter `,` `;` or tab, auto-detected from the first line.
- Header names recognised in three languages: `pl`/`polski`/`polish`/`słowo`,
  `ru`/`rosyjski`/`russian`/`перевод`/`слово`→`pl`, `sets`/`zestaw`/`kategoria`/`tags`/`категория`,
  `type`/`typ`/`тип`, `example_pl`/`przykład_pl`/`sentence_pl`, `example_ru`/`przykład_ru`, `note`/`uwagi`/`заметка`.
- No header row at all → columns are read positionally as `pl, ru, sets, example_pl, example_ru`.
- Standard CSV quoting: `"Dzień dobry, panie Nowak."` — quote any field containing a comma, semicolon or newline; escape an internal quote by doubling it.
- UTF-8, BOM tolerated. Blank rows skipped. Rows missing `pl` or `ru` skipped and reported.

There is a **preview step** before anything is written: counts of new / enriched /
new sets / skipped, plus the first 40 rows. Nothing lands on disk until confirmed.

---

## 3. Merge semantics — imports enrich, never overwrite

The dedupe key is `pl` normalised (lowercased, punctuation stripped, whitespace
collapsed — diacritics preserved, so `żaba` ≠ `zaba`).

When a `pl` already exists, the import **adds to** the existing entry:

- new set memberships appended
- new example sentences appended (deduped on the Polish sentence)
- a new Russian translation appended to the existing comma list
- learning progress preserved

Nothing is ever replaced or deleted. Re-importing the same file is a no-op, so
files can be built incrementally and re-run safely.

---

## 4. Constraints that matter when authoring the data

1. **Sentences: max 8 słówek.** A hard requirement from the user, enforced in the
   generator prompt and worth honouring in hand-authored files. Fewer is better.
   The sentence must contain the target word, inflected naturally for the context —
   an inflected form is correct and expected (`Koza je trawę` for the entry `trawa`).
2. **Diacritics are graded.** Typed answers compare with ogonki and kreski intact
   (a missing one is flagged "prawie" rather than wrong). Source data must have
   correct `ą ć ę ł ń ó ś ź ż` — never ASCII-folded.
3. **Russian must be natural**, not a gloss. It is the prompt side in two of the
   four trainings, so a stilted translation makes the exercise ambiguous.
4. **Set size ≈ 15–25 entries.** Multiple choice draws its four distractors from
   the same set first, so a set of 5 gives repetitive options and a set of 200
   gives semantically distant ones.
5. **Aim at B1.** Concrete, everyday, high-frequency vocabulary; sentences of the
   kind a person actually says.
6. **Sentences are optional but valuable.** A word without one falls back to an
   API call at training time (needs `ANTHROPIC_API_KEY` in `.env`) or is skipped
   in the Zdania training. Supplying them in the CSV avoids both.

---

## 5. What is already in the vocabulary — avoid duplicating

83 entries across 4 sets:

- **Zwierzęta / Животные** (20): pies, kot, koń, krowa, świnia, kura, kaczka, owca, niedźwiedź, wilk, lis, zając, ryba, ptak, mysz, koza, małpa, słoń, żaba, motyl
- **Zawody / Профессии** (18): lekarz, nauczyciel, kierowca, kucharz, sprzedawca, programista, prawnik, inżynier, pielęgniarka, fryzjer, policjant, księgowa, dziennikarz, architekt, listonosz, tłumacz, kelner, mechanik
- **Kraje / Страны** (20): Polska, Niemcy, Ukraina, Czechy, Francja, Włochy, Hiszpania, Wielka Brytania, Stany Zjednoczone, Rosja, Białoruś, Litwa, Szwecja, Norwegia, Grecja, Turcja, Chiny, Japonia, Węgry, Austria
- **Zwroty / Фразы** (25): dzień dobry, do widzenia, na razie, dziękuję bardzo, proszę bardzo, przepraszam, nie ma za co, jak się masz?, co słychać?, miło mi, nie rozumiem, czy możesz powtórzyć?, mówię trochę po polsku, ile to kosztuje?, gdzie jest toaleta?, poproszę rachunek, smacznego, na zdrowie, do zobaczenia, nie ma sprawy, oczywiście, niestety, moim zdaniem, w porządku, zaraz wracam

Every one of these has one example sentence. Set names follow a
`Polski / Русский` convention — new sets should match it.

Duplicates are harmless (they merge), but a file of genuinely new material is
more useful than one that re-covers this ground.

---

## 6. Possible source material on the user's machine

In `~/Documents`:

- `B1+ Vocabulary Bank 2024.xlsx` — likely the highest-value source, aimed at the
  right level. Structure unexamined.
- `Polish Docs/` — folder, contents unexamined.
- `Polski - Nie umiesz czegoś robić.docx` / `.pdf`

The user also builds thematic PL–RU lists from YouTube (e.g. the influencer
"Knopka") and has an existing Telegram-bot → Google Sheets pipeline that
extracts Polish vocabulary into colour-coded rows. Those sheets are a natural
export-to-CSV source.

---

## 7. Suggested next-chat task

Take one source, produce a CSV matching §2, respecting §4, avoiding §5. Deliver
the `.csv` file; the user imports it through the UI, which previews before writing.

If a source turns out to be PL-only or RU-only, the missing side has to be
translated — flag that as a decision rather than guessing at scale, since the
translation quality is what the whole app is graded on.
