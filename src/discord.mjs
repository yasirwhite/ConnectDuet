import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, loadToken, DISCORD_ID } from './config.mjs';
import { Store } from './store.mjs';

const API = 'https://discord.com/api/v10';
const fatalCodes = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const abortableDelay = (ms, signal) => delay(ms, undefined, { signal });
const requestSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);

export async function discordGet(path, token, { fetchImpl = fetch, signal } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Bot ${token}` }, signal: requestSignal(signal) });
    if (response.ok) return response.json();
    if (response.status === 429 && attempt < 3) {
      const body = await response.json();
      await abortableDelay(Math.min(60000, Math.max(1000, Number(body.retry_after) * 1000 || 1000)), signal); continue;
    }
    throw new Error(`Discord GET ${path.split('?')[0]} failed (HTTP ${response.status}). Check bot token, permissions, and network.`);
  }
}

/** Gate before storing any content. Bot attribution never becomes a human instruction. */
export function processDiscordMessage({ config, store, message, ownId }) {
  if (!message || !DISCORD_ID.test(message.id) || message.guild_id !== config.discord.guildId) return { accepted: false, reason: 'guild' };
  const route = config.discord.channelRoutes.find(r => r.channelId === message.channel_id);
  if (!route) return { accepted: false, reason: 'channel' };
  const author = message.author;
  if (!author || author.id === ownId || message.webhook_id) return { accepted: false, reason: 'self_or_webhook' };
  const bot = author.bot === true;
  const allowed = bot ? config.discord.allowedBotIds : config.discord.allowedUserIds;
  if (!allowed.includes(author.id)) return { accepted: false, reason: 'sender' };
  if (typeof message.content !== 'string' || !message.content.trim()) return { accepted: false, reason: 'empty_or_attachment_only' };
  if (message.content.length > 16000) return { accepted: false, reason: 'too_long' };
  const item = store.send({ from: `discord:${route.channelId}`, to: route.agentId, text: message.content,
    source: { kind: 'discord', messageId: message.id, channelId: route.channelId, guildId: message.guild_id,
      authorId: author.id, authorName: String(author.username || '').slice(0, 100), senderIsBot: bot,
      attachments: (message.attachments || []).slice(0, 10).map(a => ({ name: String(a.filename || '').slice(0, 200), url: a.url, size: a.size })) } });
  return { accepted: true, id: item.id };
}

/** One attempt only. An ambiguous POST is held for human review, never retried blindly. */
export async function drainOutbox({ config, store, token, fetchImpl = fetch, signal, onStatus = () => {} }) {
  if ((store.getMeta('discord-send-pause-until') || 0) > Date.now()) return false;
  const item = store.claimOutgoing(); if (!item) return false;
  const channelId = item.to.slice(8);
  const route = config.discord.channelRoutes.find(r => r.channelId === channelId && r.agentId === item.from);
  if (!route) { store.finishOutgoing(item.id, { status: 'failed', error: 'Sender is not mapped to this Discord channel.' }); return true; }
  const content = `[${item.from}] ${item.text}`;
  const body = { content, allowed_mentions: { parse: [], replied_user: false },
    nonce: createHash('sha256').update(item.id).digest('hex').slice(0, 24), enforce_nonce: true };
  const original = item.replyTo && store.get(item.replyTo);
  if (original?.source.kind === 'discord') body.message_reference = { message_id: original.source.messageId, fail_if_not_exists: false };
  try {
    const response = await fetchImpl(`${API}/channels/${channelId}/messages`, { method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal(signal) });
    if (response.ok) {
      const result = await response.json();
      if (!DISCORD_ID.test(result.id)) throw new Error('Missing delivery identity');
      store.finishOutgoing(item.id, { status: 'sent', discordMessageId: result.id }); onStatus('Discord message sent.');
    } else if (response.status === 429) {
      const result = await response.json();
      const retryAt = Date.now() + Math.min(3600000, Math.max(1000, Number(result.retry_after) * 1000 || 1000));
      // Pause all sends conservatively, covering Discord's global as well as route limits.
      store.setMeta('discord-send-pause-until', retryAt);
      store.finishOutgoing(item.id, { status: 'pending', retryAt, error: 'Discord rate limit; waiting.' });
    } else if (response.status >= 500) {
      store.finishOutgoing(item.id, { status: 'uncertain', error: `Discord HTTP ${response.status}; inspect Discord before resending.` });
      onStatus('Discord delivery uncertain; inspect Discord and use doctor before retrying.');
    } else {
      store.finishOutgoing(item.id, { status: 'failed', error: `Discord HTTP ${response.status}; check channel permissions.` });
      onStatus(`Discord send rejected (HTTP ${response.status}).`);
    }
  } catch {
    store.finishOutgoing(item.id, { status: 'uncertain', error: 'Delivery connection interrupted; inspect Discord before resending.' });
    onStatus('Discord delivery uncertain; inspect Discord before resending.');
  }
  return true;
}

export function validateGatewayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'wss:' || !(url.hostname === 'gateway.discord.gg' || url.hostname.endsWith('.discord.gg')) || url.username || url.password || url.port) throw new Error('Discord returned an unexpected Gateway URL.');
  url.search = '?v=10&encoding=json'; return url.href;
}

export class DiscordGateway {
  constructor({ token, store, onMessage, onReady = async () => {}, onStatus = () => {}, socketFactory = url => new WebSocket(url), random = Math.random }) {
    Object.assign(this, { token, store, onMessage, onReady, onStatus, socketFactory, random });
  }
  async run(url, signal) {
    let failures = 0;
    while (!signal.aborted) {
      try { await this.connection(url, signal); failures = 0; }
      catch (error) {
        if (signal.aborted) return;
        if (error.fatal) throw error;
        failures++;
        if (failures > 20) throw new Error('Gateway reconnect budget exhausted. Restart connectduet start after checking the network.');
        this.onStatus(`Discord reconnecting (attempt ${failures}).`);
        await abortableDelay(Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6)) + Math.floor(this.random() * 500), signal);
      }
    }
  }
  connection(defaultUrl, signal) {
    return new Promise((resolve, reject) => {
      const saved = this.store.getMeta('gateway');
      let state = saved || { sessionId: null, resumeUrl: null, seq: null };
      const ws = this.socketFactory(validateGatewayUrl(state.resumeUrl || defaultUrl));
      let heartbeat; let helloTimeout; let heartbeatTimeout; let awaitingAck = false; let ended = false; let queue = Promise.resolve(); let queued = 0;
      const finish = error => {
        if (ended) return; ended = true;
        clearInterval(heartbeat); clearTimeout(helloTimeout); clearTimeout(heartbeatTimeout);
        signal.removeEventListener('abort', abort);
        try { ws.close(); } catch {}
        // Do not close the store while an accepted inbound operation is still running.
        queue.finally(() => error ? reject(error) : resolve()).catch(() => {});
      };
      const abort = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      const send = payload => { if (!ended) ws.send(JSON.stringify(payload)); };
      const beat = () => {
        if (awaitingAck) { finish(new Error('Gateway heartbeat acknowledgement missing.')); return; }
        awaitingAck = true; send({ op: 1, d: state.seq });
      };
      helloTimeout = setTimeout(() => finish(new Error('Gateway hello timed out.')), 20000);
      const handle = async packet => {
        if (ended) return;
        if (packet.op === 10) {
          clearTimeout(helloTimeout);
          const interval = packet.d?.heartbeat_interval;
          if (!Number.isFinite(interval) || interval < 1000) throw new Error('Invalid heartbeat interval.');
          heartbeatTimeout = setTimeout(() => { beat(); heartbeat = setInterval(beat, interval); }, this.random() * interval);
          if (state.sessionId && state.seq !== null) send({ op: 6, d: { token: this.token, session_id: state.sessionId, seq: state.seq } });
          else send({ op: 2, d: { token: this.token, intents: 1 | 512 | 32768,
            properties: { os: process.platform, browser: 'connectduet', device: 'connectduet' } } });
        } else if (packet.op === 11) awaitingAck = false;
        else if (packet.op === 1) { awaitingAck = false; beat(); }
        else if (packet.op === 7) finish(new Error('Gateway requested reconnect.'));
        else if (packet.op === 9) {
          if (!packet.d) { state = { sessionId: null, resumeUrl: null, seq: null }; this.store.setMeta('gateway', state); }
          finish(new Error('Gateway session unavailable.'));
        } else if (packet.op === 0) {
          if (packet.t === 'READY') {
            state.sessionId = packet.d.session_id; state.resumeUrl = validateGatewayUrl(packet.d.resume_gateway_url);
            await this.onReady(packet.d);
            this.onStatus('Discord connected.');
          } else if (packet.t === 'RESUMED') this.onStatus('Discord resumed.');
          else if (packet.t === 'MESSAGE_CREATE') await this.onMessage(packet.d);
          if (packet.s !== null && packet.s !== undefined) state.seq = packet.s;
          this.store.setMeta('gateway', state);
        }
      };
      ws.addEventListener('message', event => {
        // Heartbeats cannot wait behind REST catch-up or disk operations.
        let packet;
        try { packet = JSON.parse(String(event.data)); }
        catch { finish(Object.assign(new Error('Gateway sent invalid JSON.'), { fatal: true })); return; }
        if (packet.op === 11) { awaitingAck = false; return; }
        if (packet.op === 1) { awaitingAck = false; beat(); return; }
        if (++queued > 2000) { finish(Object.assign(new Error('Gateway input queue exceeded its safe limit.'), { fatal: true })); return; }
        queue = queue.then(() => handle(packet)).catch(() => {
          // A persistence failure must stop instead of advancing past a lost message.
          finish(Object.assign(new Error('Gateway processing failed; check configuration, disk space and Discord permissions. The checkpoint was not advanced.'), { fatal: true }));
        }).finally(() => { queued--; });
      });
      ws.addEventListener('error', () => finish(new Error('Gateway connection failed.')));
      ws.addEventListener('close', event => {
        if (ended) return;
        if ([4007, 4009].includes(event.code)) this.store.setMeta('gateway', null);
        finish(Object.assign(new Error(`Gateway disconnected (${event.code}).`), { fatal: fatalCodes.has(event.code) }));
      });
    });
  }
}

/** Foreground daemon. Only this process accesses Discord; MCP peers share durable local mailboxes. */
export async function startDiscord({ home, signal, onStatus = console.error, fetchImpl = fetch, socketFactory }) {
  const config = loadConfig(home);
  if (!config.discord) throw new Error('Discord is not configured. Run connectduet setup and choose Discord.');
  const token = loadToken(home);
  if (!token) throw new Error('Discord token missing. Run setup or set CONNECTDUET_DISCORD_TOKEN.');
  const store = new Store(home); const owner = randomUUID(); const controller = new AbortController();
  const stop = () => controller.abort(); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  let heartbeat; let worker; let failure;
  try {
    if (!store.acquireLease('discord-daemon', owner, 60000)) throw new Error('Another Discord bridge is already running for this ConnectDuet home.');
    store.recoverOutbox();
    heartbeat = setInterval(() => {
      try { if (!store.acquireLease('discord-daemon', owner, 60000)) { failure = new Error('Lost Discord daemon ownership.'); stop(); } }
      catch (error) { failure = error; stop(); }
    }, 4000);
    const bot = await discordGet('/users/@me', token, { fetchImpl, signal: controller.signal });
    if (store.getMeta('bot-id') !== bot.id) { store.setMeta('gateway', null); store.setMeta('bot-id', bot.id); }
    const info = await discordGet('/gateway/bot', token, { fetchImpl, signal: controller.signal });
    if (info.shards > 1) throw new Error('This release supports single-shard Discord bots only. Use a dedicated bot.');
    if (info.session_start_limit?.remaining === 0) throw new Error('Discord session start quota exhausted; wait for its reset.');
    for (const route of config.discord.channelRoutes) {
      const channel = await discordGet(`/channels/${route.channelId}`, token, { fetchImpl, signal: controller.signal });
      if (channel.guild_id !== config.discord.guildId || ![0, 5, 10, 11, 12].includes(channel.type)) throw new Error('A configured channel is not a text channel/thread in the configured Discord server.');
      if (!store.getMeta(`cursor:${route.channelId}`)) store.setMeta(`cursor:${route.channelId}`, String((BigInt(Date.now()) - 1420070400000n) << 22n));
    }
    const consume = message => {
      const result = processDiscordMessage({ config, store, message, ownId: bot.id });
      if (config.discord.channelRoutes.some(r => r.channelId === message.channel_id) && DISCORD_ID.test(message.id)) {
        const key = `cursor:${message.channel_id}`; const previous = store.getMeta(key);
        if (!previous || BigInt(message.id) > BigInt(previous)) store.setMeta(key, message.id);
      }
      if (result.accepted) onStatus('Discord message queued.');
    };
    const catchUp = async () => {
      for (const route of config.discord.channelRoutes) {
        for (let page = 0; page < 20; page++) {
          const cursor = store.getMeta(`cursor:${route.channelId}`);
          const messages = await discordGet(`/channels/${route.channelId}/messages?after=${cursor}&limit=100`, token, { fetchImpl, signal: controller.signal });
          if (!Array.isArray(messages)) throw new Error('Discord catch-up returned an invalid response.');
          messages.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
          for (const message of messages) { consume({ ...message, guild_id: config.discord.guildId }); await new Promise(resolve => setImmediate(resolve)); }
          if (messages.length < 100) break;
          if (page === 19) throw new Error('Discord catch-up exceeded 2000 messages per channel. Catch up again before starting live delivery.');
        }
      }
    };
    worker = (async () => {
      while (!controller.signal.aborted) {
        if (!store.acquireLease('discord-daemon', owner, 60000)) throw new Error('Lost Discord daemon ownership.');
        await drainOutbox({ config, store, token, fetchImpl, signal: controller.signal, onStatus });
        await abortableDelay(500, controller.signal);
      }
    })().catch(error => { if (!controller.signal.aborted) { failure = error; stop(); } });
    const gateway = new DiscordGateway({ token, store, onMessage: consume, onReady: catchUp, onStatus, socketFactory });
    await gateway.run(info.url, controller.signal);
    if (failure) throw failure;
  } catch (error) { if (!signal?.aborted || failure) throw error; }
  finally {
    stop(); clearInterval(heartbeat); await worker; signal?.removeEventListener('abort', stop);
    store.releaseLease('discord-daemon', owner); store.close();
  }
}
