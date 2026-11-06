#!/usr/bin/env node
// Inspect only the release source tree, never runtime homes or message stores.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const excluded = new Set(['node_modules', '.git']);
const roots = new Set(['src', 'scripts', 'docs', 'demo', 'test', '.github', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.gitignore', '.gitattributes', 'package.json', 'package-lock.json', 'Start-ConnectDuet.cmd', 'Start-ConnectDuet.command', 'start-connectduet.sh']);
const reviewedMedia = new Set(['docs/assets/connectduet-overview.png', 'docs/assets/connectduet-overview.gif', 'docs/assets/connectduet-overview.mp4']);
const forbidden = /(?:^|\/)(?:\.env(?:\..*)?|secrets\.json|config\.local\.json|state|backups?|\.connectduet)(?:\/|$)|\.(?:db|sqlite|log|png|jpg|gif|mp4|zip|tgz)(?:-|$)/i;
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
    if (entry.isSymbolicLink()) { failures.push(`${name}: symlinks not allowed in release`); continue; }
    if (reviewedMedia.has(name) && entry.isFile()) {
      const bytes = await readFile(path);
      const valid = name.endsWith('.png') ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : name.endsWith('.gif') ? /^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))
        : bytes.subarray(4,8).toString('ascii') === 'ftyp';
      if (!valid || bytes.length > 12 * 1024 * 1024) failures.push(`${name}: unexpected reviewed-media format/size`);
      checked++; continue;
    }
    if (forbidden.test(name)) { failures.push(`${name}: private/runtime artifact`); continue; }
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
