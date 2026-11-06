import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { startChannelPump } from '../src/mcp.mjs';

const guildId = '100000000000000001';
const channelId = '100000000000000002';
const otherChannelId = '100000000000000003';
const authorId = '100000000000000004';
const config = { version: 1, agents: [{ id: 'claude' }, { id: 'codex' }], discord: { guildId,
  channelRoutes: [{ channelId, agentId: 'claude' }, { channelId: otherChannelId, agentId: 'codex' }],
  allowedUserIds: [authorId], allowedBotIds: [],
} };
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'connectduet-mcp-test-'));
  saveConfig(home, config);
  const store = new Store(home);
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }); });
  return { home, store };
}
async function connect(home, agentId, channel = false, onNotification) {
  const moduleUrl = new URL('../src/mcp.mjs', import.meta.url).href;
  const script = `import { runMcp } from ${JSON.stringify(moduleUrl)}; await runMcp(${JSON.stringify({ home, agentId, channel })});`;
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--input-type=module', '-e', script], stderr: 'ignore' });
  const client = new Client({ name: 'connectduet-test', version: '0.1.0' });
  if (onNotification) client.fallbackNotificationHandler = async notification => onNotification(notification);
  await client.connect(transport);
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

test('real stdio MCP exchanges durable messages across two processes with bound identity', { timeout: 20000 }, async t => {
  const { home, store } = fixture(t);
  const claude = await connect(home, 'claude');
  const codex = await connect(home, 'codex');
  try {
    assert.equal((await claude.listTools()).tools.length, 5);
    assert.equal(claude.getServerCapabilities().experimental, undefined);
    const peers = await call(claude, 'connectduet_peers');
    assert.deepEqual(peers.peers.map(peer => peer.id), ['codex', `discord:${channelId}`]);
    const sent = await call(claude, 'connectduet_send', { to: 'codex', text: 'Review the synthetic demo.' });
    assert.equal(sent.queued, true);
    assert.equal(sent.message.from, 'claude');
    const inbox = await call(codex, 'connectduet_inbox');
    assert.equal(inbox.messages[0].id, sent.message.id);
    assert.equal((await call(codex, 'connectduet_inbox')).messages.length, 1, 'reads are non-destructive');
    const response = await call(codex, 'connectduet_reply', { id: sent.message.id, text: 'Reviewed synthetic content.' });
    assert.equal(response.message.to, 'claude');
    assert.equal(response.message.hops, 1);
    assert.equal(response.message.replyTo, sent.message.id);
    assert.equal(store.get(sent.message.id).status, 'pending', 'reply is not acknowledgement');
    assert.equal((await call(codex, 'connectduet_ack', { id: sent.message.id })).acknowledged, true);
    assert.equal((await call(codex, 'connectduet_inbox')).messages.length, 0);
    assert.equal((await call(codex, 'connectduet_ack', { id: sent.message.id })).acknowledged, false);
    for (const [name, args] of [
      ['connectduet_send', { from: 'codex', to: 'codex', text: 'spoof' }],
      ['connectduet_peers', { constructor: 'unexpected property' }],
      ['connectduet_send', { to: 'unknown', text: 'unknown recipient' }],
      ['connectduet_send', { to: 'claude', text: 'self echo' }],
      ['connectduet_send', { to: `discord:${otherChannelId}`, text: 'wrong channel' }],
      ['connectduet_ack', { id: sent.message.id }],
      ['connectduet_reply', { id: sent.message.id, text: 'foreign inbox' }],
      ['connectduet_send', { to: 'codex', text: 'wrong reply owner', replyTo: sent.message.id }],
      ['connectduet_inbox', { limit: 101 }],
      ['connectduet_send', { to: 'codex', text: '  ' }],
      ['connectduet_send', { to: `discord:${channelId}`, text: 'x'.repeat(1801) }],
    ]) {
      const result = await claude.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `${name} should reject ${JSON.stringify(args).slice(0, 100)}`);
    }
  } finally { await claude.close(); await codex.close(); }
});

test('Discord replies preserve sender attribution and are queued only to the bound route', { timeout: 15000 }, async t => {
  const { home, store } = fixture(t);
  const original = store.send({ from: `discord:${channelId}`, to: 'claude', text: 'A synthetic relay message.',
    source: { kind: 'discord', channelId, guildId, messageId: '100000000000000005', authorId, authorName: 'Example bot', senderIsBot: true } });
  let deliver;
  const notification = new Promise(resolve => { deliver = resolve; });
  const client = await connect(home, 'claude', true, deliver);
  try {
    assert.deepEqual(client.getServerCapabilities().experimental, { 'claude/channel': {} });
    let timer;
    const pushed = await Promise.race([notification, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Channel notification timed out')), 5000); })]).finally(() => clearTimeout(timer));
    assert.equal(pushed.method, 'notifications/claude/channel');
    assert.equal(pushed.params.meta.message_id, original.id);
    assert.equal(JSON.parse(pushed.params.content).source.senderIsBot, true);
    const inbox = await call(client, 'connectduet_inbox');
    assert.equal(inbox.messages[0].source.senderIsBot, true);
    assert.equal(inbox.messages[0].source.authorId, authorId);
    const result = await call(client, 'connectduet_reply', { id: original.id, text: 'An explicitly requested reply.' });
    assert.equal(result.message.to, `discord:${channelId}`);
    assert.equal(result.message.status, 'pending');
    assert.equal(result.message.replyTo, original.id);
  } finally { await client.close(); }
});

test('channel pump deduplicates writes, keeps messages pending, and retries only a bounded number', async t => {
  const { store } = fixture(t);
  const first = store.send({ from: 'codex', to: 'claude', text: 'First message' });
  const notifications = [];
  const pump = startChannelPump({ store, agentId: 'claude', intervalMs: 60000,
    server: { notification: async message => notifications.push(message) } });
  t.after(() => pump.stop());
  await pump.tick(); await pump.tick();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].method, 'notifications/claude/channel');
  assert.equal(notifications[0].params.meta.message_id, first.id);
  assert.equal(JSON.parse(notifications[0].params.content).from, 'codex');
  assert.equal(store.get(first.id).status, 'pending');
  store.ack('claude', first.id);
  await pump.tick();
  assert.equal(notifications.length, 1);
  pump.stop();

  store.send({ from: 'codex', to: 'claude', text: 'Failed transport message' });
  let attempts = 0;
  const errors = [];
  const failing = startChannelPump({ store, agentId: 'claude', intervalMs: 60000, onError: message => errors.push(message),
    server: { notification: async () => { attempts++; throw new Error('Synthetic write failure'); } } });
  t.after(() => failing.stop());
  for (let count = 0; count < 6; count++) await failing.tick();
  assert.equal(attempts, 3);
  assert.equal(errors.length, 3);
  assert.equal(store.read('claude').length, 1);
});

test('channel server exits cleanly when its client closes stdin', { timeout: 10000 }, async t => {
  const { home } = fixture(t);
  const moduleUrl = new URL('../src/mcp.mjs', import.meta.url).href;
  const script = `import { runMcp } from ${JSON.stringify(moduleUrl)}; await runMcp(${JSON.stringify({ home, agentId: 'claude', channel: true })});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let data = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MCP initialize timed out')), 5000);
    child.stdout.on('data', chunk => {
      data += chunk.toString();
      if (data.includes('"id":1')) { clearTimeout(timeout); resolve(); }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.end();
  assert.deepEqual(await exit, { code: 0, signal: null });
});
