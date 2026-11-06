import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodex, disabledIntegrations } from '../src/codex-runner.mjs';
import { saveConfig } from '../src/config.mjs';
import { Store } from '../src/store.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'connectduet-runner-'));
  saveConfig(home, { version: 1, agents: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }] });
  const store = new Store(home); t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }); });
  const message = store.send({ from: 'claude', to: 'codex', text: 'Please compare these approaches.' });
  return { home, store, message };
}

function mockCodex({ fail = false, disconnect = false, hang = false, early = false, approval = false, answer = 'Use the smaller interface.' } = {}) {
  const calls = []; let child;
  const spawnImpl = (command, args, options) => {
    assert.equal(options.shell, false); assert.deepEqual(args, ['app-server']);
    child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => { child.emit('exit', 0); return true; };
    const emit = data => child.stdout.write(JSON.stringify(data) + '\n');
    child.stdin = new Writable({ write(chunk, encoding, callback) {
      const message = JSON.parse(String(chunk)); calls.push(message);
      queueMicrotask(() => {
        if (!message.method) return;
        const respond = result => emit({ id: message.id, result });
        if (message.method === 'initialize') respond({});
        else if (message.method === 'config/read') respond({ config: { mcp_servers: { mail: { enabled: true }, 'odd.name': { enabled: true } }, apps: { _default: { enabled: true }, browser: { enabled: true } } } });
        else if (['thread/start', 'thread/resume'].includes(message.method)) respond({ thread: { id: 'owned-thread' } });
        else if (message.method === 'turn/start') {
          const finish = () => {
            if (approval) emit({ id: 900, method: 'item/commandExecution/requestApproval', params: {} });
            emit({ method: 'item/completed', params: { threadId: 'other-thread', turnId: 'turn-1', item: { id: 'bad', type: 'agentMessage', text: 'Wrong thread' } } });
            emit({ method: 'item/completed', params: { threadId: 'owned-thread', turnId: 'turn-1', item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: answer } } });
            emit({ method: 'turn/completed', params: { threadId: 'owned-thread', turn: { id: 'turn-1', status: fail ? 'failed' : 'completed' } } });
          };
          if (early && !hang && !disconnect) finish();
          respond({ turn: { id: 'turn-1' } });
          if (disconnect) child.emit('exit', 1);
          else if (!hang && !early) finish();
        }
      });
      callback();
    } });
    return child;
  };
  return { calls, spawnImpl, resolveCommand: () => ({ command: 'synthetic-codex', prefix: [] }) };
}

test('managed runner uses private stdio, disables integrations, replies and acknowledges only after completion', async t => {
  const f = fixture(t); const fake = mockCodex({ approval: true }); const statuses = [];
  const result = await runCodex({ ...f, ...fake, agentId: 'codex', cwd: f.home, maxMessages: 1, onStatus: text => statuses.push(text) });
  assert.equal(result.processed, 1);
  assert.equal(f.store.get(f.message.id).status, 'acked');
  const reply = f.store.read('claude')[0];
  assert.equal(reply.text, 'Use the smaller interface.'); assert.equal(reply.replyTo, f.message.id); assert.equal(reply.hops, 1);
  const thread = fake.calls.find(call => call.method === 'thread/start').params;
  assert.equal(thread.sandbox, 'read-only'); assert.equal(thread.approvalPolicy, 'on-request');
  assert.equal(thread.config['mcp_servers."mail".enabled'], false);
  assert.equal(thread.config['mcp_servers."odd.name".enabled'], false);
  assert.equal(thread.config['apps."browser".enabled'], false);
  assert.deepEqual(fake.calls.find(call => call.id === 900).result, { decision: 'decline' });
  assert(!statuses.join('').includes(f.message.text));
  assert(!existsSync(join(f.home, 'codex-runner-codex.lock')));
});

test('completion received before turn/start response is retained', async t => {
  const f = fixture(t);
  await runCodex({ ...f, ...mockCodex({ early: true }), agentId: 'codex', cwd: f.home, maxMessages: 1, onStatus() {} });
  assert.equal(f.store.get(f.message.id).status, 'acked');
});

for (const scenario of [{ fail: true }, { disconnect: true }, { hang: true }]) {
  test(`failed/uncertain delivery stays pending and cannot auto-replay: ${Object.keys(scenario)[0]}`, async t => {
    const f = fixture(t);
    await assert.rejects(runCodex({ ...f, ...mockCodex(scenario), agentId: 'codex', cwd: f.home, maxMessages: 1, turnTimeoutMs: 30, requestTimeoutMs: 50, onStatus() {} }));
    assert.equal(f.store.get(f.message.id).status, 'pending'); assert.equal(f.store.read('claude').length, 0);
    const fake = mockCodex();
    await assert.rejects(runCodex({ ...f, ...fake, agentId: 'codex', cwd: f.home, maxMessages: 1, onStatus() {} }), /uncertain message/);
    assert.equal(fake.calls.length, 0);
  });
}

test('manual acknowledge clears uncertain hold; runner resumes only its owned thread', async t => {
  const f = fixture(t);
  await assert.rejects(runCodex({ ...f, ...mockCodex({ disconnect: true }), agentId: 'codex', cwd: f.home, maxMessages: 1, onStatus() {} }));
  f.store.ack('codex', f.message.id);
  f.store.send({ from: 'claude', to: 'codex', text: 'New deliberate request' });
  const fake = mockCodex();
  await runCodex({ ...f, ...fake, agentId: 'codex', cwd: f.home, maxMessages: 1, onStatus() {} });
  assert.equal(fake.calls.find(call => call.method === 'thread/resume').params.threadId, 'owned-thread');
});

test('existing runner lock prevents a second process and is not removed by contender', async t => {
  const f = fixture(t); const lock = join(f.home, 'codex-runner-codex.lock'); writeFileSync(lock, ''); const fake = mockCodex();
  await assert.rejects(runCodex({ ...f, ...fake, agentId: 'codex', cwd: f.home }), /Runner lock exists/);
  assert.equal(fake.calls.length, 0); assert(existsSync(lock));
});

test('missing effective configuration refuses to proceed', () => {
  assert.throws(() => disabledIntegrations(null), /Cannot inspect/);
});
