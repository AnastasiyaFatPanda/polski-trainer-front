/* Sanity checks for the pure logic: CSV import, answer grading, question building.
   Run with: npm run selftest */
import { readFileSync } from 'node:fs';
import type { Vocabulary } from '../src/types';
import { applyImport, parseCsv, previewImport, toCsv } from '../src/lib/csv';
import { acceptedForms, countWords, grade } from '../src/lib/text';
import { buildOptions, entriesForConfig, pickEntries } from '../src/lib/session';

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? '');
  }
}

const doc = JSON.parse(readFileSync(new URL('../data/vocabulary.json', import.meta.url), 'utf8')) as Vocabulary;

console.log('\nvocabulary file');
check('83 entries load', doc.entries.length > 0, doc.entries.length);
check('every entry has a unique id', new Set(doc.entries.map((e) => e.id)).size === doc.entries.length);
check('every entry has pl + ru', doc.entries.every((e) => e.pl && e.ru));
check('every set reference resolves', doc.entries.every((e) => e.sets.every((s) => doc.sets.some((d) => d.id === s))));
const longExamples = doc.entries.flatMap((e) => e.examples).filter((ex) => countWords(ex.pl) > 8);
check('no seeded sentence exceeds 8 słówek', longExamples.length === 0, longExamples.map((e) => e.pl));

console.log('\ncsv parsing');
const commaRows = parseCsv('pl,ru,sets\nkoza,коза,Zwierzęta\nżaba,лягушка,Zwierzęta');
check('comma + header', commaRows.length === 2 && commaRows[0].pl === 'koza' && commaRows[0].sets[0] === 'Zwierzęta');

const semiRows = parseCsv('polski;rosyjski;zestaw\nchleb;хлеб;Jedzenie');
check('semicolon + Polish headers', semiRows.length === 1 && semiRows[0].ru === 'хлеб');

const ruHeaders = parseCsv('слово,перевод\nmleko,молоко');
check('Russian headers', ruHeaders.length === 1 && ruHeaders[0].pl === 'mleko');

const headerless = parseCsv('ser,сыр\nmasło,масло');
check('headerless two-column file', headerless.length === 2 && headerless[1].ru === 'масло');

const quoted = parseCsv('pl,ru,example_pl,example_ru\n"dzień dobry","добрый день","Dzień dobry, panie Nowak.","Добрый день, пан Новак."');
check('quoted fields with commas', quoted[0].examples[0]?.ru === 'Добрый день, пан Новак.');
check('multi-word entry typed as phrase', quoted[0].type === 'phrase');

const multiSet = parseCsv('pl,ru,sets\nkurczak,курица,Jedzenie|Zwierzęta');
check('pipe-separated sets', multiSet[0].sets.length === 2);

const defaulted = parseCsv('pl,ru\nsól,соль', ['Kuchnia']);
check('default set applied', defaulted[0].sets[0] === 'Kuchnia');

const tabbed = parseCsv('pl\tru\nwoda\tвода');
check('tab-separated', tabbed.length === 1 && tabbed[0].pl === 'woda');

console.log('\ncsv merge');
const rows = parseCsv('pl,ru,sets,example_pl,example_ru\nkot,кошка,Domowe,Kot pije mleko.,Кот пьёт молоко.\njeż,ёж,Domowe,,');
const preview = previewImport(doc, rows);
check('existing "kot" detected as merge', preview.merged.length === 1 && preview.merged[0].pl === 'kot');
check('new "jeż" detected as add', preview.added.length === 1);
check('new set "Domowe" detected', preview.newSets.includes('Domowe'));

