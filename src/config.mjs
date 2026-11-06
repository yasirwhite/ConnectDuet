import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const DISCORD_ID = /^\d{17,20}$/;
export function homeDir(env = process.env) { return resolve(env.CONNECTDUET_HOME || join(homedir(), '.connectduet')); }
export function ensurePrivateHome(home) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(home, 0o700);
}
export function validateConfig(config) {
  if (!config || config.version !== 1 || !Array.isArray(config.agents) || !config.agents.length || config.agents.length > 100) throw new Error('Configuration needs version: 1 and 1–100 agents.');
  const seen = new Set();
  for (const agent of config.agents) {
    if (!agent || typeof agent.id !== 'string' || !AGENT_ID.test(agent.id) || seen.has(agent.id)) throw new Error('Agent IDs must be unique lowercase names (letters, numbers, _ or -, max 48).');
    if (agent.label !== undefined && (typeof agent.label !== 'string' || agent.label.length > 100)) throw new Error('Agent label must be text of at most 100 characters.');
    seen.add(agent.id);
  }
  if (config.discord !== undefined) {
    const d = config.discord;
    if (!d || typeof d.guildId !== 'string' || !DISCORD_ID.test(d.guildId)) throw new Error('Discord guildId must be a 17–20 digit string.');
    if (!Array.isArray(d.channelRoutes) || !d.channelRoutes.length || d.channelRoutes.length > 100) throw new Error('Discord needs 1–100 channel routes.');
    const channels = new Set();
    for (const route of d.channelRoutes) {
      if (!route || typeof route.channelId !== 'string' || !DISCORD_ID.test(route.channelId) || !seen.has(route.agentId) || channels.has(route.channelId)) throw new Error('Each Discord channel must map once to a configured agent.');
      channels.add(route.channelId);
    }
    for (const field of ['allowedUserIds', 'allowedBotIds']) {
      if (!Array.isArray(d[field]) || d[field].some(id => typeof id !== 'string' || !DISCORD_ID.test(id))) throw new Error(`Discord ${field} must be an array of IDs (empty denies everyone).`);
    }
    if ('token' in d || 'discordToken' in d) throw new Error('Store Discord tokens in secrets.json or CONNECTDUET_DISCORD_TOKEN, never config.json.');
  }
  return config;
}
export function loadConfig(home = homeDir()) {
  try { return validateConfig(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, ''))); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('ConnectDuet is not configured. Run connectduet setup first.'); if (error instanceof SyntaxError) throw new Error('config.json is not valid JSON.'); throw error; }
}
export function writePrivateJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
  if (process.platform !== 'win32') chmodSync(path, 0o600);
}
export function saveConfig(home, config) {
  validateConfig(config); ensurePrivateHome(home); writePrivateJson(join(home, 'config.json'), config); return config;
}
export function loadToken(home = homeDir()) {
  if (process.env.CONNECTDUET_DISCORD_TOKEN?.trim()) return process.env.CONNECTDUET_DISCORD_TOKEN.trim();
  try {
    const secrets = JSON.parse(readFileSync(join(home, 'secrets.json'), 'utf8').replace(/^\uFEFF/, ''));
    return typeof secrets.discordToken === 'string' ? secrets.discordToken.trim() : '';
  } catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('Cannot read secrets.json; check its JSON format and permissions.'); }
}
