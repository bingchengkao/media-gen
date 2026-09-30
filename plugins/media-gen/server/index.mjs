#!/usr/bin/env node
// media-gen: an MCP server that generates images, music, speech and video through OpenRouter.
//
// No dependencies: Node 18+ (global fetch). It speaks MCP over stdio — JSON-RPC 2.0, one message
// per line — so stdout carries protocol messages only.
//
// The API key comes from the environment. The plugin's settings dialog keeps it in the system
// keychain and Claude Code hands it in as MEDIA_GEN_OPENROUTER_API_KEY; OPENROUTER_API_KEY is the
// fallback. The key goes to openrouter.ai and nowhere else: never into a result, never onto disk.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SERVER = { name: 'media-gen', version: '0.1.1' };
const API = 'https://openrouter.ai/api/v1';
const PROTOCOL = '2025-06-18';

// Rough output tokens in a ~1K image, for token-priced image models. Good enough to check a
// spending threshold; the real charge comes back with the result.
const TOKENS_PER_1K_IMAGE = 1300;
// Models that take a quality setting can default to their dearest one, which costs several times more.
const TOP_QUALITY_FACTOR = 5;
// Speech can be billed on the audio it makes. Guessed cautiously from the text: about 4 spoken
// characters a second (a Chinese pace) at about 25 audio tokens a second.
const AUDIO_TOKENS_PER_CHAR = 6.25;
const ASK_AT_COUNT = 8;
const ASK_AT_USD = 1;

class ToolError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
const compact = (obj) =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)),
  );

// ── Key ─────────────────────────────────────────────────────────────────────────────────────────

const NO_KEY =
  'No OpenRouter API key is set, so nothing was generated and nothing was spent. ' +
  "The user adds the key in this plugin's settings (Claude Code: /plugin, Installed, media-gen, Configure options). " +
  'They paste it there themselves; never ask for the key in the chat. ' +
  'A key made just for this, with a spend limit, is safest: https://openrouter.ai/settings/keys';

const KEY_VARS = ['MEDIA_GEN_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'];

function apiKey() {
  for (const name of KEY_VARS) {
    const value = process.env[name]?.trim();
    // An option the user never filled in can arrive empty, or as the unexpanded placeholder.
    if (!value || value.includes('${')) continue;
    // A key is one run of printable characters. Anything else would make fetch throw an error
    // that quotes the whole header, key included.
    if (!/^[\x21-\x7e]+$/.test(value)) {
      throw new ToolError(
        'The saved OpenRouter key has spaces, line breaks or other characters a key never has, so nothing was sent or spent. ' +
          "The user pastes it again in this plugin's settings.",
      );
    }
    return value;
  }
  throw new ToolError(NO_KEY);
}

// Last line of defence: whatever goes back to the model, the key is not in it.
function redact(text) {
  for (const name of KEY_VARS) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) text = text.split(value).join('[key]');
  }
  return text.replace(/sk-or-[\w-]{8,}/g, '[key]');
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────

const STATUS_HINTS = {
  400: "A field or value this model does not accept. Check https://openrouter.ai/<model id>/llms.txt and retry.",
  401: "The key was refused. The user checks the key in the plugin's settings.",
  402: 'The account is out of credit. The user adds credit at https://openrouter.ai/settings/credits.',
  403: 'The key hit its spend limit or is disabled. Raising the limit is the user\'s call.',
  404: 'Unknown model, or no provider can serve this request right now.',
  429: 'Rate limited. Wait a little and retry.',
  502: 'The provider failed. Failed generations are not billed, so a retry is fine.',
};

async function failure(res) {
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    detail = JSON.parse(text)?.error?.message ?? text;
  } catch {}
  const hint = STATUS_HINTS[res.status] ?? '';
  return new ToolError(`OpenRouter answered ${res.status}: ${String(detail).slice(0, 800)} ${hint}`.trim());
}

