import { isAbsolute, join, resolve } from 'node:path';
import { AGENT_ID, ensurePrivateHome, loadConfig, writePrivateJson } from './config.mjs';

/** Generate a single-session Claude MCP config without touching client-wide settings. */
export function writeClaudeSessionConfig({ home, agentId, cliPath, channel = false }) {
  if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) throw new Error('Session config requires a valid mailbox ID.');
  if (typeof home !== 'string' || !home.trim()) throw new Error('Session config requires a ConnectDuet home.');
  if (typeof cliPath !== 'string' || !isAbsolute(cliPath)) throw new Error('Session config requires an absolute CLI path.');
  const privateHome = resolve(home);
  const config = loadConfig(privateHome);
  if (!config.agents.some(agent => agent.id === agentId)) throw new Error('Mailbox is not configured. Add it before creating a session config.');
  const serverName = `connectduet-${agentId}`;
  const directory = join(privateHome, 'clients');
  ensurePrivateHome(directory);
  const path = join(directory, `claude-${agentId}.json`);
  const server = {
    type: 'stdio', command: process.execPath,
    args: [resolve(cliPath), 'mcp', '--agent', agentId, '--home', privateHome, ...(channel ? ['--channel'] : [])],
  };
  writePrivateJson(path, { mcpServers: { [serverName]: server } });
  return { path, serverName, command: 'claude', args: ['--mcp-config', path, '--strict-mcp-config',
    ...(channel ? ['--dangerously-load-development-channels', `server:${serverName}`] : [])] };
}
