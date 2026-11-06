import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { AGENT_ID, DISCORD_ID, ensurePrivateHome, saveConfig, validateConfig, writePrivateJson } from './config.mjs';
import { formatCommand } from './client-command.mjs';

export const DEFAULT_AGENTS = [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }];

export function askLine(prompt, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    const reader = createInterface({ input, output, terminal: Boolean(input.isTTY) });
    let settled = false;
    reader.once('SIGINT', () => { settled = true; reader.close(); reject(new Error('Setup canceled.')); });
    reader.once('close', () => { if (!settled) reject(new Error('Input ended before setup completed.')); });
    reader.question(prompt, answer => { settled = true; reader.close(); resolve(answer.trim()); });
  });
}

export function askSecret(prompt, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('Secret entry needs an interactive terminal. Set CONNECTDUET_DISCORD_TOKEN instead.');
  return new Promise((resolve, reject) => {
    let secret = '';
    const wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);
    const finish = (error) => {
      input.off('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) reject(error); else resolve(secret);
    };
    const onKey = (character, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new Error('Setup canceled.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { if (secret.length) { secret = secret.slice(0, -1); output.write('\b \b'); } return; }
      if (key.ctrl || key.meta) return;
      const text = (character ?? '').replace(/[^\x21-\x7e]/g, '');
      if (secret.length + text.length > 512) return;
      secret += text;
      output.write('*'.repeat(text.length));
    };
    output.write(prompt);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
  });
}

export async function discordGet(path, token, fetchImpl = fetch) {
  const response = await fetchImpl(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Discord check failed (HTTP ${response.status}). Check the bot token, invite, and permissions.`);
  return response.json();
}

export function inviteUrl(applicationId) {
  if (!DISCORD_ID.test(applicationId)) throw new Error('Discord application ID is invalid.');
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&permissions=68608&scope=bot`;
}

async function choose(items, prompt, ask, write, label) {
  if (!items.length) throw new Error('No available choices. Check the bot invite and permissions, then rerun setup.');
  items.forEach((item, index) => write(`  ${index + 1}. ${label(item)}`));
  for (;;) {
    const value = await ask(prompt);
    const index = Number(value || '1') - 1;
    if (Number.isInteger(index) && items[index]) return items[index];
    write(`Choose a number from 1 to ${items.length}.`);
  }
}

export async function runSetup({ home, local = false, force = false, ask = askLine, secret = askSecret,
  write = console.log, fetchImpl = fetch, env = process.env, interactive = Boolean(process.stdin.isTTY) } = {}) {
  if (existsSync(join(home, 'config.json')) && !force) {
    throw new Error('Configuration already exists. It was not changed. Use setup --force to replace it, or agent add to add a mailbox.');
  }
  if (!local && !interactive) throw new Error('Guided setup needs an interactive terminal. Use setup --local for an account-free setup.');
  let agents = DEFAULT_AGENTS.map(agent => ({ ...agent }));
  if (!local) {
    write('ConnectDuet setup — mailboxes stay on this device; Discord is optional.');
    for (;;) {
      const names = await ask('Agent mailbox names, comma-separated [claude,codex]: ');
      const ids = (names || 'claude,codex').split(',').map(value => value.trim());
      if (ids.length && ids.length <= 100 && ids.every(id => AGENT_ID.test(id)) && new Set(ids).size === ids.length) {
        agents = ids.map(id => ({ id, label: id })); break;
      }
      write('Use distinct lowercase names with letters, digits, underscores or hyphens (max 48 characters each).');
    }
  }
  const config = { version: 1, agents };
  let token;
  if (!local && /^(y|yes)$/i.test(await ask('Connect Discord now? [y/N]: '))) {
    write('Create a bot at https://discord.com/developers/applications and enable its Message Content Intent.');
    token = env.CONNECTDUET_DISCORD_TOKEN?.trim() || (await secret('Bot token (hidden; stored only in your private ConnectDuet home): ')).trim();
    if (!token || /\s/.test(token)) throw new Error('A nonempty bot token without whitespace is required.');
    const bot = await discordGet('/users/@me', token, fetchImpl);
    if (!bot.bot || !DISCORD_ID.test(bot.id)) throw new Error('This token does not identify a Discord bot.');
    write(`Invite your bot using: ${inviteUrl(bot.id)}`);
    await ask('After inviting it to your server, press Enter: ');
    const guilds = await discordGet('/users/@me/guilds', token, fetchImpl);
    const guild = await choose(guilds, 'Server number [1]: ', ask, write, item => item.name);
    const channels = (await discordGet(`/guilds/${guild.id}/channels`, token, fetchImpl)).filter(channel => channel.type === 0);
    write('Enable Discord Developer Mode (User Settings → Advanced), then right-click your profile → Copy User ID.');
    let allowedUserIds;
    for (;;) {
      const entered = await ask('Allowed human user IDs, comma-separated: ');
      allowedUserIds = entered.split(',').map(value => value.trim());
      if (allowedUserIds.length && allowedUserIds.every(id => DISCORD_ID.test(id))) break;
      write('Enter at least one valid Discord user ID. No sender is allowed by default.');
    }
    const channelRoutes = [];
    const available = [...channels];
    do {
      const channel = await choose(available, 'Text channel number [1]: ', ask, write, item => `#${item.name}`);
      const agent = await choose(agents, 'Destination mailbox number [1]: ', ask, write, item => item.id);
      channelRoutes.push({ channelId: channel.id, agentId: agent.id });
      available.splice(available.findIndex(item => item.id === channel.id), 1);
    } while (available.length && /^(y|yes)$/i.test(await ask('Add another channel route? [y/N]: ')));
    config.discord = { guildId: guild.id, channelRoutes, allowedUserIds: [...new Set(allowedUserIds)], allowedBotIds: [] };
    write('Incoming bot messages are disabled. Bot allowlists require an explicit config edit.');
  }
  validateConfig(config);
  ensurePrivateHome(home);
  // Validate everything before writing either file. Environment tokens stay in the environment.
  if (token && !env.CONNECTDUET_DISCORD_TOKEN?.trim()) writePrivateJson(join(home, 'secrets.json'), { discordToken: token });
  saveConfig(home, config);
  write(`Ready: ${agents.map(agent => agent.id).join(', ')} mailboxes. Private configuration: ${home}`);
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  for (const client of ['claude', 'codex']) {
    const agent = agents.find(item => item.id === client) ?? agents[client === 'claude' ? 0 : Math.min(1, agents.length - 1)];
    write(`Next (${client}): ${formatCommand(process.execPath, [cli, 'connect', '--client', client, '--agent', agent.id, '--home', home])}`);
  }
  if (config.discord) write(`Keep this running for Discord: ${formatCommand(process.execPath, [cli, 'start', '--home', home])}`);
  else write('No background router is needed for local MCP messaging.');
  return config;
}