async function request(method, url, { body, auth = true } = {}) {
  const headers = { 'X-Title': 'media-gen' };
  if (auth) headers.Authorization = `Bearer ${apiKey()}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return res;
}

const getJson = async (url, opts) => (await request('GET', url, opts)).json();
const postJson = async (url, body) => (await request('POST', url, { body })).json();

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: await fn(items[i], i) };
      } catch (error) {
        out[i] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────

const EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/flac': '.flac', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/aac': '.aac', 'audio/mp4': '.m4a',
  'audio/pcm': '.pcm', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
};

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

// What the bytes actually are, from their first few; null when unsure.
function sniff(buf) {
  const s = (a, b) => buf.subarray(a, b).toString('latin1');
  if (s(0, 8) === '\x89PNG\r\n\x1a\n') return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return '.webp';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return '.wav';
  if (s(0, 4) === 'GIF8') return '.gif';
  if (s(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return '.mp3';
  if (s(0, 4) === 'fLaC') return '.flac';
  if (s(0, 4) === 'OggS') return '.ogg';
  if (s(4, 8) === 'ftyp') return s(8, 11) === 'M4A' ? '.m4a' : s(8, 10) === 'qt' ? '.mov' : '.mp4';
  if (s(0, 4) === '\x1a\x45\xdf\xa3') return '.webm';
  if (/^\s*<(\?xml|svg)/.test(s(0, 200))) return '.svg';
  return null;
}

const extFor = (buf, mime, fallback) => sniff(buf) ?? EXT[mime?.split(';')[0].trim()] ?? fallback;

// Runs before anything is paid for: a folder that cannot be made fails here, for free.
async function prepareOut(outPath) {
  if (typeof outPath !== 'string' || !outPath.trim()) throw new ToolError('out_path is required: where to save the result.');
  const file = path.resolve(outPath);
  try {
    await mkdir(path.dirname(file), { recursive: true });
  } catch (error) {
    throw new ToolError(`Cannot create the folder ${path.dirname(file)} (${error.code ?? error.message}). Nothing was generated or spent; choose another out_path.`);
  }
  return file;
}

// Writes each item beside outPath as name.ext, name-2.ext, … and never over an existing file,
// even one that appears mid-write. The extension follows what the bytes are, whatever outPath said.
async function writeAll(outPath, items) {
  const { dir, name } = path.parse(outPath);
  await mkdir(dir, { recursive: true });
  const stem = (n) => path.join(dir, n > 1 ? `${name}-${n}` : name);
  const written = [];
  let n = 1;
  for (const { buf, ext } of items) {
    for (;;) {
      const file = stem(n++) + ext;
      try {
        await writeFile(file, buf, { flag: 'wx' });
        written.push(file);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  }
  return written;
}

// By now the user has paid, so a failed save falls back to the temp folder rather than losing it.
async function save(outPath, items) {
  try {
    return { files: await writeAll(outPath, items) };
  } catch (error) {
    const fallback = path.join(os.tmpdir(), 'media-gen', path.basename(outPath));
    return {
      files: await writeAll(fallback, items),
      note: `Could not save at ${outPath} (${error.code ?? error.message}), so it went to ${path.dirname(fallback)}.`,
    };
  }
}

async function asUrl(ref) {
  if (/^(https?|data):/i.test(ref)) return ref;
  const file = path.resolve(ref);
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new ToolError(`Cannot tell what kind of file ${file} is. Use png, jpg, webp, gif, mp3, wav, m4a, ogg, flac, mp4, mov or webm.`);
  const data = await readFile(file).catch(() => {
    throw new ToolError(`Cannot read ${file}.`);
  });
  return `data:${mime};base64,${data.toString('base64')}`;
}

const imageParts = async (refs = []) =>
  Promise.all(refs.map(async (ref) => ({ type: 'image_url', image_url: { url: await asUrl(ref) } })));

// ── Money ───────────────────────────────────────────────────────────────────────────────────────

async function keyStatus() {
  const { data } = await getJson('/key');
  return compact({
    spent_usd_all_time: round(data.usage),
    spent_usd_today: round(data.usage_daily),
    limit_usd: data.limit ?? 'none set',
    remaining_usd: round(data.limit_remaining),
  });
}

// Speech answers with bare audio, so its charge is looked up afterwards; the record can lag.
async function generationCost(id) {
  if (!id) return undefined;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { data } = await getJson(`/generation?id=${encodeURIComponent(id)}`);
      if (typeof data?.total_cost === 'number') return data.total_cost;
    } catch {}
    await sleep(1000 * attempt);
  }
  return undefined;
}

// No balance here: the key's totals lag behind a fresh charge, so right after one they read high.
function report({ model, files, cost, notes }) {
  return compact({
    model,
    files,
    cost_usd: cost == null ? 'not reported by OpenRouter' : round(cost),
    notes,
  });
}

function mustAsk(what, estimate) {
  return new ToolError(
    `${what} needs the user's yes first${estimate == null ? '' : ` (a cautious estimate: up to about US$${round(estimate)})`}. ` +
      'Tell them what you will make, with which model and roughly what it costs, then call again with user_approved: true.',
  );
}

