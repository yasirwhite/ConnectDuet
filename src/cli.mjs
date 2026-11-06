#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homeDir, loadConfig, saveConfig, AGENT_ID } from './config.mjs';
import { formatCommand, registrationArgs, resolveClientCommand } from './client-command.mjs';

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(import.meta.url);
const BOOLEAN_OPTIONS = new Set(['help', 'version', 'local', 'force', 'channel', 'install', 'network', 'session', 'stdin']);
const VALUE_OPTIONS = new Set(['home', 'agent', 'from', 'to', 'text', 'id', 'client', 'label', 'limit', 'reply-to', 'cwd', 'scope', 'connection', 'key', 'text-file']);
export const HELP = `ConnectDuet — orchestrate and message your AI sessions

Native router mode (requires a compatible local router and private connection):
  connectduet router-peers --connection FILE
  connectduet router-send --connection FILE --to ID --text TEXT [--key KEY] [--reply-to MESSAGE_ID]
  connectduet router-reply --connection FILE --id MESSAGE_ID --text TEXT [--key KEY]
                                          Or use --text-file FILE / --stdin for exact UTF-8
  connectduet router-inbox --connection FILE [--limit N]
  connectduet router-ack --connection FILE --id MESSAGE_ID
  connectduet router-status --connection FILE --id MESSAGE_ID
  connectduet router-mcp --connection FILE
  connectduet router-connect --connection FILE --client claude|codex [--session|--install]
                                          Claude --session: private launch configuration
                                          Claude registration: --scope local|project|user

Standalone local mailbox mode:

  connectduet demo                         Try it locally, no accounts required
  connectduet launch                       Open the interactive setup menu
  connectduet setup [--local] [--force]     Guided setup; --local skips Discord
  connectduet doctor [--network]           Check local setup (optional Discord checks)
  connectduet connect --client claude|codex --agent ID [--channel] [--install]
                                          Print registration; --install applies it
                                          Claude: --scope local|project|user (local default)
                                          Claude: --session creates a private launch config
  connectduet start                        Run the Discord bridge in this terminal
  connectduet mcp --agent ID [--channel]    MCP stdio server (usually client-launched)
  connectduet send --from ID --to ID --text TEXT [--reply-to MESSAGE_ID]
  connectduet inbox --agent ID [--limit N]
  connectduet ack --agent ID --id MESSAGE_ID
  connectduet reply --agent ID --id MESSAGE_ID --text TEXT
  connectduet agent add --id ID [--label NAME]
  connectduet codex-run --agent ID --cwd DIRECTORY
                                          Experimental managed, read-only Codex worker

All commands accept --home DIRECTORY (default: CONNECTDUET_HOME or ~/.connectduet).
Claude --channel enables preview push; ordinary MCP inboxes are read by tool calls.
Run separate sessions with distinct mailbox IDs. Messages are untrusted content.
`;

export function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '-h') { options.help = true; continue; }
    if (!item.startsWith('--')) { positional.push(item); continue; }
    const separator = item.indexOf('=');
    const key = item.slice(2, separator < 0 ? undefined : separator);
    if (key in options) throw new Error(`Option --${key} was supplied more than once.`);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (separator >= 0) throw new Error(`--${key} does not take a value.`);
      options[key] = true;
    } else if (VALUE_OPTIONS.has(key)) {
      const value = separator >= 0 ? item.slice(separator + 1) : argv[++index];
      if (value === undefined || (separator < 0 && value.startsWith('--'))) throw new Error(`--${key} needs a value. Use --${key}=VALUE if it starts with --.`);
      options[key] = value;
    } else throw new Error(`Unknown option --${key}. See --help.`);
  }
  return { command: positional.shift() ?? 'help', positional, options };
}

function required(options, key) {
  if (!options[key]?.trim()) throw new Error(`--${key} is required.`);
  return options[key];
}

function configuredAgent(config, id) {
  if (!config.agents.some(agent => agent.id === id)) throw new Error(`Unknown mailbox "${id}". Run agent add --id ${AGENT_ID.test(id) ? id : 'name'} first.`);
  return id;
}

function checkOptions(command, options, allowed) {
  for (const key of Object.keys(options)) if (!['home', 'help', 'version', ...allowed].includes(key)) throw new Error(`--${key} is not an option for ${command}.`);
}

async function withSignal(operation) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try { return await operation(controller.signal); }
  finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}

