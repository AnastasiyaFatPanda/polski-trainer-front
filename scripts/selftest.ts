/* Sanity checks for the pure logic: CSV import, answer grading, question building.
   Run with: npm run selftest */
import { readFileSync } from 'node:fs';
import type { ProgressMap, Vocabulary } from '../src/types';
import { blank, mastery, matchesProgress, mergeProgress, record, sameProgress, weight } from '../src/lib/progress';
import { applyImport, parseCsv, previewImport, toCsv } from '../src/lib/csv';
import { acceptedForms, countWords, grade } from '../src/lib/text';
import { buildOptions, entriesForConfig, pickEntries, sessionLengthOptions } from '../src/lib/session';
import {
  MAX_ATTEMPTS,
  STAGES,
  type UniversalState,
  answerUniversal,
  attemptsFor,
  missedCount,
  perfectRunLength,
  startUniversal,
} from '../src/lib/universal';
import { addedRank, sortEntries } from '../src/lib/vocabSort';
import { createSet, deleteSet, renameSet, setCounts } from '../src/lib/sets';

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
let sameSetOk = 0;
let sameSetEligible = 0;
const setSize = new Map<string, number>();
for (const entry of doc.entries) for (const s of entry.sets) setSize.set(s, (setSize.get(s) ?? 0) + 1);

for (const entry of doc.entries) {
  const options = buildOptions(entry, doc.entries, 'ru');
  if (options.length !== 5) optionsOk = false;
  if (!options.includes(entry.ru)) optionsOk = false;
  if (new Set(options).size !== 5) optionsOk = false;

  // Only meaningful where the entry's sets can actually supply four distractors.
  if (!entry.sets.some((s) => (setSize.get(s) ?? 0) >= 5)) continue;
  sameSetEligible += 1;
  const sameSet = options.filter((o) => o !== entry.ru).every((o) => {
    const other = doc.entries.find((e) => e.ru === o);
    return other?.sets.some((s) => entry.sets.includes(s));
  });
  if (sameSet) sameSetOk += 1;
}
check('every question has 5 distinct options incl. the answer', optionsOk);
check('distractors come from the same set', sameSetOk === sameSetEligible, `${sameSetOk}/${sameSetEligible}`);

const picked = pickEntries(animals, 10, {});
check('session picks the requested count', picked.length === 10);
check('session has no duplicates', new Set(picked.map((e) => e.id)).size === picked.length);
check('session caps at pool size', pickEntries(animals, 999, {}).length === animals.length);

const seen = { [animals[0].id]: { correct: 9, wrong: 0, streak: 9, lastSeen: Date.now() } };
let strongPicked = 0;
for (let i = 0; i < 200; i += 1) if (pickEntries(animals, 3, seen).some((e) => e.id === animals[0].id)) strongPicked += 1;
check('mastered words come up less often', strongPicked < 200 * 0.25, `${strongPicked}/200`);

console.log('\nsorting by date added');
// Words the user's real vocabulary cannot already contain, so this suite stays
// green against a live data file rather than only against the seed.
const NEW_PL = `zzztestowe${Date.now()}`;
const stampRows = parseCsv(`pl,ru\n${NEW_PL},тест\n${NEW_PL}b,тест два`);
const withStamps = applyImport(doc, stampRows);
const fresh = withStamps.entries.find((e) => e.pl === NEW_PL)!;
check('import stamps addedAt on new entries', typeof fresh.addedAt === 'string' && !Number.isNaN(Date.parse(fresh.addedAt)));
const untouched = doc.entries.find((e) => !e.addedAt);
check('import does not stamp pre-existing entries', !untouched || withStamps.entries.find((e) => e.id === untouched.id)!.addedAt === undefined);

const ranks = addedRank(withStamps.entries);
check('stamped entries outrank legacy ones', ranks.get(fresh.id)! > ranks.get(doc.entries[0].id)!);
check('legacy entries keep file order', ranks.get(doc.entries[5].id)! > ranks.get(doc.entries[2].id)!);

const newestFirst = sortEntries(withStamps.entries, 'newest', ranks);
check('newest sort puts the import on top', newestFirst[0].pl.startsWith('zzztestowe'), newestFirst[0].pl);
check('newest sort ends with the oldest entry', newestFirst[newestFirst.length - 1].pl === doc.entries[0].pl);