// ── Models ──────────────────────────────────────────────────────────────────────────────────────

const endpointCache = new Map();

function imageEndpoint(id) {
  if (!endpointCache.has(id)) {
    const pending = getJson(`/images/models/${id}/endpoints`, { auth: false }).then((r) => r.endpoints?.[0] ?? null);
    pending.catch(() => endpointCache.delete(id));
    endpointCache.set(id, pending);
  }
  return endpointCache.get(id);
}

function describeImagePrice(pricing = []) {
  if (!pricing.length) return 'not listed';
  return pricing
    .map(({ billable, unit, cost_usd: c, variant }) => {
      const label = variant ? `${billable} ${variant}` : billable;
      const out = billable === 'output_image';
      if (unit === 'token') return `${label} $${round(c * 1e6)}/M tokens${out ? ` (~$${round(c * TOKENS_PER_1K_IMAGE)} per 1K image)` : ''}`;
      if (unit === 'megapixel') return `${label} $${c}/megapixel${out ? ` (~$${c} per 1K image)` : ''}`;
      return `${label} $${c}/${unit}`;
    })
    .join('; ');
}

// A cautious guess at a whole request, used only to decide whether to ask the user first.
// Reference images are billed on every call that carries them.
function estimateImageCost(endpoint, { resolution, quality, count, calls, references = [] }) {
  const pricing = endpoint?.pricing ?? [];
  const outputs = pricing.filter((p) => p.billable === 'output_image');
  if (!outputs.length) return undefined;
  const size = /4k/i.test(resolution ?? '') ? 4 : /2k/i.test(resolution ?? '') ? 2 : 1;
  const top = endpoint.supported_parameters?.quality && !['low', 'medium'].includes(quality) ? TOP_QUALITY_FACTOR : 1;
  const perImage = Math.max(
    ...outputs.map(({ unit, cost_usd: c }) =>
      unit === 'token' ? c * TOKENS_PER_1K_IMAGE * Math.max(size, top) : unit === 'megapixel' ? c * size * size : c,
    ),
  );
  const perCall = pricing
    .filter((p) => p.billable === 'input_image' || p.billable === 'input_reference')
    .reduce((sum, { unit, cost_usd: c }) => sum + (unit === 'token' ? c * TOKENS_PER_1K_IMAGE : c) * references.length, 0);
  return perImage * count + perCall * calls;
}

function estimateSpeechCost(model, characters) {
  const input = Number(model?.pricing?.prompt) || 0;
  const output = Number(model?.pricing?.completion) || 0;
  if (!input && !output) return undefined;
  return input * characters + output * characters * AUDIO_TOKENS_PER_CHAR;
}

const describeParams = (params = {}) =>
  Object.entries(params)
    .map(([k, v]) => `${k}: ${v.type === 'enum' ? v.values.join('|') : v.type === 'range' ? `${v.min}-${v.max}` : v.type ?? ''}`)
    .join('; ');

