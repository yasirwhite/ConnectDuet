import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { saveConfig } from '../src/config.mjs';
import { writeClaudeSessionConfig } from '../src/session-config.mjs';

const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'connectduet-session-test-'));
  // Spaces and shell metacharacters must remain literal JSON argument strings.
  const home = join(root, "home with spaces ' $ &");
  saveConfig(home, { version: 1, agents: [{ id: 'reviewer' }, { id: 'implementer' }] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return home;
}

test('session configs isolate two mailboxes without client-global registration', t => {
  const home = fixture(t);
  for (const agentId of ['reviewer', 'implementer']) {
    const result = writeClaudeSessionConfig({ home, agentId, cliPath });
    const config = JSON.parse(readFileSync(result.path, 'utf8'));
    assert.deepEqual(Object.keys(config), ['mcpServers']);
    assert.deepEqual(Object.keys(config.mcpServers), [`connectduet-${agentId}`]);
    const server = config.mcpServers[result.serverName];
    assert.equal(server.command, process.execPath);
    assert.equal(isAbsolute(server.command), true);
    assert.deepEqual(server.args, [cliPath, 'mcp', '--agent', agentId, '--home', home]);
    assert.equal(result.command, 'claude');
    assert.deepEqual(result.args, ['--mcp-config', result.path, '--strict-mcp-config']);
    assert.equal(server.env, undefined, 'no credentials copied into generated config');
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(result.path)).mode & 0o777, 0o700);
    }
  }
  assert.deepEqual(readdirSync(join(home, 'clients')).sort(), ['claude-implementer.json', 'claude-reviewer.json']);
});

test('channel session config declares both server capability flag and explicit client opt-in', t => {
  const home = fixture(t);
  const result = writeClaudeSessionConfig({ home, agentId: 'reviewer', cliPath, channel: true });
  const config = JSON.parse(readFileSync(result.path, 'utf8'));
  assert.equal(config.mcpServers[result.serverName].args.at(-1), '--channel');
  assert.deepEqual(result.args, ['--mcp-config', result.path, '--strict-mcp-config', '--dangerously-load-development-channels', 'server:connectduet-reviewer']);
  const updated = writeClaudeSessionConfig({ home, agentId: 'reviewer', cliPath });
  assert.equal(updated.path, result.path);
  assert.equal(JSON.parse(readFileSync(result.path, 'utf8')).mcpServers[result.serverName].args.includes('--channel'), false);
});

test('session helper rejects traversal, unknown identities, and relative executable paths', t => {
  const home = fixture(t);
  for (const agentId of ['../../escape', 'unknown', '', 'reviewer/other']) {
    assert.throws(() => writeClaudeSessionConfig({ home, agentId, cliPath }));
  }
  assert.throws(() => writeClaudeSessionConfig({ home, agentId: 'reviewer', cliPath: 'src/cli.mjs' }), /absolute CLI path/);
  assert.deepEqual(readdirSync(home), ['config.json'], 'invalid requests create no client config');
});

test('generated configs launch real CLI MCP servers with separate identities in the same working directory', { timeout: 20000 }, async t => {
  const home = fixture(t);
  const clients = [];
  try {
    for (const agentId of ['reviewer', 'implementer']) {
      const generated = writeClaudeSessionConfig({ home, agentId, cliPath });
      const entry = JSON.parse(readFileSync(generated.path, 'utf8')).mcpServers[generated.serverName];
      const client = new Client({ name: 'session-config-test', version: '1' });
      clients.push(client);
      await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args, stderr: 'ignore' }));
      const response = await client.callTool({ name: 'connectduet_peers', arguments: {} });
      assert.notEqual(response.isError, true);
      assert.equal(JSON.parse(response.content[0].text).agentId, agentId);
    }
    const sent = await clients[1].callTool({ name: 'connectduet_send', arguments: { to: 'reviewer', text: 'Synthetic same-project review request' } });
    assert.notEqual(sent.isError, true);
    const received = await clients[0].callTool({ name: 'connectduet_inbox', arguments: {} });
    const inbox = JSON.parse(received.content[0].text);
    assert.equal(inbox.messages.length, 1);
    assert.equal(inbox.messages[0].from, 'implementer');
    assert.equal(inbox.messages[0].to, 'reviewer');
  } finally { await Promise.all(clients.map(client => client.close())); }
});
