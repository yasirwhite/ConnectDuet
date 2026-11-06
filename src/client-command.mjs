import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

// Resolve executables without a shell. On Windows, npm's .cmd shims are data:
// only their standard, relative node entrypoint is accepted, never executed.
export function resolveClientCommand(name, { env = process.env, platform = process.platform } = {}) {
  if (!['claude', 'codex'].includes(name)) throw new Error('Client must be claude or codex.');
  const directories = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const suffix of platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
      const candidate = join(directory.replace(/^"|"$/g, ''), name + suffix);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (suffix === '.cmd') {
          const contents = readFileSync(candidate, 'utf8');
          const match = contents.match(/"%dp0%[\\/]([^"\r\n]+\.(?:[cm]?js))"/i);
          if (!match || isAbsolute(match[1])) continue;
          const base = resolve(dirname(candidate));
          const script = resolve(base, match[1]);
          if (!script.toLowerCase().startsWith((base + '\\').toLowerCase()) || !statSync(script).isFile()) continue;
          return { command: process.execPath, prefix: [script] };
        }
        accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return { command: candidate, prefix: [] };
      } catch { /* Try the next PATH entry. */ }
    }
  }
  throw new Error(`${name} CLI was not found as an executable or supported npm shim on PATH. Install it first, or use the printed registration command manually.`);
}

export function quoteArgument(value, platform = process.platform) {
  // PowerShell and POSIX shell single quotes are deliberately different.
  const text = String(value);
  if (/[\r\n\0]/.test(text)) throw new Error('Command arguments cannot contain line breaks or NUL.');
  return platform === 'win32' ? `'${text.replaceAll("'", "''")}'` : `'${text.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(command, args, platform = process.platform) {
  const words = [command, ...args].map(value => quoteArgument(value, platform)).join(' ');
  return platform === 'win32' ? `& ${words}` : words;
}

export function registrationArgs({ client, agentId, home, cliPath, channel = false, scope }) {
  if (!['claude', 'codex'].includes(client)) throw new Error('--client must be claude or codex.');
  if (channel && client !== 'claude') throw new Error('--channel is only available for Claude Code.');
  if (scope !== undefined && client !== 'claude') throw new Error('--scope is only available for Claude Code.');
  if (scope !== undefined && !['local', 'project', 'user'].includes(scope)) throw new Error('--scope must be local, project, or user.');
  const serverName = `connectduet-${agentId}`;
  const server = [process.execPath, cliPath, 'mcp', '--agent', agentId, '--home', home, ...(channel ? ['--channel'] : [])];
  return { serverName, args: client === 'claude'
    ? ['mcp', 'add', '--transport', 'stdio', '--scope', scope ?? 'local', serverName, '--', ...server]
    : ['mcp', 'add', serverName, '--', ...server] };
}