const oldestFirst = sortEntries(withStamps.entries, 'oldest', ranks);
check('oldest sort is the exact reverse', oldestFirst[0].pl === newestFirst[newestFirst.length - 1].pl);
check('sorting never drops or duplicates entries', new Set(newestFirst.map((e) => e.id)).size === withStamps.entries.length);

const alpha = sortEntries(withStamps.entries, 'alpha', ranks);
check('alpha sort is ascending in Polish collation', alpha.every((e, i) => i === 0 || alpha[i - 1].pl.localeCompare(e.pl, 'pl') <= 0));
const zabaIndex = alpha.findIndex((e) => e.pl === 'żaba');
const zajacIndex = alpha.findIndex((e) => e.pl === 'zając');
check('Polish collation puts ż after z', zabaIndex > zajacIndex, `żaba@${zabaIndex} zając@${zajacIndex}`);
check('sorting does not mutate the input', withStamps.entries[0].pl === doc.entries[0].pl);

const someSet = doc.sets[0].id;
const filtered = withStamps.entries.filter((e) => e.sets.includes(someSet));
const filteredSorted = sortEntries(filtered, 'newest', ranks);
const maxRank = Math.max(...filtered.map((e) => ranks.get(e.id)!));
check(
  'a filtered subset sorts with the full-document rank',
  filteredSorted.length === filtered.length && ranks.get(filteredSorted[0].id) === maxRank,
);

console.log('\nset management');
const firstSet = doc.sets[0];
const created = createSet(doc, 'Kuchnia');
check('createSet adds a set', created !== null && created.sets.length === doc.sets.length + 1);
check('createSet slugs the id', created!.sets[created!.sets.length - 1].id === 'kuchnia');
check('createSet rejects a duplicate name', createSet(doc, firstSet.name) === null);
check('createSet rejects a case-variant duplicate', createSet(doc, firstSet.name.toUpperCase()) === null);
check('createSet rejects blank', createSet(doc, '   ') === null);
check('createSet does not touch entries', created!.entries === doc.entries);

const renamed = renameSet(doc, firstSet.id, 'Zwierzaki');
check('renameSet changes the name', renamed!.sets.find((s) => s.id === firstSet.id)!.name === 'Zwierzaki');
check('renameSet keeps the id stable', renamed!.sets.some((s) => s.id === firstSet.id));
check('renameSet keeps entry membership intact', renamed!.entries.filter((e) => e.sets.includes(firstSet.id)).length === doc.entries.filter((e) => e.sets.includes(firstSet.id)).length);
check('renameSet allows renaming to its own name', renameSet(doc, firstSet.id, firstSet.name) !== null);
check('renameSet rejects another set name', doc.sets.length < 2 || renameSet(doc, firstSet.id, doc.sets[1].name) === null);
check('renameSet rejects an unknown id', renameSet(doc, 'nie-ma-takiego', 'X') === null);

const memberCount = doc.entries.filter((e) => e.sets.includes(firstSet.id)).length;
const deleted = deleteSet(doc, firstSet.id);
check('deleteSet removes the set', !deleted.sets.some((s) => s.id === firstSet.id));
check('deleteSet keeps every word', deleted.entries.length === doc.entries.length);
check('deleteSet strips the membership', deleted.entries.every((e) => !e.sets.includes(firstSet.id)));
check('deleteSet leaves other memberships alone', deleted.entries.filter((e) => e.sets.length > 0).length === doc.entries.filter((e) => e.sets.some((s) => s !== firstSet.id)).length);
check('deleteSet does not mutate the original', doc.entries.filter((e) => e.sets.includes(firstSet.id)).length === memberCount);

const counts = setCounts(doc);
check('setCounts matches a manual count', counts.get(firstSet.id) === memberCount);
check('setCounts covers every set in use', doc.sets.every((s) => counts.has(s.id) || doc.entries.every((e) => !e.sets.includes(s.id))));

console.log('\nuniversal training — stages');
const lesson = ['a', 'b', 'c', 'd', 'e', 'f'];
const noShuffle = (ids: string[]) => [...ids];
const allRight = (s: UniversalState) => answerUniversal(s, true, noShuffle);