const merged = applyImport(doc, rows);
const kot = merged.entries.find((e) => e.id === 'kot')!;
check('kot keeps original translation', kot.ru.includes('кот'));
check('kot gains new translation variant', kot.ru.includes('кошка'));
check('kot gains the new set', kot.sets.includes(merged.sets.find((s) => s.name === 'Domowe')!.id));
check('kot keeps its original example', kot.examples.some((e) => e.pl.startsWith('Kot śpi')));
check('kot gains the imported example', kot.examples.some((e) => e.pl === 'Kot pije mleko.'));
check('jeż added as a new entry', merged.entries.some((e) => e.pl === 'jeż'));
check('no entries lost', merged.entries.length === doc.entries.length + 1);
check('re-import is idempotent', applyImport(merged, rows).entries.length === merged.entries.length);

const exported = toCsv(merged);
check('export round-trips through parse', parseCsv(exported).length === merged.entries.length);

console.log('\nanswer grading');
check('exact match', grade('kot', acceptedForms('kot')).verdict === 'correct');
check('case and spacing ignored', grade('  Kot ', acceptedForms('kot')).verdict === 'correct');
check('missing ogonek flagged, not failed', grade('zaba', acceptedForms('żaba')).verdict === 'diacritics');
check('missing kreska flagged', grade('slon', acceptedForms('słoń')).verdict === 'diacritics');
check('correct diacritics still correct', grade('żaba', acceptedForms('żaba')).verdict === 'correct');
check('wrong word rejected', grade('pies', acceptedForms('żaba')).verdict === 'wrong');
check('typo marked close, not correct', grade('niedzwiedc', acceptedForms('niedźwiedź')).verdict !== 'correct');
check('comma variant accepted', grade('кошка', acceptedForms('кот, кошка')).verdict === 'correct');
check('parenthetical stripped', grade('бухгалтер', acceptedForms('бухгалтер (женщина)')).verdict === 'correct');
check('punctuation ignored in sentences', grade('Kot śpi na łóżku', acceptedForms('Kot śpi na łóżku.')).verdict === 'correct');

console.log('\nquestion building');
const animals = entriesForConfig(doc, { training: 'pl-ru-choice', setIds: ['zwierzeta'], types: ['word', 'phrase'], length: 20 });
check('set filter isolates animals', animals.length > 0 && animals.every((e) => e.sets.includes('zwierzeta')));

const phrasesOnly = entriesForConfig(doc, { training: 'pl-ru-choice', setIds: [], types: ['phrase'], length: 20 });
check('type filter isolates phrases', phrasesOnly.length > 0 && phrasesOnly.every((e) => e.type === 'phrase'));

const everything = entriesForConfig(doc, { training: 'pl-ru-choice', setIds: [], types: ['word', 'phrase'], length: 20 });
check('no set selected means everything', everything.length === doc.entries.length);

let optionsOk = true;
let distractorsFromSameSet = 0;
for (const entry of doc.entries) {
  const options = buildOptions(entry, doc.entries, 'ru');
  if (options.length !== 5) optionsOk = false;
  if (!options.includes(entry.ru)) optionsOk = false;
  if (new Set(options).size !== 5) optionsOk = false;
  const sameSet = options.filter((o) => o !== entry.ru).every((o) => {
    const other = doc.entries.find((e) => e.ru === o);
    return other?.sets.some((s) => entry.sets.includes(s));
  });
  if (sameSet) distractorsFromSameSet += 1;
}
check('every question has 5 distinct options incl. the answer', optionsOk);
check('distractors come from the same set', distractorsFromSameSet === doc.entries.length, `${distractorsFromSameSet}/${doc.entries.length}`);

const picked = pickEntries(animals, 10, {});
check('session picks the requested count', picked.length === 10);
check('session has no duplicates', new Set(picked.map((e) => e.id)).size === picked.length);
check('session caps at pool size', pickEntries(animals, 999, {}).length === animals.length);

const seen = { [animals[0].id]: { correct: 9, wrong: 0, streak: 9, lastSeen: Date.now() } };
let strongPicked = 0;
for (let i = 0; i < 200; i += 1) if (pickEntries(animals, 3, seen).some((e) => e.id === animals[0].id)) strongPicked += 1;
check('mastered words come up less often', strongPicked < 200 * 0.25, `${strongPicked}/200`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