const describeRates = (pricing = {}) => {
  const parts = Object.entries(pricing)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k} $${round(Number(v) * 1e6)}/M`);
  return parts.length ? parts.join('; ') : 'see about';
};

const describeSkus = (skus = {}) =>
  Object.entries(skus)
    .map(([k, v]) => (k.startsWith('cents_') ? `${k.slice(6)} ${v}¢` : `${k} $${v}`))
    .join('; ') || 'not listed';

const listOf = (values) => (Array.isArray(values) && values.length ? values.join(', ') : undefined);
const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : undefined);
const about = (text) => text?.replace(/\s+/g, ' ').slice(0, 240);
const newestFirst = (a, b) => (b.created ?? 0) - (a.created ?? 0);

async function listModels({ kind, match }) {
  const wanted = (m) => !match || `${m.id} ${m.name}`.toLowerCase().includes(match.toLowerCase());

  if (kind === 'image') {
    const { data } = await getJson('/images/models', { auth: false });
    const models = data.filter(wanted).sort(newestFirst);
    const rows = await mapLimit(models, 8, async (m) => {
      const endpoint = await imageEndpoint(m.id).catch(() => null);
      return compact({
        id: m.id,
        name: m.name,
        released: day(m.created),
        about: about(m.description),
        price: endpoint ? describeImagePrice(endpoint.pricing) : 'not listed',
        options: describeParams(endpoint?.supported_parameters ?? m.supported_parameters),
      });
    });
    return rows.map((r) => r.ok);
  }

  if (kind === 'video') {
    const { data } = await getJson('/videos/models', { auth: false });
    return data
      .filter(wanted)
      .sort(newestFirst)
      .map((m) =>
        compact({
          id: m.id,
          name: m.name,
          released: day(m.created),
          about: about(m.description),
          price: describeSkus(m.pricing_skus),
          durations_s: listOf(m.supported_durations),
          resolutions: listOf(m.supported_resolutions),
          aspect_ratios: listOf(m.supported_aspect_ratios),
          frame_images: listOf(m.supported_frame_images),
          makes_audio: m.generate_audio || undefined,
        }),
      );
  }

  if (kind === 'speech' || kind === 'music') {
    const modality = kind === 'speech' ? 'speech' : 'audio';
    const { data } = await getJson(`/models?output_modalities=${modality}`, { auth: false });
    return data
      .filter(wanted)
      .sort(newestFirst)
      .map((m) => {
        const voices = m.supported_voices ?? [];
        return compact({
          id: m.id,
          name: m.name,
          released: day(m.created),
          about: about(m.description),
          price: describeRates(m.pricing),
          voices: voices.length ? `${voices.slice(0, 12).join(', ')}${voices.length > 12 ? ` (+${voices.length - 12} more)` : ''}` : undefined,
        });
      });
  }

  throw new ToolError('kind must be one of: image, music, speech, video.');
}

// ── Image ───────────────────────────────────────────────────────────────────────────────────────

async function generateImage(a) {
  const outPath = await prepareOut(a.out_path);
  const count = Math.max(1, Math.min(a.count ?? 1, 20));
  const endpoint = await imageEndpoint(a.model).catch(() => null);
  const maxPerCall = endpoint?.supported_parameters?.n?.max ?? 1;
  const batches = [];
  for (let left = count; left > 0; left -= maxPerCall) batches.push(Math.min(maxPerCall, left));

  const estimate = estimateImageCost(endpoint, { ...a, count, calls: batches.length });
  if (a.user_approved !== true) {
    if (count >= ASK_AT_COUNT) throw mustAsk(`${count} images in one request`, estimate);
    if (estimate != null && estimate >= ASK_AT_USD) throw mustAsk('This request', estimate);
    if (estimate == null && count > 1) throw mustAsk(`${count} images from a model whose price could not be looked up`);
  }

  const base = compact({
    model: a.model,
    prompt: a.prompt,
    aspect_ratio: a.aspect_ratio,
    resolution: a.resolution,
    quality: a.quality,
    background: a.background,
    output_format: a.output_format,
    input_references: await imageParts(a.references),
    ...a.extra,
  });
  const results = await mapLimit(batches, 3, (n, i) =>
    postJson('/images', compact({ ...base, n: n > 1 ? n : undefined, seed: a.seed == null ? undefined : a.seed + i })),
  );

  const items = [];
  const notes = [];
  let cost = 0;
  let costKnown = true;
  for (const { ok, error } of results) {
    if (error) {
      notes.push(`One batch failed: ${error.message}`);
      continue;
    }
    for (const image of ok.data ?? []) {
      let buf;
      if (image.b64_json) buf = Buffer.from(image.b64_json, 'base64');
      else {
        const res = await fetch(image.url).catch(() => null);
        if (!res?.ok) {
          notes.push(`One image was paid for but could not be downloaded from ${image.url}.`);
          continue;
        }
        buf = Buffer.from(await res.arrayBuffer());
      }
      items.push({ buf, ext: extFor(buf, image.media_type, path.extname(outPath) || '.png') });
    }
    if (typeof ok.usage?.cost === 'number') cost += ok.usage.cost;
    else costKnown = false;
  }
  if (!results.some((r) => r.ok)) throw new ToolError(notes.join(' '));
  const total = costKnown ? cost : undefined;
  if (!items.length) {
    notes.push('No image came back; the prompt may have been refused.');
    return report({ model: a.model, cost: total, notes: notes.join(' ') });
  }
  if (items.length < count) notes.push(`Asked for ${count}, got ${items.length}.`);
  const { files, note } = await save(outPath, items);
  if (note) notes.push(note);
  return report({ model: a.model, files, cost: total, notes: notes.join(' ') || undefined });
}

// ── Speech ──────────────────────────────────────────────────────────────────────────────────────

const speechModels = new Map();

async function speechModel(id) {
  if (!speechModels.size) {
    const { data } = await getJson('/models?output_modalities=speech', { auth: false });
    for (const m of data) speechModels.set(m.id, m);
  }
  return speechModels.get(id);
}

async function generateSpeech(a) {
  const outPath = await prepareOut(a.out_path);
  if (typeof a.text !== 'string' || !a.text.trim()) throw new ToolError('text is required: the words to speak.');
  const estimate = estimateSpeechCost(await speechModel(a.model).catch(() => undefined), a.text.length);
  if (a.user_approved !== true && estimate != null && estimate >= ASK_AT_USD) throw mustAsk('This speech', estimate);

  let references;
  if (a.reference_audio) {
    const file = path.resolve(a.reference_audio);
    const data = await readFile(file).catch(() => {
      throw new ToolError(`Cannot read ${file}.`);
    });
    references = [
      compact({
        type: 'input_audio',
        input_audio: { data: data.toString('base64'), format: path.extname(file).slice(1).toLowerCase() },
        text: a.reference_text,
      }),
    ];
  }

  const format = a.format ?? 'mp3';
  const res = await request('POST', '/audio/speech', {
    body: compact({
      model: a.model,
      input: a.text,
      voice: a.voice,
      response_format: format,
      speed: a.speed,
      input_references: references,
      ...a.extra,
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  // Raw PCM has no header to sniff, and can start with bytes that look like mp3.
  const ext = format === 'pcm' ? '.pcm' : extFor(buf, res.headers.get('content-type'), `.${format}`);
  const { files, note } = await save(outPath, [{ buf, ext }]);
  const cost = await generationCost(res.headers.get('x-generation-id'));
  const notes = [note, ext === '.pcm' ? 'Raw PCM: most players cannot open it. mp3 is the usual choice.' : undefined];
  return report({ model: a.model, files, cost, notes: notes.filter(Boolean).join(' ') || undefined });
}

// ── Music ───────────────────────────────────────────────────────────────────────────────────────

// Streamed audio arrives as base64 pieces. Pieces that are each whole base64 decode on their own;
// otherwise they are slices of one string and decode joined.
function decodeChunks(chunks) {
  const clean = chunks.map((c) => c.replace(/^data:[^,]*,/, ''));
  return clean.every((c) => c.length % 4 === 0)
    ? Buffer.concat(clean.map((c) => Buffer.from(c, 'base64')))
    : Buffer.from(clean.join(''), 'base64');
}

async function readChat(res) {
  const audio = [];
  let text = '';
  let cost;
  let id;
  const take = (chunk) => {
    if (chunk.error) throw new ToolError(`OpenRouter reported an error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    id ??= chunk.id;
    if (typeof chunk.usage?.cost === 'number') cost = chunk.usage.cost;
    for (const choice of chunk.choices ?? []) {
      const d = choice.delta ?? choice.message ?? {};
      if (d.audio?.data) audio.push(d.audio.data);
      if (d.audio?.transcript) text += d.audio.transcript;
      if (typeof d.content === 'string') text += d.content;
      else if (Array.isArray(d.content)) {
        for (const part of d.content) {
          const data = part.audio?.data ?? part.output_audio?.data ?? part.input_audio?.data ?? (/audio/.test(part.type ?? '') ? part.data : undefined);
          if (data) audio.push(data);
          else if (part.text) text += part.text;
        }
      }
    }
  };

  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    take(await res.json());
    return { audio, text, cost, id };
  }
  const line = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('data:')) return; // keep-alive comments such as ": OPENROUTER PROCESSING"
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    take(chunk);
  };
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const bytes of res.body) {
    buffered += decoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      line(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
    }
  }
  line(buffered + decoder.decode()); // the last line may carry the cost and no newline
  return { audio, text, cost, id };
}

