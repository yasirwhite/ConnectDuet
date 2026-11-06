import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { main, parseArgs } from '../src/cli.mjs';
import { runSetup, askSecret, inviteUrl } from '../src/setup.mjs';
import { runDoctor } from '../src/doctor.mjs';
import { registrationArgs, formatCommand, resolveClientCommand } from '../src/client-command.mjs';
import { loadConfig, saveConfig, writePrivateJson } from '../src/config.mjs';
import { Store } from '../src/store.mjs';

function temporary(t) {
  const home = mkdtempSync(join(tmpdir(), 'connectduet-cli-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}
function capture() { const lines = []; return { lines, write: line => lines.push(String(line)), error: line => lines.push(String(line)) }; }
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('real CLI bootstraps a private home and exchanges durable messages across processes', t => {
  const home = join(temporary(t), 'directory with spaces');
  const run = args => spawnSync(process.execPath, [cli, ...args, '--home', home], { encoding: 'utf8', timeout: 20000 });
  let result = run(['setup', '--local']);
  assert.equal(result.status, 0, result.stderr);
  result = run(['send', '--from', 'claude', '--to', 'codex', '--text', 'Please review `literal` $(text)']);
  assert.equal(result.status, 0, result.stderr);
  const sent = JSON.parse(result.stdout);
  result = run(['inbox', '--agent', 'codex']);
  assert.equal(JSON.parse(result.stdout)[0].text, 'Please review `literal` $(text)');
  result = run(['reply', '--agent', 'codex', '--id', sent.id, '--text', 'Reviewed']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).replyTo, sent.id);
  result = run(['ack', '--agent', 'codex', '--id', sent.id]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(run(['inbox', '--agent', 'codex']).stdout), []);
  assert.equal(JSON.parse(run(['inbox', '--agent', 'claude']).stdout)[0].text, 'Reviewed');
});

test('CLI runs through an npm-style POSIX executable symlink', { skip: process.platform === 'win32' }, t => {
  const link = join(temporary(t), 'connectduet');
  symlinkSync(cli, link);
  const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /durable messages/);
});

test('setup refuses to overwrite an existing configuration without force', async t => {
  const home = temporary(t), out = capture();
  await runSetup({ home, local: true, write: out.write });
  const before = readFileSync(join(home, 'config.json'), 'utf8');
  await assert.rejects(runSetup({ home, local: true, write: out.write }), /already exists/);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), before);
});

test('guided setup discovers Discord choices, preserves custom peer names, and keeps token out of public config/output', async t => {
  const home = temporary(t), out = capture();
  const answers = ['planner,reviewer', 'yes', '', '1', '33333333333333333', '1', '2'];
  const token = 'synthetic-test-credential-do-not-display';
  const data = {
    '/users/@me': { id: '11111111111111111', bot: true },
    '/users/@me/guilds': [{ id: '22222222222222222', name: 'Example server' }],
    '/guilds/22222222222222222/channels': [{ id: '44444444444444444', name: 'review', type: 0 }],
  };
  const config = await runSetup({ home, interactive: true, env: {}, write: out.write,
    ask: async () => { assert.ok(answers.length, 'unexpected prompt'); return answers.shift(); },
    secret: async () => token,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, `Bot ${token}`);
      const value = data[url.replace('https://discord.com/api/v10', '')]; assert.ok(value);
      return { ok: true, json: async () => value };
    },
  });
  assert.deepEqual(config.agents.map(agent => agent.id), ['planner', 'reviewer']);
  assert.equal(config.discord.channelRoutes[0].agentId, 'reviewer');
  assert.deepEqual(config.discord.allowedBotIds, []);
  assert.equal(JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8')).discordToken, token);
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8').includes(token), false);
  assert.equal(out.lines.join('\n').includes(token), false);
  assert.match(out.lines.join('\n'), /planner/);
  assert.match(out.lines.join('\n'), /reviewer/);
});

