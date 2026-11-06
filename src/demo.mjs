import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveConfig } from './config.mjs';
import { Store } from './store.mjs';

export function runDemo({ write = console.log } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'connectduet-demo-'));
  let store;
  try {
    saveConfig(home, { version: 1, agents: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }] });
    store = new Store(home);
    const sent = store.send({ from: 'claude', to: 'codex', text: 'Can you review the API change?', source: { kind: 'local' } });
    const inbox = store.read('codex');
    if (inbox.length !== 1 || inbox[0].id !== sent.id) throw new Error('Demo inbox verification failed.');
    write('Claude → Codex: Can you review the API change?');
    store.ack('codex', sent.id);
    const reply = store.send({ from: 'codex', to: 'claude', text: 'Reviewed. The API change is ready.', replyTo: sent.id, source: { kind: 'local' } });
    store.close();
    store = new Store(home);
    const recovered = store.read('claude');
    if (recovered.length !== 1 || recovered[0].id !== reply.id) throw new Error('Demo persistence verification failed.');
    store.ack('claude', reply.id);
    if (store.read('claude').length || store.read('codex').length) throw new Error('Demo acknowledgment verification failed.');
    write('Codex → Claude: Reviewed. The API change is ready.');
    write('Passed: durable delivery, reply threading, restart recovery, and acknowledgments.');
    write('This is a local simulation. No AI model or Discord account was contacted.');
    return { passed: true, messages: 2 };
  } finally {
    store?.close();
    // Only remove the directory created by mkdtemp above, never a user path.
    rmSync(home, { recursive: true, force: true });
  }
}