async function generateMusic(a) {
  const outPath = await prepareOut(a.out_path);
  const content = a.references?.length ? [{ type: 'text', text: a.prompt }, ...(await imageParts(a.references))] : a.prompt;
  const res = await request('POST', '/chat/completions', {
    body: compact({
      model: a.model,
      messages: [{ role: 'user', content }],
      modalities: ['text', 'audio'],
      audio: a.format ? { format: a.format } : undefined,
      stream: true,
      usage: { include: true },
      ...a.extra,
    }),
  });
  const { audio, text, cost, id } = await readChat(res);
  if (!audio.length) {
    throw new ToolError(
      `No audio came back. The model said: ${text.trim().slice(0, 500) || '(nothing)'}. ` +
        `Check https://openrouter.ai/${a.model}/llms.txt for the fields it needs and pass them in extra.`,
    );
  }
  const buf = decodeChunks(audio);
  const raw = /^pcm/.test(a.format ?? '');
  const ext = raw ? '.pcm' : extFor(buf, undefined, a.format ? `.${a.format}` : '.pcm');
  const { files, note } = await save(outPath, [{ buf, ext }]);
  const notes = [note, text.trim() ? `Text that came with it: ${text.trim().slice(0, 1500)}` : undefined];
  return report({ model: a.model, files, cost: cost ?? (await generationCost(id)), notes: notes.filter(Boolean).join(' ') || undefined });
}