export async function main(argv = process.argv.slice(2), { write = console.log, error = console.error, input = process.stdin } = {}) {
  try {
    const { command, positional, options } = parseArgs(argv);
    if (options.version) { write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version); return 0; }
    if (options.help || command === 'help') { write(HELP); return 0; }
    if (positional.length && !(command === 'agent' && positional.length === 1 && positional[0] === 'add')) throw new Error('Unexpected positional arguments. See --help.');
    const home = options.home ? resolve(options.home) : homeDir();
    if (command === 'router-mcp') {
      checkOptions(command, options, ['connection']);
      const { runRouterMcp } = await import('./router-mcp.mjs');
      await runRouterMcp({ connectionFile: required(options, 'connection') });
    } else if (command === 'router-connect') {
      checkOptions(command, options, ['connection', 'client', 'session', 'install', 'scope']);
      if (options.session && options.install) throw new Error('--session cannot be combined with --install.');
      const { prepareRouterConnect } = await import('./router-connect.mjs');
      const registration = await prepareRouterConnect({ connectionFile: required(options, 'connection'), client: required(options, 'client'),
        session: Boolean(options.session), scope: options.scope, home, cliPath });
      write(formatCommand(registration.command, registration.args));
      if (options.session) {
        write(`Private session configuration: ${registration.path}`);
        write('Run the printed command in your project. Only this router MCP entry is loaded; Claude was not launched.');
      } else if (options.install) {
        const client = resolveClientCommand(registration.command);
        try {
          const result = await execFileAsync(client.command, [...client.prefix, ...registration.args], { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 });
          if (result.stdout.trim()) write(result.stdout.trim());
          if (result.stderr.trim()) error(result.stderr.trim());
        } catch { throw new Error('Router MCP registration failed. Run the printed command to inspect client setup; no credential was printed.'); }
        write(`Registered ${registration.serverName}. Restart or reload the client.`);
      } else write('Run the printed command, or add --install to apply this registration.');
      write('The router determines native delivery. This adapter does not create native desktop connectors.');
    } else if (['router-peers', 'router-send', 'router-reply', 'router-inbox', 'router-ack', 'router-status'].includes(command)) {
      const allowed = { 'router-peers': [], 'router-send': ['to', 'text', 'text-file', 'stdin', 'key', 'reply-to'], 'router-reply': ['id', 'text', 'text-file', 'stdin', 'key'],
        'router-inbox': ['limit'], 'router-ack': ['id'], 'router-status': ['id'] };
      checkOptions(command, options, ['connection', ...allowed[command]]);
      const { routerClientFromFile } = await import('./router-connection.mjs');
      const { client } = routerClientFromFile(required(options, 'connection'));
      let result;
      if (command === 'router-peers') result = await client.peers();
      else if (command === 'router-inbox') result = await client.inbox({ limit: Number(options.limit ?? 20) });
      else if (command === 'router-ack') result = await client.ack({ messageId: required(options, 'id') });
      else if (command === 'router-status') result = await client.status({ messageId: required(options, 'id') });
      else {
        const { readRouterText } = await import('./router-text.mjs');
        const text = await readRouterText(options, { input });
        const idempotencyKey = options.key === undefined ? randomUUID() : required(options, 'key');
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new Error('--key needs 8–128 letters, digits, underscores, or hyphens.');
        error(`Idempotency key: ${idempotencyKey}. Keep this key for an identical retry if the result is uncertain.`);
        result = command === 'router-send'
          ? await client.send({ to: required(options, 'to'), text, idempotencyKey, replyTo: options['reply-to'] })
          : await client.reply({ messageId: required(options, 'id'), text, idempotencyKey });
        result = { idempotencyKey, ...result };
      }
      write(JSON.stringify(result, null, 2));
    } else if (command === 'launch') {
      checkOptions(command, options, []);
      const { launch } = await import('./launcher.mjs'); await launch({ home, write });
    } else if (command === 'setup') {
      checkOptions(command, options, ['local', 'force']);
      const { runSetup } = await import('./setup.mjs');
      await runSetup({ home, local: Boolean(options.local), force: Boolean(options.force), write });
    } else if (command === 'demo') {
      checkOptions(command, options, []);
      const { runDemo } = await import('./demo.mjs'); runDemo({ write });
    } else if (command === 'doctor') {
      checkOptions(command, options, ['network']);
      const { runDoctor } = await import('./doctor.mjs'); return (await runDoctor({ home, network: Boolean(options.network), write })).ok ? 0 : 1;
    } else if (command === 'connect') {
      checkOptions(command, options, ['client', 'agent', 'channel', 'install', 'scope', 'session']);
      const config = loadConfig(home);
      const agentId = configuredAgent(config, required(options, 'agent'));
      const client = required(options, 'client');
      if (options.session) {
        if (client !== 'claude') throw new Error('--session is only available for Claude Code.');
        if (options.install || options.scope) throw new Error('--session cannot be combined with --install or --scope.');
        const { writeClaudeSessionConfig } = await import('./session-config.mjs');
        const session = writeClaudeSessionConfig({ home, agentId, cliPath, channel: Boolean(options.channel) });
        write(formatCommand(session.command, session.args));
        write(`Private session configuration: ${session.path}`);
        write('Run this command from your project directory. Only this mailbox MCP server is loaded; Claude was not launched.');
        if (options.channel) write('Claude Channels are a research preview; the command explicitly opts into this development channel.');
        return 0;
      }
      const registration = registrationArgs({ client, agentId, home, cliPath, channel: Boolean(options.channel), scope: options.scope });
      write(formatCommand(client, registration.args));
      if (options.install) {
        const resolved = resolveClientCommand(client);
        let result;
        try {
          result = await execFileAsync(resolved.command, [...resolved.prefix, ...registration.args], { windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 });
        } catch (cause) {
          if (client === 'claude' && /already exists/i.test(`${cause.message}\n${cause.stderr ?? ''}`)) {
            throw new Error(`Server ${registration.serverName} already exists. To replace this exact entry (for example, to enable Channels), run ${formatCommand('claude', ['mcp', 'remove', '--scope', options.scope ?? 'local', registration.serverName])}, then rerun connect. No configuration was removed automatically.`);
          }
          throw cause;
        }
        if (result.stdout.trim()) write(result.stdout.trim());
        if (result.stderr.trim()) error(result.stderr.trim());
        write(`Registered ${registration.serverName}. Restart or reload your client to connect it.`);
      } else write('Run this command, or add --install to register it automatically.');
      if (client === 'claude') write(`Claude scope: ${options.scope ?? 'local'}. Local scope applies to the project directory where you run this command.`);
      if (options.channel) {
        write('Claude Channels are a research preview; custom development channels require explicit opt-in.');
        write(formatCommand('claude', ['--dangerously-load-development-channels', `server:${registration.serverName}`]));
      }
      write(`In the session: "Use connectduet_peers, then check connectduet_inbox. Acknowledge messages after handling them."`);
    } else if (command === 'agent') {
      checkOptions(command, options, ['id', 'label']);
      if (positional[0] !== 'add') throw new Error('Use agent add --id NAME.');
      const config = loadConfig(home), id = required(options, 'id');
      if (!AGENT_ID.test(id)) throw new Error('Mailbox IDs use lowercase letters, digits, _ or - (max 48).');
      if (config.agents.some(agent => agent.id === id)) throw new Error(`Mailbox ${id} already exists.`);
      config.agents.push({ id, label: options.label ?? id }); saveConfig(home, config); write(`Added mailbox ${id}.`);
    } else if (command === 'mcp') {
      checkOptions(command, options, ['agent', 'channel']);
      const agentId = configuredAgent(loadConfig(home), required(options, 'agent'));
      const { runMcp } = await import('./mcp.mjs'); await runMcp({ home, agentId, channel: Boolean(options.channel) });
    } else if (command === 'start') {
      checkOptions(command, options, []);
      const { startDiscord } = await import('./discord.mjs'); await withSignal(signal => startDiscord({ home, signal, onStatus: error }));
    } else if (command === 'codex-run') {
      checkOptions(command, options, ['agent', 'cwd']);
      const agentId = configuredAgent(loadConfig(home), required(options, 'agent'));
      const cwd = resolve(required(options, 'cwd'));
      const { runCodex } = await import('./codex-runner.mjs');
      await withSignal(signal => runCodex({ home, agentId, cwd, signal, onStatus: error }));
    } else if (['send', 'inbox', 'ack', 'reply'].includes(command)) {
      const allowed = { send: ['from', 'to', 'text', 'reply-to'], inbox: ['agent', 'limit'], ack: ['agent', 'id'], reply: ['agent', 'id', 'text'] };
      checkOptions(command, options, allowed[command]);
      const config = loadConfig(home);
      const { Store } = await import('./store.mjs');
      const store = new Store(home);
      try {
        if (command === 'send') {
          const from = configuredAgent(config, required(options, 'from')), to = required(options, 'to');
          if (to.startsWith('discord:')) {
            if (!config.discord?.channelRoutes.some(route => `discord:${route.channelId}` === to && route.agentId === from)) throw new Error('This mailbox has no route to that Discord channel.');
          } else configuredAgent(config, to);
          write(JSON.stringify(store.send({ from, to, text: required(options, 'text'), replyTo: options['reply-to'], source: { kind: 'local' } }), null, 2));
        } else {
          const agentId = configuredAgent(config, required(options, 'agent'));
          if (command === 'inbox') {
            const limit = Number(options.limit ?? 20);
            if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be between 1 and 100.');
            write(JSON.stringify(store.read(agentId, { limit }), null, 2));
          } else if (command === 'ack') {
            if (!store.ack(agentId, required(options, 'id'))) throw new Error('Message not found in this mailbox or already acknowledged.');
            write('Acknowledged.');
          } else {
            const message = store.get(required(options, 'id'));
            if (!message || message.to !== agentId) throw new Error('Message does not belong to this mailbox.');
            const to = message.source.kind === 'discord' ? `discord:${message.source.channelId}` : message.from;
            if (to.startsWith('discord:')) {
              if (!config.discord?.channelRoutes.some(route => `discord:${route.channelId}` === to && route.agentId === agentId)) throw new Error('The original Discord route is no longer configured.');
            } else configuredAgent(config, to);
            write(JSON.stringify(store.send({ from: agentId, to, text: required(options, 'text'), replyTo: message.id, source: { kind: 'local' } }), null, 2));
          }
        }
      } finally { store.close(); }
    } else throw new Error(`Unknown command "${command}". See --help.`);
    return 0;
  } catch (cause) {
    error(`ConnectDuet: ${cause.message}`);
    return 1;
  }
}

let isEntrypoint = false;
try { isEntrypoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(cliPath); } catch { /* Imported module. */ }
if (isEntrypoint) process.exitCode = await main();
