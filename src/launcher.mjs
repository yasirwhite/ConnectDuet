#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './cli.mjs';
import { askLine } from './setup.mjs';
import { homeDir, loadConfig } from './config.mjs';

export async function launch({ home = homeDir(), ask = askLine, write = console.log } = {}) {
  if (!process.stdin.isTTY) throw new Error('The launcher needs an interactive terminal. Use connectduet demo or setup --local instead.');
  for (;;) {
    write('\nConnectDuet\n  1. Try the account-free demo\n  2. Guided setup\n  3. Check setup\n  4. Connect Claude Code\n  5. Connect Codex\n  6. Run Discord bridge\n  7. Exit');
    const choice = await ask('Choose [1]: ');
    if (choice === '7') return;
    let args;
    if (!choice || choice === '1') args = ['demo'];
    else if (choice === '2') args = ['setup'];
    else if (choice === '3') args = ['doctor'];
    else if (choice === '6') args = ['start'];
    else if (choice === '4' || choice === '5') {
      const client = choice === '4' ? 'claude' : 'codex';
      let config;
      try { config = loadConfig(home); }
      catch (error) { write(error.message); continue; }
      write(`Available mailboxes: ${config.agents.map(agent => agent.id).join(', ')}`);
      const id = await ask(`Mailbox [${client}]: `) || client;
      args = ['connect', '--client', client, '--agent', id];
      if (client === 'claude') args.push('--session');
      else if (/^(y|yes)$/i.test(await ask('Register in the client now? [y/N]: '))) args.push('--install');
      if (client === 'claude' && /^(y|yes)$/i.test(await ask('Enable experimental Claude Channels push? [y/N]: '))) args.push('--channel');
    } else { write('Choose a number from 1 to 7.'); continue; }
    await main([...args, '--home', home], { write, error: write });
  }
}

let isEntrypoint = false;
try { isEntrypoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* Imported module. */ }
if (isEntrypoint) {
  try { await launch(); } catch (error) { console.error(`ConnectDuet: ${error.message}`); process.exitCode = 1; }
}
