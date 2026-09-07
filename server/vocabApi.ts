import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VOCAB_FILE = path.join(DATA_DIR, 'vocabulary.json');
const BACKUP_FILE = path.join(DATA_DIR, 'vocabulary.backup.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const PROGRESS_BACKUP = path.join(DATA_DIR, 'progress.backup.json');

const DEFAULT_MODEL = 'claude-sonnet-5';

/** Serialises every write so two rapid saves can never interleave. */
let writeChain: Promise<unknown> = Promise.resolve();
function queueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

interface Example {
  pl: string;
  ru: string;
  source?: 'file' | 'generated';
}

interface VocabEntry {
  id: string;
  pl: string;
  ru: string;
  type: 'word' | 'phrase';
  sets: string[];
  note?: string;
  examples: Example[];
}

interface Vocabulary {
  version: number;
  sets: { id: string; name: string }[];
  entries: VocabEntry[];
}

async function readVocabulary(): Promise<Vocabulary> {
  const raw = await fs.readFile(VOCAB_FILE, 'utf8');
  return JSON.parse(raw) as Vocabulary;
}

async function writeVocabulary(doc: Vocabulary): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Keep one generation of backup — this file is the source of truth.
  try {
    await fs.copyFile(VOCAB_FILE, BACKUP_FILE);
  } catch {
    /* first write, nothing to back up */
  }
  const tmp = `${VOCAB_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, VOCAB_FILE);
}

/** Learning progress, keyed by entry id. Absent file = nothing learned yet. */
type ProgressFile = Record<
  string,
  { correct: number; wrong: number; streak: number; lastSeen: number }
>;

async function readProgress(): Promise<ProgressFile> {
  try {
    return JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf8')) as ProgressFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeProgress(map: ProgressFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.copyFile(PROGRESS_FILE, PROGRESS_BACKUP);
  } catch {
    /* first write */
  }
  const tmp = `${PROGRESS_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, PROGRESS_FILE);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const SENTENCE_SYSTEM = [
  'You write example sentences for a Polish learner whose native language is Russian.',
  'Rules for every sentence you produce:',
  '- It must be natural, idiomatic modern Polish.',
  '- MAXIMUM 8 words (słówek). Fewer is better. Count them.',
  '- It must contain the requested Polish word, inflected naturally for the context.',
  '- Keep it concrete and everyday — the kind of sentence a person actually says.',
  '- Provide an accurate, natural Russian translation.',
  'Answer with raw JSON only, no markdown fence, in the shape:',
  '{"pl":"...","ru":"..."}',
].join('\n');

async function generateSentence(
  entry: VocabEntry,
  avoid: string[],
): Promise<Example> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error(
        'No ANTHROPIC_API_KEY set. Add it to .env to enable generated sentences, or add examples to data/vocabulary.json.',
      ),
      { status: 501 },
    );
  }

  const avoidNote = avoid.length
    ? `\nDo not repeat any of these sentences:\n${avoid.map((s) => `- ${s}`).join('\n')}`
    : '';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 300,
      system: SENTENCE_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Polish ${entry.type}: "${entry.pl}"\n` +
            `Russian meaning: "${entry.ru}"\n` +
            `Write one example sentence (max 8 words) using it.${avoidNote}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(
      new Error(`Anthropic API ${response.status}: ${detail.slice(0, 400)}`),
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw Object.assign(new Error(`Unparseable model reply: ${text.slice(0, 200)}`), { status: 502 });

  const parsed = JSON.parse(match[0]) as { pl?: string; ru?: string };
  if (!parsed.pl || !parsed.ru) {
    throw Object.assign(new Error('Model reply missing pl/ru'), { status: 502 });
  }
  return { pl: parsed.pl.trim(), ru: parsed.ru.trim(), source: 'generated' };
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/')) return next();

  void (async () => {
    try {
      if (url === '/api/vocabulary' && req.method === 'GET') {
        return send(res, 200, await readVocabulary());
      }

      if (url === '/api/vocabulary' && req.method === 'PUT') {
        const body = (await readBody(req)) as Vocabulary | undefined;
        if (!body || !Array.isArray(body.entries) || !Array.isArray(body.sets)) {
          return send(res, 400, { error: 'Expected { version, sets[], entries[] }' });
        }
        await queueWrite(() => writeVocabulary(body));
        return send(res, 200, { ok: true, entries: body.entries.length });
      }

      if (url === '/api/progress' && req.method === 'GET') {
        return send(res, 200, await readProgress());
      }

      if (url === '/api/progress' && req.method === 'PUT') {
        const body = (await readBody(req)) as ProgressFile | undefined;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return send(res, 400, { error: 'Expected an object keyed by entry id' });
        }
        await queueWrite(() => writeProgress(body));
        return send(res, 200, { ok: true, words: Object.keys(body).length });
      }

      if (url === '/api/sentence' && req.method === 'POST') {
        const body = (await readBody(req)) as { entryId?: string } | undefined;
        if (!body?.entryId) return send(res, 400, { error: 'Expected { entryId }' });

        // Generate, then persist into the vocabulary file so the next session
        // finds it on disk and never pays for the same sentence twice.
        const example = await queueWrite(async () => {
          const doc = await readVocabulary();
          const entry = doc.entries.find((e) => e.id === body.entryId);
          if (!entry) throw Object.assign(new Error('Unknown entryId'), { status: 404 });
          const created = await generateSentence(
            entry,
            entry.examples.map((ex) => ex.pl),
          );
          entry.examples.push(created);
          await writeVocabulary(doc);
          return created;
        });

        return send(res, 200, example);
      }

      if (url === '/api/status' && req.method === 'GET') {
        return send(res, 200, {
          sentenceApi: Boolean(process.env.ANTHROPIC_API_KEY),
          model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
          file: VOCAB_FILE,
          progressFile: PROGRESS_FILE,
        });
      }

      return send(res, 404, { error: `No route for ${req.method} ${url}` });
    } catch (error) {
      const err = error as Error & { status?: number };
      // eslint-disable-next-line no-console
      console.error('[vocab-api]', err.message);
      send(res, err.status ?? 500, { error: err.message });
    }
  })();
};

export function vocabApi(): Plugin {
  return {
    name: 'polski-trainer-vocab-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
