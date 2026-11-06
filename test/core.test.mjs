import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { saveConfig, loadConfig, validateConfig, writePrivateJson } from '../src/config.mjs';
import { processDiscordMessage, drainOutbox, validateGatewayUrl, DiscordGateway, startDiscord } from '../src/discord.mjs';

const channel = '111111111111111111'; const guild = '222222222222222222'; const human = '333333333333333333'; const bot = '444444444444444444';
const config = () => ({ version: 1, agents: [{ id: 'claude' }, { id: 'codex' }], discord: { guildId: guild,
  channelRoutes: [{ channelId: channel, agentId: 'claude' }], allowedUserIds: [human], allowedBotIds: [] } });
function fixture(t) { const home = mkdtempSync(join(tmpdir(), 'connectduet-core-')); const store = new Store(home); const stores = [store]; t.after(() => { for (const s of stores) s.close(); rmSync(home, { recursive: true, force: true }); }); return { home, store, reopen: () => { const second = new Store(home); stores.push(second); return second; } }; }
const incoming = (extra = {}) => ({ id: '555555555555555555', guild_id: guild, channel_id: channel, content: 'Please review this.', author: { id: human, username: 'example', bot: false }, ...extra });

test('config round trip, IDs remain strings and secret config is rejected', t => {
  const { home } = fixture(t); saveConfig(home, config()); assert.deepEqual(loadConfig(home), config());
  for (const bad of [ { ...config(), agents: [{ id: 123 }] }, { ...config(), discord: { ...config().discord, guildId: 111111111111111111 } },
    { ...config(), discord: { ...config().discord, token: 'never-inline' } } ]) assert.throws(() => validateConfig(bad));
});
test('inboxes persist, preserve FIFO, are nondestructive and acknowledgements are recipient scoped', t => {
  const { reopen, store } = fixture(t);
  const ids = Array.from({ length: 25 }, (_, n) => store.send({ from: 'claude', to: 'codex', text: `${n}` }).id);
  const second = reopen();
  assert.deepEqual(second.read('codex', { limit: 100 }).map(m => m.id), ids);
  assert.equal(second.read('codex').length, 20); assert.equal(second.read('codex').length, 20);
  assert.equal(second.ack('claude', ids[0]), false); assert.equal(second.ack('codex', ids[0]), true);
  assert.equal(store.get(ids[0]).status, 'acked');
});
test('forged replies, self sends, unknown replies and runaway reply chains fail', t => {
  const { store } = fixture(t);
  let item = store.send({ from: 'claude', to: 'codex', text: 'start' });
  assert.throws(() => store.send({ from: 'outsider', to: 'claude', text: 'forged', replyTo: item.id }));
  assert.throws(() => store.send({ from: 'claude', to: 'claude', text: 'self' }));
  assert.throws(() => store.send({ from: 'codex', to: 'claude', text: 'bad', replyTo: 'unknown' }));
  for (let i = 0; i < 8; i++) item = store.send({ from: item.to, to: item.from, text: 'reply', replyTo: item.id });
  assert.throws(() => store.send({ from: item.to, to: item.from, text: 'again', replyTo: item.id }), /8-hop/);
});
test('runner reply and ack is atomic and safe to retry after a crash', t => {
  const { store } = fixture(t); const original = store.send({ from: 'claude', to: 'codex', text: 'question' });
  assert.throws(() => store.replyAndAck('codex', original.id, '')); assert.equal(store.get(original.id).status, 'pending');
  const first = store.replyAndAck('codex', original.id, 'answer'); const again = store.replyAndAck('codex', original.id, 'answer');
  assert.equal(first.id, again.id); assert.equal(store.read('claude').length, 1); assert.equal(store.get(original.id).status, 'acked');
});
test('Discord gates guild, channel, author, bots, webhooks, own echoes and deduplicates replays', t => {
  const { store } = fixture(t); const cfg = config();
  const receive = message => processDiscordMessage({ config: cfg, store, message, ownId: bot });
  for (const msg of [incoming({ guild_id: '999999999999999999' }), incoming({ channel_id: '999999999999999999' }),
    incoming({ author: { id: '999999999999999999' } }), incoming({ author: { id: human, bot: true } }),
    incoming({ author: { id: bot, bot: true } }), incoming({ webhook_id: '999999999999999999' })]) assert.equal(receive(msg).accepted, false);
  const first = receive(incoming()); assert.equal(first.accepted, true); assert.equal(receive(incoming()).id, first.id);
  const [item] = store.read('claude'); assert.equal(item.from, `discord:${channel}`); assert.equal(item.source.authorId, human); assert.equal(item.source.senderIsBot, false);
  cfg.discord.allowedBotIds.push('999999999999999999');
  receive(incoming({ id: '666666666666666666', author: { id: '999999999999999999', bot: true } }));
  assert.equal(store.read('claude')[1].source.senderIsBot, true);
});
test('outbound posts suppress mentions, preserve reply identity and cannot use unrelated channels', async t => {
  const { store } = fixture(t); const cfg = config(); const incomingResult = processDiscordMessage({ config: cfg, store, message: incoming(), ownId: bot });
  const reply = store.send({ from: 'claude', to: `discord:${channel}`, text: '@everyone hello', replyTo: incomingResult.id });
  let request;
  await drainOutbox({ config: cfg, store, token: 'test-only', fetchImpl: async (url, opts) => { request = JSON.parse(opts.body); return Response.json({ id: '777777777777777777' }); } });
  assert.deepEqual(request.allowed_mentions, { parse: [], replied_user: false }); assert.equal(request.message_reference.message_id, incoming().id);
  assert.equal(request.enforce_nonce, true); assert.equal(store.get(reply.id).status, 'sent');
  const invalid = store.send({ from: 'codex', to: `discord:${channel}`, text: 'wrong agent' });
  await drainOutbox({ config: cfg, store, token: 'test-only', fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(store.get(invalid.id).status, 'failed');
});
test('outbound 429 retries later, network uncertainty is held and a crash never causes automatic resend', async t => {
  const { store } = fixture(t); const cfg = config();
  const send = () => store.send({ from: 'claude', to: `discord:${channel}`, text: 'hello' });
  const first = send();
  await drainOutbox({ config: cfg, store, token: 'test-only', fetchImpl: async () => Response.json({ retry_after: 20 }, { status: 429 }) });
  assert.equal(store.get(first.id).status, 'pending'); assert.equal(store.claimOutgoing(), null);
  const second = send();
  assert.equal(await drainOutbox({ config: cfg, store, token: 'test-only', fetchImpl: async () => { throw new Error('must respect global pause'); } }), false);
  store.setMeta('discord-send-pause-until', 0);
  await drainOutbox({ config: cfg, store, token: 'test-only', fetchImpl: async () => { throw new Error('network secret-not-to-be-printed'); } });
  assert.equal(store.get(second.id).status, 'uncertain');
  const third = send(); assert.equal(store.claimOutgoing().id, third.id); store.recoverOutbox();
  assert.equal(store.get(third.id).status, 'uncertain'); assert.equal(store.deliveryIssues().length, 2);
});
test('daemon leases exclude second process until expiry and preserve current owner', t => {
  const { reopen, store } = fixture(t); const second = reopen();
  assert.equal(store.acquireLease('discord', 'first', 100, 1000), true);
  assert.equal(second.acquireLease('discord', 'second', 100, 1050), false);
  second.releaseLease('discord', 'second'); assert.equal(second.acquireLease('discord', 'second', 100, 1051), false);
  assert.equal(second.acquireLease('discord', 'second', 100, 1101), true);
});
test('Gateway URLs cannot send bot credentials to a foreign host', () => {
  assert.equal(validateGatewayUrl('wss://gateway.discord.gg'), 'wss://gateway.discord.gg/?v=10&encoding=json');
  for (const value of ['ws://gateway.discord.gg', 'wss://gateway.discord.gg.evil.example', 'wss://evil.example', 'wss://name:password@gateway.discord.gg']) assert.throws(() => validateGatewayUrl(value));
});
test('Gateway does not commit sequence before durable inbound processing and heartbeat supports resume', async t => {
  const { store } = fixture(t); const controller = new AbortController();
  class Socket extends EventTarget { sent = []; send(value) { this.sent.push(JSON.parse(value)); } close() {} message(packet) { const event = new Event('message'); event.data = JSON.stringify(packet); this.dispatchEvent(event); } }
  let socket; let unblock; const barrier = new Promise(resolve => { unblock = resolve; });
  const gateway = new DiscordGateway({ token: 'test-only', store, socketFactory: () => (socket = new Socket()), onMessage: async () => barrier });
  const running = gateway.connection('wss://gateway.discord.gg', controller.signal);
  socket.message({ op: 10, d: { heartbeat_interval: 45000 } });
  socket.message({ op: 0, t: 'READY', s: 1, d: { session_id: 'example', resume_gateway_url: 'wss://gateway.discord.gg' } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(store.getMeta('gateway').seq, 1);
  socket.message({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: incoming() });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(store.getMeta('gateway').seq, 1);
  unblock(); await new Promise(resolve => setImmediate(resolve)); assert.equal(store.getMeta('gateway').seq, 2);
  controller.abort(); await running;
  const secondController = new AbortController(); const again = gateway.connection('wss://gateway.discord.gg', secondController.signal);
  socket.message({ op: 10, d: { heartbeat_interval: 45000 } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.sent[0].op, 6); assert.equal(socket.sent[0].d.seq, 2); secondController.abort(); await again;
});
test('slow backfill cannot block Gateway heartbeat acknowledgements', async t => {
  const { store } = fixture(t); const controller = new AbortController();
  class Socket extends EventTarget {
    sent = []; closed = false;
    send(value) { const packet = JSON.parse(value); this.sent.push(packet); if (packet.op === 1) queueMicrotask(() => this.message({ op: 11 })); }
    close() { this.closed = true; }
    message(packet) { const event = new Event('message'); event.data = JSON.stringify(packet); this.dispatchEvent(event); }
  }
  let socket; let unblock; const barrier = new Promise(resolve => { unblock = resolve; });
  const gateway = new DiscordGateway({ token: 'test-only', store, socketFactory: () => (socket = new Socket()), onMessage: async () => {}, onReady: async () => barrier, random: () => 0 });
  const running = gateway.connection('wss://gateway.discord.gg', controller.signal);
  socket.message({ op: 10, d: { heartbeat_interval: 1000 } });
  socket.message({ op: 0, t: 'READY', s: 1, d: { session_id: 'example', resume_gateway_url: 'wss://gateway.discord.gg' } });
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(socket.closed, false); assert.ok(socket.sent.filter(p => p.op === 1).length >= 2);
  unblock(); controller.abort(); await running;
});
test('daemon validates channel ownership, catches up a persisted cursor and shuts down cleanly', async t => {
  const { home, store } = fixture(t); saveConfig(home, config()); writePrivateJson(join(home, 'secrets.json'), { discordToken: 'test-only' });
  store.setMeta(`cursor:${channel}`, '500000000000000000'); const controller = new AbortController(); const requests = [];
  class Socket extends EventTarget {
    send() {} close() {}
    message(packet) { const event = new Event('message'); event.data = JSON.stringify(packet); this.dispatchEvent(event); }
  }
  await startDiscord({ home, signal: controller.signal, onStatus: status => { if (status === 'Discord message queued.') controller.abort(); },
    fetchImpl: async url => {
      const path = new URL(url).pathname; requests.push(url);
      if (path.endsWith('/users/@me')) return Response.json({ id: bot });
      if (path.endsWith('/gateway/bot')) return Response.json({ url: 'wss://gateway.discord.gg', shards: 1 });
      if (path.endsWith(`/channels/${channel}`)) return Response.json({ guild_id: guild, type: 0 });
      if (path.endsWith('/messages')) return Response.json([incoming()]);
      throw new Error('Unexpected mock request');
    },
    socketFactory: () => { const socket = new Socket(); queueMicrotask(() => {
      socket.message({ op: 10, d: { heartbeat_interval: 45000 } });
      socket.message({ op: 0, t: 'READY', s: 1, d: { session_id: 'example', resume_gateway_url: 'wss://gateway.discord.gg' } });
    }); return socket; }
  });
  assert.equal(store.read('claude').length, 1); assert.ok(requests.some(url => url.includes('after=500000000000000000')));
  assert.equal(store.getMeta(`cursor:${channel}`), incoming().id);
  assert.equal(store.acquireLease('discord-daemon', 'test-successor'), true);
});