test('failed Discord credential verification creates no configuration', async t => {
  const home = temporary(t);
  const answers = ['', 'yes'];
  await assert.rejects(runSetup({ home, interactive: true, env: {}, write: () => {}, ask: async () => answers.shift(), secret: async () => 'bad-token',
    fetchImpl: async () => ({ ok: false, status: 401 }),
  }), /HTTP 401/);
  assert.equal(existsSync(join(home, 'config.json')), false);
  assert.equal(existsSync(join(home, 'secrets.json')), false);
});

test('secret prompt masks input and restores raw-mode state', async () => {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = raw => { input.isRaw = raw; };
  const output = new PassThrough(); let rendered = ''; output.on('data', value => { rendered += value.toString(); });
  const pending = askSecret('Token: ', { input, output });
  input.emit('keypress', 'private-value', {});
  input.emit('keypress', '\r', { name: 'return' });
  assert.equal(await pending, 'private-value');
  assert.equal(rendered.includes('private-value'), false);
  assert.match(rendered, /\*+/);
  assert.equal(input.isRaw, false);
  input.destroy(); output.destroy();
});

test('doctor reports missing setup and does not reveal credentials in successful checks', async t => {
  const home = temporary(t), out = capture();
  assert.equal((await runDoctor({ home, write: out.write })).ok, false);
  saveConfig(home, { version: 1, agents: [{ id: 'claude' }], discord: {
    guildId: '11111111111111111', channelRoutes: [{ channelId: '22222222222222222', agentId: 'claude' }], allowedUserIds: ['33333333333333333'], allowedBotIds: [],
  } });
  const token = 'synthetic-sensitive-credential';
  writePrivateJson(join(home, 'secrets.json'), { discordToken: token });
  const result = await runDoctor({ home, write: out.write });
  assert.equal(result.ok, true);
  assert.equal(out.lines.join('\n').includes(token), false);
  assert.match(out.lines.join('\n'), /network checks skipped/);
});

test('registration treats unusual paths as arguments, and rejects unsupported client/channel combinations', () => {
  const home = "C:\\Users\\A User\\it's private";
  const { args, serverName } = registrationArgs({ client: 'claude', agentId: 'reviewer', home, cliPath: 'C:\\Some Folder\\cli.mjs', channel: true });
  assert.equal(serverName, 'connectduet-reviewer');
  assert.equal(args[args.indexOf('--home') + 1], home);
  assert.equal(args.at(-1), '--channel');
  assert.equal(args[args.indexOf('--scope') + 1], 'local');
  assert.match(formatCommand('claude', args, 'win32'), /it''s private/);
  assert.throws(() => registrationArgs({ client: 'codex', agentId: 'codex', home, cliPath: cli, channel: true }), /only available for Claude/);
  assert.throws(() => registrationArgs({ client: 'codex', agentId: 'codex', home, cliPath: cli, scope: 'user' }), /only available for Claude/);
  const project = registrationArgs({ client: 'claude', agentId: 'reviewer', home, cliPath: cli, scope: 'project' });
  assert.equal(project.args[project.args.indexOf('--scope') + 1], 'project');
  assert.throws(() => resolveClientCommand('arbitrary-command'), /must be claude or codex/);
  assert.throws(() => formatCommand('claude', ['line\nbreak']), /line breaks/);
});

test('doctor reads failed and in-flight delivery metadata without displaying message bodies or changing state', async t => {
  const home = temporary(t), out = capture();
  await runSetup({ home, local: true, write: () => {} });
  const store = new Store(home);
  const secretBody = 'PRIVATE_MESSAGE_BODY_MUST_NOT_APPEAR';
  const outbound = store.send({ from: 'claude', to: 'discord:11111111111111111', text: secretBody });
  store.claimOutgoing();
  store.finishOutgoing(outbound.id, { status: 'uncertain', error: 'Connection ended during send.' });
  const inbound = store.send({ from: 'claude', to: 'codex', text: secretBody });
  store.setMeta('codex-runner:codex', { inFlight: { messageId: inbound.id } });
  store.close();
  const result = await runDoctor({ home, write: out.write });
  assert.equal(result.ok, false);
  assert.equal(result.attention, 2);
  assert.match(out.lines.join('\n'), new RegExp(outbound.id));
  assert.match(out.lines.join('\n'), new RegExp(inbound.id));
  assert.equal(out.lines.join('\n').includes(secretBody), false);
  const reopened = new Store(home);
  try {
    assert.equal(reopened.get(outbound.id).status, 'uncertain');
    assert.equal(reopened.get(inbound.id).status, 'pending');
  } finally { reopened.close(); }
});