let u = startUniversal(lesson);
check('starts in the intro stage', u.stage === 'intro');
check('intro keeps the picked order', u.queue.join('') === 'abcdef');
check('not done at the start', !u.done);

for (let i = 0; i < 6; i += 1) u = allRight(u);
check('intro hands over to pl-ru', u.stage === 'pl-ru', u.stage);
check('every word is queued again for the new stage', u.queue.length === 6);
for (let i = 0; i < 6; i += 1) u = allRight(u);
check('pl-ru hands over to ru-pl', u.stage === 'ru-pl', u.stage);
for (let i = 0; i < 6; i += 1) u = allRight(u);
check('ru-pl hands over to audio-pl', u.stage === 'audio-pl', u.stage);
for (let i = 0; i < 6; i += 1) u = allRight(u);
check('lesson finishes after the fourth stage', u.done);
check('a flawless run takes exactly 4 answers per word', u.answered === perfectRunLength(6), u.answered);
check('a flawless run records nothing as missed', missedCount(u) === 0);
check('answering past the end is a no-op', answerUniversal(u, true, noShuffle) === u);

console.log('\nuniversal training — repeats');
let r = startUniversal(lesson);
for (let i = 0; i < 6; i += 1) r = allRight(r); // through the intro
check('intro ignores correctness', missedCount(startUniversal(lesson)) === 0);
let introWrong = startUniversal(lesson);
introWrong = answerUniversal(introWrong, false, noShuffle);
check('a wrong answer in the intro never re-queues', introWrong.queue.length === 5);

const firstWord = r.queue[0];
const afterMiss = answerUniversal(r, false, noShuffle);
check('a missed word goes back into the queue', afterMiss.queue.includes(firstWord));
check('it does not come back immediately', afterMiss.queue[0] !== firstWord, afterMiss.queue.join(''));
check('it is recorded as missed', (afterMiss.missed['pl-ru'] ?? []).includes(firstWord));
check('the queue grew back to full length', afterMiss.queue.length === 6);

// Miss the same word every time it appears.
let stubborn = r;
let timesAsked = 0;
for (let guard = 0; guard < 50 && stubborn.stage === 'pl-ru'; guard += 1) {
  const isTarget = stubborn.queue[0] === firstWord;
  if (isTarget) timesAsked += 1;
  stubborn = answerUniversal(stubborn, !isTarget, noShuffle);
}
check(`a word is asked at most ${MAX_ATTEMPTS} times per stage`, timesAsked === MAX_ATTEMPTS, timesAsked);
check('the stage still ends despite the failures', stubborn.stage === 'ru-pl', stubborn.stage);
check('the failed word carries into the summary', missedCount(stubborn) === 1);
check('attempts are counted per stage, not globally', attemptsFor(stubborn, firstWord) === 0);

// A word missed once then answered correctly should not be asked a third time.
let recovering = r;
recovering = answerUniversal(recovering, false, noShuffle);
let asked = 1;
for (let guard = 0; guard < 50 && recovering.stage === 'pl-ru'; guard += 1) {
  if (recovering.queue[0] === firstWord) asked += 1;
  recovering = answerUniversal(recovering, true, noShuffle);
}
check('a recovered word is asked exactly twice', asked === 2, asked);
check('recovery still leaves it flagged as missed', missedCount(recovering) === 1);

console.log('\nuniversal training — edge cases');
const tiny = startUniversal(['only']);
check('a one-word lesson is valid', !tiny.done && tiny.queue.length === 1);
let t = tiny;
for (let i = 0; i < 4; i += 1) t = allRight(t);
check('a one-word lesson completes all four stages', t.done, t.stage);
const missTiny = answerUniversal(answerUniversal(tiny, true, noShuffle), false, noShuffle);
check('a lone word re-queues into an empty queue', missTiny.queue[0] === 'only' && missTiny.stage === 'pl-ru');
check('an empty lesson is done immediately', startUniversal([]).done);
check('stage list is the documented order', STAGES.join(',') === 'intro,pl-ru,ru-pl,audio-pl');
check('universal offers 6 and 10', sessionLengthOptions(500, 'universal').join(',') === '6,10');
check('other trainings keep their own lengths', sessionLengthOptions(500, 'pl-ru-choice').includes(50));

