import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadToken } from './config.mjs';
import { discordGet } from './setup.mjs';
import { resolveClientCommand } from './client-command.mjs';

export async function runDoctor({ home, network = false, write = console.log, fetchImpl = fetch } = {}) {
  let failures = 0;
  let attention = 0;
  const check = async (label, operation) => {
    try { const result = await operation(); write(`OK   ${label}${typeof result === 'string' ? `: ${result}` : ''}`); return result; }
    catch (error) { failures++; write(`FAIL ${label}: ${error.message}`); return null; }
  };
  await check('Node.js', () => { if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.'); return process.version; });
  await check('MCP SDK', async () => { await import('@modelcontextprotocol/sdk/server/index.js'); return 'installed'; });
  await check('SQLite', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const directory = mkdtempSync(join(tmpdir(), 'connectduet-doctor-'));
    let database;
    try { database = new DatabaseSync(join(directory, 'check.sqlite')); if (database.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite probe failed.'); }
    finally { database?.close(); rmSync(directory, { recursive: true, force: true }); }
    return 'temporary database read/write available';
  });
  const config = await check('Configuration', () => loadConfig(home));
  if (config) {
    write(`INFO ${config.agents.length} configured mailbox(es).`);
    if (config.discord) {
      let token;
      await check('Discord credentials', () => { token = loadToken(home); if (!token) throw new Error('Set CONNECTDUET_DISCORD_TOKEN or rerun guided setup.'); return 'present (not displayed)'; });
      if (token && network) {
        await check('Discord identity', async () => { const bot = await discordGet('/users/@me', token, fetchImpl); if (!bot.bot) throw new Error('Token does not belong to a bot.'); return 'bot authenticated'; });
        await check('Discord server access', async () => { await discordGet(`/guilds/${config.discord.guildId}`, token, fetchImpl); return 'available'; });
        for (const route of config.discord.channelRoutes) {
          await check(`Discord channel for ${route.agentId}`, async () => { const channel = await discordGet(`/channels/${route.channelId}`, token, fetchImpl); if (channel.guild_id !== config.discord.guildId) throw new Error('Channel belongs to a different server.'); return 'available'; });
        }
      } else if (token) write('INFO Discord network checks skipped; use doctor --network to test credentials and channel access.');
      write('INFO Message Content Intent and actual inbound/outbound delivery still need a live Discord smoke test.');
    } else write('INFO Discord is not configured; local agent messaging is available.');
  }
  const databasePath = join(home, 'messages.sqlite');
  if (existsSync(databasePath)) {
    await check('Delivery state (read-only)', async () => {
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const issues = database.prepare("SELECT id,status,error FROM messages WHERE status IN ('failed','uncertain') ORDER BY created_at DESC").all();
        for (const issue of issues) {
          attention++;
          const reason = String(issue.error ?? 'Delivery requires review.').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240);
          write(`ATTN ${issue.status} message ${issue.id}: ${reason}`);
        }
        const runners = database.prepare("SELECT key,value FROM metadata WHERE key LIKE 'codex-runner:%'").all();
        for (const runner of runners) {
          const state = JSON.parse(runner.value);
          if (state.inFlight?.messageId) {
            const message = database.prepare('SELECT status FROM messages WHERE id=?').get(state.inFlight.messageId);
            if (message?.status === 'acked') continue;
            attention++;
            write(`ATTN ${runner.key}: in-flight message ${state.inFlight.messageId} (running or interrupted). Check the worker before deciding to acknowledge or retry.`);
          }
        }
        return issues.length ? `${issues.length} failed/uncertain Discord delivery item(s); message bodies not displayed` : 'no failed or uncertain Discord delivery';
      } finally { database.close(); }
    });
  } else write('INFO No mailbox database yet; it will be created on first use.');
  for (const client of ['claude', 'codex']) {
    try { resolveClientCommand(client); write(`OK   ${client} CLI: found`); }
    catch { write(`INFO ${client} CLI not found; install it before using connect --install for this client.`); }
  }
  write(failures ? `${failures} required check(s) failed.` : 'Required local checks passed. This does not verify a live AI session.');
  if (attention) write(`${attention} delivery item(s) need attention; no state was changed.`);
  return { ok: failures === 0 && attention === 0, failures, attention };
}