// ── Video ───────────────────────────────────────────────────────────────────────────────────────

// A finished job does not say which model made it, so the server remembers.
const videoJobs = new Map();

async function generateVideo(a) {
  if (a.user_approved !== true) {
    throw new ToolError(
      "Every video needs the user's yes, every time: video is expensive and takes minutes. " +
        'Tell them the model, the length and the estimated cost, then call again with user_approved: true.',
    );
  }
  const frames = [];
  if (a.first_frame) frames.push({ type: 'image_url', image_url: { url: await asUrl(a.first_frame) }, frame_type: 'first_frame' });
  if (a.last_frame) frames.push({ type: 'image_url', image_url: { url: await asUrl(a.last_frame) }, frame_type: 'last_frame' });
  const job = await postJson(
    '/videos',
    compact({
      model: a.model,
      prompt: a.prompt,
      duration: a.duration,
      resolution: a.resolution,
      aspect_ratio: a.aspect_ratio,
      size: a.size,
      frame_images: frames,
      input_references: await imageParts(a.references),
      generate_audio: a.generate_audio,
      seed: a.seed,
      ...a.extra,
    }),
  );
  videoJobs.set(job.id, { model: a.model, generation: job.generation_id });
  return compact({
    job_id: job.id,
    model: a.model,
    status: job.status,
    next: 'Call video_status with this job_id, the model and an out_path. Video takes from about 30 seconds to several minutes; wait_seconds waits inside the call.',
  });
}

const RUNNING = new Set(['pending', 'queued', 'in_progress', 'processing']);