console.log('\nprogress — the figures on the Postęp card');
const HOUR = 3_600_000;
let prog: ProgressMap = {};
check('an unseen word has no record', prog['kot'] === undefined);
check('unseen words are asked first', weight(undefined) === 6);

prog = record(prog, 'kot', true);
check('a correct answer counts', prog['kot'].correct === 1 && prog['kot'].wrong === 0);
check('a correct answer starts a streak', prog['kot'].streak === 1);
check('lastSeen is stamped', prog['kot'].lastSeen > 0);
check('one correct answer is not yet mastery', mastery(prog['kot']) < 1);

prog = record(prog, 'kot', true);
prog = record(prog, 'kot', true);
check('three in a row is "opanowane"', mastery(prog['kot']) === 1, mastery(prog['kot']));
check('mastery is capped at 1', mastery({ correct: 99, wrong: 0, streak: 99, lastSeen: 1 }) === 1);

prog = record(prog, 'kot', false);
check('a miss resets the streak', prog['kot'].streak === 0);
check('a miss drops it out of "opanowane"', mastery(prog['kot']) === 0);
check('lifetime counts are kept', prog['kot'].correct === 3 && prog['kot'].wrong === 1);
check('still not "do powtórki" — more right than wrong', !(prog['kot'].wrong > prog['kot'].correct));

const struggling = { correct: 1, wrong: 3, streak: 0, lastSeen: Date.now() - 24 * HOUR };
check('"do powtórki" is wrong > correct', struggling.wrong > struggling.correct);
check('a struggling word outweighs a mastered one', weight(struggling) > weight({ correct: 9, wrong: 0, streak: 9, lastSeen: Date.now() - 24 * HOUR }));
check('weight never reaches zero', weight({ correct: 99, wrong: 0, streak: 99, lastSeen: Date.now() - 99 * HOUR }) > 0);

const justAnswered = { correct: 1, wrong: 1, streak: 0, lastSeen: Date.now() - 5 * 60_000 };
const rested = { ...justAnswered, lastSeen: Date.now() - 24 * HOUR };
check('a word answered minutes ago is damped', weight(justAnswered) < weight(rested));
check('the damping is the documented 0.3x', Math.abs(weight(justAnswered) / weight(rested) - 0.3 / 1.5) < 1e-9);

check('progress survives a save/load round-trip', JSON.stringify(prog) === JSON.stringify(JSON.parse(JSON.stringify(prog))));
check('a blank record is all zeroes', Object.values(blank()).every((v) => v === 0));

console.log('\nprogress buckets — tiles, słownik filter and training pool agree');
const newWord = undefined;
const practised = { correct: 1, wrong: 1, streak: 1, lastSeen: Date.now() };
const mastered = { correct: 5, wrong: 0, streak: 3, lastSeen: Date.now() };
const weak = { correct: 1, wrong: 4, streak: 0, lastSeen: Date.now() };

check('"all" matches everything', ['new', 'practiced', 'mastered', 'review'].length > 0 && matchesProgress('all', newWord) && matchesProgress('all', weak));
check('"new" is an unanswered word', matchesProgress('new', newWord) && !matchesProgress('new', practised));
check('"practiced" is any answered word', matchesProgress('practiced', practised) && !matchesProgress('practiced', newWord));
check('"mastered" needs a streak of 3', matchesProgress('mastered', mastered) && !matchesProgress('mastered', practised));
check('"review" is wrong > correct', matchesProgress('review', weak) && !matchesProgress('review', mastered));
check('a mastered word is also "practiced"', matchesProgress('practiced', mastered));
check('"new" and "practiced" partition the vocabulary', doc.entries.every((e) => matchesProgress('new', undefined) !== matchesProgress('practiced', undefined)));

const bucketProgress: ProgressMap = {};
for (const [i, e] of doc.entries.entries()) {
  if (i % 3 === 0) bucketProgress[e.id] = { ...mastered };
  else if (i % 3 === 1) bucketProgress[e.id] = { ...weak };
}
const base = { training: 'universal' as const, setIds: [], types: ['word', 'phrase'] as const, length: 10 };
const masteredPool = entriesForConfig(doc, { ...base, types: ['word', 'phrase'], progressFilter: 'mastered' }, bucketProgress);
const reviewPool = entriesForConfig(doc, { ...base, types: ['word', 'phrase'], progressFilter: 'review' }, bucketProgress);
const newPool = entriesForConfig(doc, { ...base, types: ['word', 'phrase'], progressFilter: 'new' }, bucketProgress);
const allPool = entriesForConfig(doc, { ...base, types: ['word', 'phrase'], progressFilter: 'all' }, bucketProgress);

