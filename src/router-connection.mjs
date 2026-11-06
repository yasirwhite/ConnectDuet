import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { PeerClient } from './router-client.mjs';

/** A private connection is an operator-provided capability; never display its token. */
export function loadRouterConnection(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('A private router connection file is required.');
  const path = resolve(file);
  let connection;
  try {
    if (statSync(path).size > 16384) throw new Error('too_large');
    connection = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch { throw new Error('Cannot read router connection JSON. Check the private file and its permissions.'); }
  if (!connection || connection.version !== 1 || typeof connection.endpoint !== 'string' ||
      typeof connection.agentId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(connection.agentId) ||
      typeof connection.token !== 'string' || !/^[a-f0-9]{64}$/i.test(connection.token)) {
    throw new Error('Router connection needs version 1, a loopback endpoint, an agentId, and a 64-character hexadecimal token.');
  }
  // Constructor validates the endpoint, including credentials/redirect boundaries.
  new PeerClient(connection);
  return { path, connection: { version: 1, endpoint: connection.endpoint, agentId: connection.agentId, token: connection.token } };
}

export function routerClientFromFile(file, options = {}) {
  const loaded = loadRouterConnection(file);
  return { ...loaded, client: new PeerClient(loaded.connection, options) };
}