test('client installation runs a resolved entrypoint with literal arguments and no shell', async t => {
  const home = temporary(t), fakeBin = temporary(t), out = capture();
  await runSetup({ home, local: true, write: () => {} });
  const fakeCode = 'console.log(JSON.stringify(process.argv.slice(2)));';
  if (process.platform === 'win32') {
    writeFileSync(join(fakeBin, 'mock-client.cjs'), fakeCode);
    writeFileSync(join(fakeBin, 'claude.cmd'), '@echo off\r\nnode "%dp0%\\mock-client.cjs" %*\r\n');
  } else writeFileSync(join(fakeBin, 'claude'), `#!${process.execPath}\n${fakeCode}`, { mode: 0o755 });
  const original = process.env.PATH;
  process.env.PATH = fakeBin;
  try {
    const result = await main(['connect', '--client', 'claude', '--agent', 'claude', '--install', '--home', home], out);
    assert.equal(result, 0, out.lines.join('\n'));
    const clientArgs = JSON.parse(out.lines.find(line => line.startsWith('[')));
    assert.equal(clientArgs[clientArgs.indexOf('--home') + 1], home);
    assert.ok(clientArgs.includes(cli));
    assert.match(out.lines.join('\n'), /Registered connectduet-claude/);
  } finally { if (original === undefined) delete process.env.PATH; else process.env.PATH = original; }
});

test('Claude session shortcut writes an isolated config and preserves exact custom home', async t => {
  const home = join(temporary(t), 'state with spaces'), out = capture();
  await runSetup({ home, local: true, write: () => {} });
  assert.equal(await main(['connect', '--client', 'claude', '--agent', 'claude', '--session', '--channel', '--home', home], out), 0);
  const config = JSON.parse(readFileSync(join(home, 'clients', 'claude-claude.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.mcpServers), ['connectduet-claude']);
  const args = config.mcpServers['connectduet-claude'].args;
  assert.equal(args[args.indexOf('--home') + 1], home);
  assert.match(out.lines.join('\n'), /strict-mcp-config/);
  assert.match(out.lines.join('\n'), /was not launched/);
  assert.equal(await main(['connect', '--client', 'claude', '--agent', 'claude', '--session', '--install', '--home', home], out), 1);
  assert.equal(await main(['connect', '--client', 'codex', '--agent', 'codex', '--session', '--home', home], out), 1);
});

test('CLI rejects unknown options and cross-mailbox reply attempts', async t => {
  assert.throws(() => parseArgs(['send', '--oops']), /Unknown option/);
  assert.throws(() => parseArgs(['send', '--text']), /needs a value/);
  assert.equal(parseArgs(['send', '--text=--literal']).options.text, '--literal');
  const home = temporary(t), out = capture();
  assert.equal(await main(['setup', '--local', '--home', home], out), 0);
  assert.equal(await main(['agent', 'add', '--id', 'third', '--home', home], out), 0);
  const result = capture();
  assert.equal(await main(['send', '--from', 'claude', '--to', 'codex', '--text', 'hello', '--home', home], result), 0);
  const message = JSON.parse(result.lines[0]);
  assert.equal(await main(['reply', '--agent', 'third', '--id', message.id, '--text', 'forged', '--home', home], out), 1);
  assert.match(out.lines.at(-1), /does not belong/);
  assert.equal(await main(['send', '--from', 'claude', '--to', 'discord:11111111111111111', '--text', 'no route', '--home', home], out), 1);
});

test('invite URL requests only required bot permissions', () => {
  const url = new URL(inviteUrl('11111111111111111'));
  assert.equal(url.searchParams.get('permissions'), '68608');
  assert.equal(url.searchParams.get('scope'), 'bot');
});