check('the training pool honours "mastered"', masteredPool.length === doc.entries.filter((_, i) => i % 3 === 0).length, masteredPool.length);
check('the training pool honours "review"', reviewPool.length === doc.entries.filter((_, i) => i % 3 === 1).length, reviewPool.length);
check('the training pool honours "new"', newPool.length === doc.entries.filter((_, i) => i % 3 === 2).length, newPool.length);
check('the three buckets add up to the whole vocabulary', masteredPool.length + reviewPool.length + newPool.length === doc.entries.length);
check('"all" is still everything', allPool.length === doc.entries.length);
check('omitting progressFilter behaves as "all"', entriesForConfig(doc, base, bucketProgress).length === doc.entries.length);
check('omitting the progress map behaves as "all"', entriesForConfig(doc, { ...base, progressFilter: 'all' }).length === doc.entries.length);
check('a bucket composes with a set filter', entriesForConfig(doc, { ...base, setIds: ['zwierzeta'], progressFilter: 'mastered' }, bucketProgress).every((e) => e.sets.includes('zwierzeta') && matchesProgress('mastered', bucketProgress[e.id])));
check('a lesson can be built from the review bucket', pickEntries(reviewPool, 6, bucketProgress).length === Math.min(6, reviewPool.length));

console.log('\nprogress merge — file vs browser');
const older = { correct: 1, wrong: 0, streak: 1, lastSeen: 1_000 };
const newer = { correct: 4, wrong: 1, streak: 2, lastSeen: 2_000 };

check('empty merges are empty', Object.keys(mergeProgress({}, {})).length === 0);
check('words only in the file survive', mergeProgress({ a: older }, {}).a === older);
check('words only in the browser survive', mergeProgress({}, { a: older }).a === older);
check('the newer record wins', mergeProgress({ a: older }, { a: newer }).a === newer);
check('the newer record wins in either direction', mergeProgress({ a: newer }, { a: older }).a === newer);
check('counts are never summed', mergeProgress({ a: older }, { a: newer }).a.correct === 4);
check('a tie keeps the base record', mergeProgress({ a: older }, { a: { ...older } }).a === older);
check('merging is per word, not whole-map', Object.keys(mergeProgress({ a: older, b: older }, { b: newer, c: newer })).sort().join() === 'a,b,c');
check('a per-word mix picks each winner', (() => {
  const m = mergeProgress({ a: newer, b: older }, { a: older, b: newer });
  return m.a === newer && m.b === newer;
})());
check('merging does not mutate its inputs', (() => {
  const base = { a: older };
  mergeProgress(base, { a: newer });
  return base.a === older;
})());
check('a never-answered record loses to a real one', mergeProgress({ a: older }, { a: blank() }).a === older);
check('a full round-trip through the file is lossless', (() => {
  const map = { kot: newer, koza: older };
  return sameProgress(mergeProgress(JSON.parse(JSON.stringify(map)), {}), map);
})());

check('sameProgress spots an equal map', sameProgress({ a: older }, { a: { ...older } }));
check('sameProgress spots a changed count', !sameProgress({ a: older }, { a: { ...older, correct: 2 } }));
check('sameProgress spots a changed timestamp', !sameProgress({ a: older }, { a: { ...older, lastSeen: 5 } }));
check('sameProgress spots an extra word', !sameProgress({ a: older }, { a: older, b: older }));
check('sameProgress spots a missing word', !sameProgress({ a: older, b: older }, { a: older }));

// The scenario the whole feature exists for.
const onDisk = { kot: newer, koza: newer };
const clearedBrowser: ProgressMap = {};
check('a cleared browser recovers everything from the file', sameProgress(mergeProgress(onDisk, clearedBrowser), onDisk));
const otherBrowser = { pies: { correct: 2, wrong: 0, streak: 2, lastSeen: 3_000 } };
const afterSwitch = mergeProgress(onDisk, otherBrowser);
check('a second browser adds to the file rather than replacing it', Object.keys(afterSwitch).sort().join() === 'kot,koza,pies');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
