#!/usr/bin/env node
// Inspect only the release source tree, never runtime homes or message stores.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const excluded = new Set(['node_modules', '.git']);
const roots = new Set(['src', 'scripts', 'docs', 'test', '.github', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.gitignore', '.gitattributes', 'package.json', 'package-lock.json', 'Start-ConnectDuet.cmd', 'Start-ConnectDuet.command', 'start-connectduet.sh']);
const forbidden = /(?:^|\/)(?:\.env(?:\..*)?|secrets\.json|config\.local\.json|state|backups?|\.connectduet)(?:\/|$)|\.(?:db|sqlite|log|png|jpg|zip|tgz)(?:-|$)/i;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bmfa\.[A-Za-z0-9_-]{70,}\b/,
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
  /[A-Z]:[\\/]Users[\\/](?!example\b|<)[^\s"'<>/\\]+/i,
];
let checked = 0;
const failures = [];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (dir === root && excluded.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const name = relative(root, path).replaceAll('\\', '/');
    if (dir === root && !roots.has(entry.name)) { failures.push(`${name}: outside release allowlist`); continue; }
    if (forbidden.test(name)) { failures.push(`${name}: private/runtime artifact`); continue; }
    if (entry.isSymbolicLink()) { failures.push(`${name}: symlinks not allowed in release`); continue; }
    if (entry.isDirectory()) await scan(path);
    else {
      const content = await readFile(path, 'utf8');
      checked++;
      if (patterns.some(pattern => pattern.test(content))) failures.push(`${name}: possible credential or personal path (value suppressed)`);
    }
  }
}
await scan(root);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Release source scan passed (${checked} files). Review the package manifest before publishing.`);