async function videoStatus(a) {
  const outPath = await prepareOut(a.out_path);
  const remembered = videoJobs.get(a.job_id) ?? {};
  const id = encodeURIComponent(a.job_id);
  const deadline = Date.now() + Math.min(Math.max(a.wait_seconds ?? 0, 0), 600) * 1000;
  let job = await getJson(`/videos/${id}`);
  while (RUNNING.has(job.status) && Date.now() + 15000 <= deadline) {
    await sleep(15000);
    job = await getJson(`/videos/${id}`);
  }
  if (job.status !== 'completed') {
    return compact({
      job_id: a.job_id,
      status: job.status,
      error: job.error?.message ?? job.error,
      notes: RUNNING.has(job.status) ? 'Still running. Call again later.' : 'It did not finish. Failed generations are not billed.',
    });
  }
  const items = [];
  const clips = job.unsigned_urls?.length || 1;
  for (let i = 0; i < clips; i++) {
    const res = await request('GET', `/videos/${id}/content?index=${i}`);
    const buf = Buffer.from(await res.arrayBuffer());
    items.push({ buf, ext: extFor(buf, res.headers.get('content-type'), '.mp4') });
  }
  const { files, note } = await save(outPath, items);
  const cost = job.usage?.cost ?? (await generationCost(job.generation_id ?? remembered.generation));
  return report({ model: a.model ?? remembered.model ?? job.model, files, cost, notes: note });
}

// ── Tools ───────────────────────────────────────────────────────────────────────────────────────

const SPEND =
  "Spends the user's money. The first generation in a conversation needs the user's yes to start using the paid API; " +
  `after that, ask first only when one request makes ${ASK_AT_COUNT} or more items or is estimated at US$${ASK_AT_USD} or more. ` +
  'Afterwards, tell the user which model you used and the cost this reports.';

const str = (description) => ({ type: 'string', description });
const extra = {
  type: 'object',
  description: "Any other field from the model's guide at https://openrouter.ai/<model id>/llms.txt; merged into the request body.",
};
const outPath = str('Where to save, preferably absolute. Several files become name-2, name-3, …; nothing is overwritten; the extension follows the real format.');
const approved = (when) => ({ type: 'boolean', description: `True only after the user said yes to this request. Needed ${when}.` });

