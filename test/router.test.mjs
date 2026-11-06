import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PeerClient } from '../src/router-client.mjs';
import { loadRouterConnection } from '../src/router-connection.mjs';
import { prepareRouterConnect } from '../src/router-connect.mjs';
import { main } from '../src/cli.mjs';
import { readRouterText } from '../src/router-text.mjs';

const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
async function mockRouter(t) {
  const home = mkdtempSync(join(tmpdir(), 'connectduet-router-test-'));
  const tokens = { manager: randomBytes(32).toString('hex'), worker: randomBytes(32).toString('hex') };
  const messages = new Map(); const keys = new Map(); const calls = [];
  const server = createServer(async (req, res) => {
    const agentId = Object.keys(tokens).find(id => req.headers.authorization === `Bearer ${tokens[id]}`);
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (!agentId) return send(401, { error: 'unauthorized', secret: tokens.manager });
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({ agentId, method: req.method, path: url.pathname, body });
    const peer = agentId === 'manager' ? 'worker' : 'manager';
    if (url.pathname === '/agents') return send(200, { agentId, peers: [{ id: peer, label: peer, kind: agentId === 'manager' ? 'codex-app-server' : 'claude-composer' }] });
    if (url.pathname === '/agent-messages' || url.pathname === '/agent-replies') {
      if (req.method !== 'POST' || 'from' in body) return send(400, { error: 'invalid_request' });
      const original = body.messageId || body.replyTo ? messages.get(body.messageId ?? body.replyTo) : null;
      if ((body.messageId || body.replyTo) && (!original || original.to !== agentId)) return send(403, { error: 'not_recipient' });
      const to = body.messageId ? original.from : body.to;
      if (to !== peer) return send(403, { error: 'peer_not_allowed' });
      const key = `${agentId}:${body.idempotencyKey}`;
      if (keys.has(key)) {
        const existing = keys.get(key);
        if (existing.payload !== JSON.stringify(body)) return send(409, { error: 'idempotency_conflict' });
        return send(202, { message: messages.get(existing.id) });
      }
      const id = `peer-${randomUUID()}`;
      const message = { id, from: agentId, to, text: body.text, replyTo: original?.id ?? null, rootId: original?.rootId ?? id,
        hops: original ? original.hops + 1 : 0, createdAt: new Date().toISOString(), deliveryId: `delivery-${randomUUID()}`,
        status: 'queued', acknowledged: false, source: { kind: 'agent', agentId, senderIsBot: true } };
      messages.set(id, message); keys.set(key, { id, payload: JSON.stringify(body) });
      return send(202, { message });
    }
    if (url.pathname === '/agent-inbox') return send(200, { agentId, messages: [...messages.values()].filter(message => message.to === agentId && !message.acknowledged).slice(0, Number(url.searchParams.get('limit') ?? 20)) });
    if (url.pathname === '/agent-ack') {
      const message = messages.get(body.messageId);
      if (!message || message.to !== agentId) return send(403, { error: 'not_recipient' });
      message.acknowledged = true; return send(200, { messageId: message.id, acknowledged: true });
    }
    if (url.pathname.startsWith('/agent-messages/')) {
      const message = messages.get(url.pathname.split('/').at(-1));
      if (!message || ![message.from, message.to].includes(agentId)) return send(404, { error: 'not_found' });
      return send(200, { message });
    }
    send(404, { error: 'not_found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(home, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const connections = {};
  for (const agentId of Object.keys(tokens)) {
    const file = join(home, `${agentId}.json`);
    writeFileSync(file, JSON.stringify({ version: 1, endpoint, token: tokens[agentId], agentId }), { mode: 0o600 });
    connections[agentId] = file;
  }
  return { home, endpoint, tokens, connections, calls, messages };
}

test('native router client preserves exact text, token-bound identity, retries, source, and acknowledgements', async t => {
  const fixture = await mockRouter(t);
  const manager = new PeerClient({ endpoint: fixture.endpoint, token: fixture.tokens.manager, agentId: 'manager' });
  const worker = new PeerClient({ endpoint: fixture.endpoint, token: fixture.tokens.worker, agentId: 'worker' });
  const text = '  Review this exact text.\nDo not rewrite names or add receipt headers.  ';
  const payload = { to: 'worker', text, idempotencyKey: randomUUID() };
  const sent = await manager.send(payload);
  assert.equal((await manager.send(payload)).message.id, sent.message.id);
  await assert.rejects(manager.send({ ...payload, text: 'Changed payload' }), error => error.code === 'idempotency_conflict');
  assert.equal(fixture.messages.size, 1);
  assert.equal(fixture.messages.get(sent.message.id).text, text);
  assert.equal(fixture.calls.filter(call => call.method === 'POST').every(call => !('from' in call.body)), true);
  const inbox = await worker.inbox();
  assert.equal(inbox.messages[0].text, text);
  assert.deepEqual(inbox.messages[0].source, { kind: 'agent', agentId: 'manager', senderIsBot: true });
  assert.equal((await manager.status({ messageId: sent.message.id })).message.acknowledged, false);
  const reply = await worker.reply({ messageId: sent.message.id, text: 'Reviewed.', idempotencyKey: randomUUID() });
  assert.equal(reply.message.to, 'manager');
  assert.equal(reply.message.replyTo, sent.message.id);
  await worker.ack({ messageId: sent.message.id });
  assert.equal((await worker.inbox()).messages.length, 0);
  assert.equal((await manager.status({ messageId: sent.message.id })).message.acknowledged, true);
  await assert.rejects(manager.ack({ messageId: sent.message.id }), error => error.code === 'not_recipient');
  await assert.rejects(manager.send({ ...payload, to: 'unconfigured' }), error => error.code === 'peer_not_allowed');
});

test('connection guards and identity verification reject unsafe or mismatched endpoints before send', async t => {
  const fixture = await mockRouter(t);
  for (const endpoint of ['https://127.0.0.1:9000', 'http://example.com:9000', 'http://localhost:9000', 'http://127.0.0.1:9000/path', 'http://user:secret@127.0.0.1:9000']) {
    assert.throws(() => new PeerClient({ endpoint, token: fixture.tokens.manager, agentId: 'manager' }));
  }
  const client = new PeerClient({ endpoint: fixture.endpoint, token: fixture.tokens.manager, agentId: 'worker' });
  await assert.rejects(client.send({ to: 'manager', text: 'Must not send', idempotencyKey: randomUUID() }), error => error.code === 'identity_mismatch');
  assert.equal(fixture.calls.some(call => call.method === 'POST'), false);
  const malformed = join(fixture.home, 'malformed.json');
  writeFileSync(malformed, `{\"token\":\"${fixture.tokens.manager}\" broken}`);
  assert.throws(() => loadRouterConnection(malformed), error => !error.message.includes(fixture.tokens.manager));
  let requests = 0;
  const rejecting = new PeerClient({ endpoint: fixture.endpoint, token: fixture.tokens.manager, agentId: 'manager' }, {
    fetchImpl: async (_url, options) => { requests++; assert.equal(options.redirect, 'error'); return new Response(JSON.stringify({ error: `secret-${fixture.tokens.manager}` }), { status: 500 }); },
  });
  await assert.rejects(rejecting.peers(), error => error.code === 'request_rejected' && !error.message.includes(fixture.tokens.manager));
  assert.equal(requests, 1, 'no automatic retries');
});

test('real stdio router MCP exposes native peer tools, rejects sender spoofing, and retains exact text', { timeout: 20000 }, async t => {
  const fixture = await mockRouter(t);
  const client = new Client({ name: 'router-mcp-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cliPath, 'router-mcp', '--connection', fixture.connections.manager], stderr: 'ignore' });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['list_agents', 'send_agent_message', 'reply_to_agent', 'read_agent_inbox', 'ack_agent_message', 'agent_message_status']);
    const spoof = await client.callTool({ name: 'send_agent_message', arguments: { from: 'worker', to: 'worker', text: 'spoof', idempotencyKey: randomUUID() } });
    assert.equal(spoof.isError, true);
    assert.equal(fixture.messages.size, 0);
    const text = 'A precise peer task.\nKeep this line.';
    const sent = await client.callTool({ name: 'send_agent_message', arguments: { to: 'worker', text, idempotencyKey: randomUUID() } });
    assert.notEqual(sent.isError, true);
    const message = JSON.parse(sent.content[0].text).message;
    assert.equal(message.from, 'manager');
    assert.equal(fixture.messages.get(message.id).text, text);
    const status = await client.callTool({ name: 'agent_message_status', arguments: { messageId: message.id } });
    assert.equal(JSON.parse(status.content[0].text).message.status, 'queued');
    assert.equal(JSON.stringify(sent).includes(fixture.tokens.manager), false);
  } finally { await client.close(); }
});

test('router CLI and generated Claude/Codex registration need no local mailbox setup or token arguments', async t => {
  const fixture = await mockRouter(t);
  const output = []; const errors = [];
  const io = { write: value => output.push(value), error: value => errors.push(value) };
  assert.equal(await main(['router-peers', '--connection', fixture.connections.manager], io), 0);
  assert.equal(JSON.parse(output.pop()).agentId, 'manager');
  assert.equal(await main(['router-send', '--connection', fixture.connections.manager, '--to', 'worker', '--text', 'CLI peer request'], io), 0);
  const sent = JSON.parse(output.pop());
  assert.match(sent.idempotencyKey, /^[a-f0-9-]{36}$/);
  assert.equal(errors.some(value => value.includes(sent.idempotencyKey)), true);
  const session = await prepareRouterConnect({ connectionFile: fixture.connections.manager, client: 'claude', session: true, home: fixture.home, cliPath });
  const config = JSON.parse(readFileSync(session.path, 'utf8'));
  const entry = config.mcpServers[session.serverName];
  assert.deepEqual(entry.args, [cliPath, 'router-mcp', '--connection', fixture.connections.manager]);
  assert.deepEqual(session.args, ['--mcp-config', session.path, '--strict-mcp-config']);
  assert.equal(readFileSync(session.path, 'utf8').includes(fixture.tokens.manager), false);
  const codex = await prepareRouterConnect({ connectionFile: fixture.connections.worker, client: 'codex', home: fixture.home, cliPath });
  assert.deepEqual(codex.args.slice(0, 3), ['mcp', 'add', codex.serverName]);
  assert.equal(codex.args.includes(fixture.tokens.worker), false);
  await assert.rejects(prepareRouterConnect({ connectionFile: fixture.connections.manager, client: 'codex', session: true, home: fixture.home, cliPath }), /only available for Claude/);
  assert.equal(JSON.stringify({ output, errors }).includes(fixture.tokens.manager), false);
});

test('file and stdin payloads preserve exact UTF-8 multiline text without shell interpolation', async t => {
  const fixture = await mockRouter(t);
  const text = '  First line: $literal & `literal`\r\nSecond line: café 🚀\n  ';
  const path = join(fixture.home, 'message.txt');
  writeFileSync(path, text, 'utf8');
  assert.equal(await readRouterText({ 'text-file': path }), text);
  assert.equal(await readRouterText({ stdin: true }, { input: Readable.from([Buffer.from(text)]) }), text);
  const output = []; const errors = [];
  const base = ['router-send', '--connection', fixture.connections.manager, '--to', 'worker'];
  assert.equal(await main([...base, '--text-file', path], { write: value => output.push(value), error: value => errors.push(value) }), 0);
  assert.equal(await main([...base, '--stdin'], { write: value => output.push(value), error: value => errors.push(value), input: Readable.from([Buffer.from(text)]) }), 0);
  assert.equal([...fixture.messages.values()].every(message => message.text === text), true);
  await assert.rejects(readRouterText({ text: 'x', stdin: true }), /exactly one/);
  await assert.rejects(readRouterText({ stdin: true }, { input: Readable.from([Buffer.from([0xc3, 0x28])]) }), /valid UTF-8/);
  await assert.rejects(readRouterText({ stdin: true }, { input: Readable.from([Buffer.alloc(65537)]) }), /64 KiB/);
  await assert.rejects(readRouterText({ text: ' '.repeat(5) }), /1–16000/);
});
