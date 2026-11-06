#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!process.env.npm_execpath) throw new Error('Run this check with npm run test:install.');
const temp = mkdtempSync(join(tmpdir(), 'connectduet-install-'));
const npm = args => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
});
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', temp]));
  assert(packed.bundled.includes('@modelcontextprotocol/sdk'), 'Release must bundle its runtime SDK.');
  const prefix = join(temp, 'fresh install');
  npm(['install', '--global', '--prefix', prefix, '--cache', join(temp, 'empty-cache'), '--offline',
    '--ignore-scripts', '--no-fund', '--no-audit', join(temp, packed.filename)]);
  const cli = process.platform === 'win32' ? join(prefix, 'node_modules', 'connectduet', 'src', 'cli.mjs')
    : join(prefix, 'lib', 'node_modules', 'connectduet', 'src', 'cli.mjs');
  assert(existsSync(cli), 'Installed entrypoint missing.');
  const home = join(temp, 'private home');
  const run = args => execFileSync(process.execPath, [cli, ...args], {
    cwd: temp, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    env: { ...process.env, CONNECTDUET_HOME: home, CONNECTDUET_DISCORD_TOKEN: '' },
  });
  assert.match(run(['demo']), /Passed:/);
  assert.match(run(['setup', '--local']), /Ready:/);
  assert.match(run(['doctor']), /Required local checks passed/);
  assert.match(run(['connect', '--client', 'claude', '--agent', 'claude', '--session']), /strict-mcp-config/);
  const sent = JSON.parse(run(['send', '--from', 'claude', '--to', 'codex', '--text', 'Fresh-install probe']));
  assert.equal(JSON.parse(run(['inbox', '--agent', 'codex']))[0].id, sent.id);
  assert.match(run(['ack', '--agent', 'codex', '--id', sent.id]), /Acknowledged/);
  console.log(`Offline clean install passed: ${packed.filename}, ${(packed.size / 1024 / 1024).toFixed(2)} MiB; demo, setup, doctor, session config and messaging verified.`);
} finally {
  // Only remove this script's newly created temporary directory.
  if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('connectduet-install-')) throw new Error('Unexpected temporary directory; cleanup refused.');
  rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
}
