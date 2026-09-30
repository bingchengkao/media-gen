#!/usr/bin/env node
// Talks to the MCP server the way Claude Code does and checks everything that needs no key and
// spends nothing: the handshake, the tool list, live model listings, and the refusals.
//
//   node scripts/smoke.mjs
//
// Runs with the key variables removed, so it can never spend money.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(os.tmpdir(), 'media-gen-smoke', 'never.png');

function start(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!('OPENROUTER_API_KEY' in extraEnv)) delete env.OPENROUTER_API_KEY;
  delete env.MEDIA_GEN_OPENROUTER_API_KEY;
  const child = spawn('node', [path.join(root, 'plugins/media-gen/server/index.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let buffered = '';
  child.stdout.on('data', (bytes) => {
    buffered += bytes;
    let nl;
    while ((nl = buffered.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let nextId = 1;
  const rpc = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  return { child, rpc, call };
}

const { child: server, rpc, call } = start();

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
check('initialize', init.result?.serverInfo?.name === 'media-gen');
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

const { tools } = (await rpc('tools/list')).result;
check('tools/list', tools.length === 7, tools.map((t) => t.name).join(', '));

for (const [kind, match] of [['image', 'gemini'], ['image', 'flux'], ['music', ''], ['speech', ''], ['video', '']]) {
  const result = await call('list_models', { kind, match: match || undefined });
  const rows = result.isError ? [] : JSON.parse(result.content[0].text);
  check(`list_models ${kind}${match ? ` ${match}` : ''}`, rows.length > 0 && rows.every((r) => r.id && r.price), `${rows.length} models, newest ${rows[0]?.id}: ${rows[0]?.price}`);
}

const text = (result) => result.content[0].text;
const asks = (result) => result.isError && /needs the user's yes/.test(text(result));

const noKey = await call('generate_image', { model: 'google/gemini-3.1-flash-image', prompt: 'x', out_path: out });
check('no key: refuses before spending', noKey.isError && /No OpenRouter API key/.test(text(noKey)));

const badFolder = await call('generate_image', { model: 'google/gemini-3.1-flash-image', prompt: 'x', out_path: '/no-such-root/x.png' });
check('unwritable out_path: refuses before spending', badFolder.isError && /Nothing was generated or spent/.test(text(badFolder)));

const tooMany = await call('generate_image', { model: 'google/gemini-3.1-flash-image', prompt: 'x', out_path: out, count: 8 });
check('8 images: asks first', asks(tooMany), text(tooMany).slice(0, 100));

const approvedAsString = await call('generate_image', { model: 'google/gemini-3.1-flash-image', prompt: 'x', out_path: out, count: 8, user_approved: 'true' });
check("'true' as a string is not a yes", asks(approvedAsString));

const topQuality = await call('generate_image', { model: 'openai/gpt-image-1', prompt: 'x', out_path: out, count: 7 });
check('quality left unset on a model that has one: counted as its dearest', asks(topQuality), text(topQuality).slice(0, 100));

const references = await call('generate_image', {
  model: 'sourceful/riverflow-v2-pro', prompt: 'x', out_path: out, resolution: '4K', references: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'],
});
check('reference images: counted in the estimate', asks(references), text(references).slice(0, 100));

const narration = await call('generate_speech', { model: 'bytedance-seed/seed-audio-1-0', text: 'x'.repeat(400), out_path: out });
check('speech billed on output: counted in the estimate', asks(narration), text(narration).slice(0, 100));

const video = await call('generate_video', { model: 'google/veo-3.1-lite', prompt: 'x', user_approved: false });
check('video: asks every time', video.isError && /Every video needs/.test(text(video)));

const fake = 'sk-or-v1-fake0000' + '\n' + 'secondline';
const broken = start({ OPENROUTER_API_KEY: fake });
await broken.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
const garbled = await broken.call('generate_image', { model: 'google/gemini-3.1-flash-image', prompt: 'x', out_path: out });
check('garbled key: refused without quoting it', garbled.isError && /never has/.test(text(garbled)) && !text(garbled).includes('fake0000'));
broken.child.kill();

const balance = await call('check_balance', {});
check('balance without key: says so', balance.isError && /No OpenRouter API key/.test(balance.content[0].text));

const unknown = await rpc('no/such/method');
check('unknown method: JSON-RPC error', unknown.error?.code === -32601);

server.kill();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