const TOOLS = [
  {
    name: 'list_models',
    description:
      'List the OpenRouter models that make one kind of media right now, newest first, with prices and options. ' +
      "Free: needs no key and spends nothing. Speech 'prompt' prices are per input character for most models; music prices are in 'about'.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'music', 'speech', 'video'] },
        match: str("Keep only models whose id or name contains this, e.g. 'gemini', 'flux', 'lyria'."),
      },
      required: ['kind'],
    },
    run: listModels,
  },
  {
    name: 'generate_image',
    description: `Make or edit images with an OpenRouter image model and save them. ${SPEND}`,
    inputSchema: {
      type: 'object',
      properties: {
        model: str('Model id from list_models kind=image.'),
        prompt: str('What to make, written the way this model wants to be prompted.'),
        out_path: outPath,
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'How many images. Default 1.' },
        aspect_ratio: str("e.g. '1:1', '16:9', '9:16' — whatever the model lists."),
        resolution: str("e.g. '1K', '2K', '4K' — for models that take it."),
        quality: str("'low' | 'medium' | 'high' — for models that take it."),
        background: str("'transparent' | 'opaque' | 'auto' — for models that take it."),
        output_format: str("e.g. 'png', 'webp', 'svg' — for models that take it."),
        seed: { type: 'integer' },
        references: { type: 'array', items: { type: 'string' }, description: 'Images to work from or edit: local paths or URLs.' },
        user_approved: approved(`for ${ASK_AT_COUNT}+ images or an estimated US$${ASK_AT_USD}+`),
        extra,
      },
      required: ['model', 'prompt', 'out_path'],
    },
    run: generateImage,
  },
  {
    name: 'generate_music',
    description: `Make music (a song, a loop, a sting) with an OpenRouter music model and save it. ${SPEND}`,
    inputSchema: {
      type: 'object',
      properties: {
        model: str('Model id from list_models kind=music.'),
        prompt: str('Style, mood, instruments, tempo, length, lyrics if any.'),
        out_path: outPath,
        format: str("Audio format to ask for, e.g. 'mp3' or 'wav', if the model takes one."),
        references: { type: 'array', items: { type: 'string' }, description: 'Images to draw the mood from: local paths or URLs.' },
        extra,
      },
      required: ['model', 'prompt', 'out_path'],
    },
    run: generateMusic,
  },
  {
    name: 'generate_speech',
    description: `Turn text into a spoken audio file with an OpenRouter speech model. ${SPEND}`,
    inputSchema: {
      type: 'object',
      properties: {
        model: str('Model id from list_models kind=speech. Check it speaks the language of the text.'),
        text: str('The words to speak.'),
        out_path: outPath,
        voice: str("A voice the model lists under 'voices'."),
        format: str("'mp3' (default) or 'pcm'."),
        speed: { type: 'number', description: '1.0 is normal.' },
        reference_audio: str('A short recording to imitate, for models that clone voices: local path.'),
        reference_text: str('What is said in reference_audio, if the model wants it.'),
        user_approved: approved(`for an estimated US$${ASK_AT_USD}+`),
        extra,
      },
      required: ['model', 'text', 'out_path'],
    },
    run: generateSpeech,
  },
  {
    name: 'generate_video',
    description:
      'Start making a video with an OpenRouter video model. Expensive and slow: use it only when the user brought video up, ' +
      "and only after the user said yes to this video — every time, whatever they agreed to before. Returns a job; video_status collects it. " +
      'Afterwards, tell the user which model you used and the cost.',
    inputSchema: {
      type: 'object',
      properties: {
        model: str('Model id from list_models kind=video.'),
        prompt: str('What happens, the camera, the look.'),
        user_approved: approved('always, for every video'),
        duration: { type: 'integer', description: 'Seconds; one the model lists.' },
        resolution: str("e.g. '720p', '1080p'."),
        aspect_ratio: str("e.g. '16:9', '9:16'."),
        size: str("Exact 'WIDTHxHEIGHT', if the model lists sizes."),
        first_frame: str('Image to start from: local path or URL.'),
        last_frame: str('Image to end on: local path or URL.'),
        references: { type: 'array', items: { type: 'string' }, description: 'Images to guide it: local paths or URLs.' },
        generate_audio: { type: 'boolean', description: 'Make sound too, if the model can. Often costs more.' },
        seed: { type: 'integer' },
        extra,
      },
      required: ['model', 'prompt', 'user_approved'],
    },
    run: generateVideo,
  },
  {
    name: 'video_status',
    description: 'Check a video job from generate_video; once it is done, save the video and report the cost.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: str('The job_id generate_video returned.'),
        model: str('The model generate_video used, so the report can name it.'),
        out_path: outPath,
        wait_seconds: { type: 'integer', minimum: 0, maximum: 600, description: 'Wait up to this long for it to finish. Default 0.' },
      },
      required: ['job_id', 'out_path'],
    },
    run: videoStatus,
  },
  {
    name: 'check_balance',
    description:
      "How much the user's OpenRouter key has spent and how much of its limit is left. Free. " +
      'The totals can take a few minutes to include the latest generations.',
    inputSchema: { type: 'object', properties: {} },
    run: keyStatus,
  },
];

// ── MCP over stdio ──────────────────────────────────────────────────────────────────────────────

async function handle(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params.name}`), { code: -32602 });
      try {
        const result = await tool.run(params.arguments ?? {});
        return { content: [{ type: 'text', text: redact(JSON.stringify(result, null, 2)) }] };
      } catch (error) {
        const message = error instanceof ToolError ? error.message : `Unexpected failure: ${error.message}`;
        return { content: [{ type: 'text', text: redact(message) }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (message.id === undefined || message.id === null) return; // a notification: nothing to answer
  try {
    send({ jsonrpc: '2.0', id: message.id, result: await handle(message.method, message.params ?? {}) });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: redact(error.message) } });
  }
});
