import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { ensurePrivateHome, writePrivateJson } from './config.mjs';
import { routerClientFromFile } from './router-connection.mjs';

/** Prepare a native-router MCP connection; no local mailbox config is needed. */
export async function prepareRouterConnect({ connectionFile, client, session = false, scope, home, cliPath }) {
  if (!['claude', 'codex'].includes(client)) throw new Error('--client must be claude or codex.');
  if (!isAbsolute(cliPath)) throw new Error('Router registration requires an absolute CLI path.');
  if (session && client !== 'claude') throw new Error('--session is only available for Claude Code.');
  if (session && scope !== undefined) throw new Error('--session cannot be combined with --scope.');
  if (scope !== undefined && (client !== 'claude' || !['local', 'project', 'user'].includes(scope))) throw new Error('--scope accepts local, project, or user for Claude Code only.');
  const loaded = routerClientFromFile(connectionFile);
  const identity = await loaded.client.peers();
  const suffix = createHash('sha256').update(`${loaded.connection.endpoint}\n${identity.agentId}`).digest('hex').slice(0, 10);
  const serverName = `connectduet-router-${identity.agentId.slice(0, 24)}-${suffix}`;
  const serverArgs = [resolve(cliPath), 'router-mcp', '--connection', loaded.path];
  if (session) {
    const directory = join(resolve(home), 'clients');
    ensurePrivateHome(directory);
    const path = join(directory, `${serverName}.json`);
    writePrivateJson(path, { mcpServers: { [serverName]: { type: 'stdio', command: process.execPath, args: serverArgs } } });
    return { command: 'claude', args: ['--mcp-config', path, '--strict-mcp-config'], serverName, path };
  }
  return { command: client, serverName, args: client === 'claude'
    ? ['mcp', 'add', '--transport', 'stdio', '--scope', scope ?? 'local', serverName, '--', process.execPath, ...serverArgs]
    : ['mcp', 'add', serverName, '--', process.execPath, ...serverArgs] };
}
