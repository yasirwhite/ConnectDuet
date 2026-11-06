const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MESSAGE_ID = /^peer-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const ERROR_CODES = new Set(['unauthorized', 'forbidden', 'invalid_request', 'invalid_json', 'body_too_large', 'peers_disabled', 'peer_api_disabled', 'peer_not_allowed', 'unknown_peer', 'unknown_agent', 'self_send', 'message_not_found', 'not_found', 'not_recipient', 'not_participant', 'invalid_reply', 'idempotency_conflict', 'rate_limited', 'rate_limit', 'inbox_full', 'hop_limit', 'peer_auth_failed', 'peer_forbidden', 'peer_invalid_request', 'peer_not_found', 'peer_rate_limited', 'invalid_text', 'invalid_target', 'invalid_idempotency_key', 'invalid_message_id', 'invalid_limit', 'peer_operation_failed']);

export class PeerClientError extends Error {
  constructor(code, message, { status = null, uncertain = false } = {}) {
    super(message); this.name = 'PeerClientError'; this.code = code; this.status = status; this.uncertain = uncertain;
  }
}

function invalid(message) { throw new PeerClientError('invalid_arguments', message); }
function requireAgent(value) { if (typeof value !== 'string' || !AGENT_ID.test(value)) invalid('Agent ID must be a simple name of 1–64 characters.'); return value; }
function requireMessage(value) { if (typeof value !== 'string' || !MESSAGE_ID.test(value)) invalid('Message ID must be a peer message UUID.'); return value; }
function requireText(value) { if (typeof value !== 'string' || !value.trim() || value.length > 16000) invalid('Text must contain 1–16000 characters.'); return value; }
function requireKey(value) { if (typeof value !== 'string' || !KEY.test(value)) invalid('idempotencyKey must contain 8–128 letters, digits, underscores or hyphens. Reuse it only for an identical retry.'); return value; }

export function validatePeerConnection({ endpoint, token, agentId }) {
  let url;
  try { url = new URL(endpoint); } catch { invalid('Peer endpoint must be an HTTP IPv4 loopback URL.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port || Number(url.port) < 1024 || Number(url.port) > 65535) invalid('Peer endpoint must be http://127.0.0.1:PORT with no path, credentials, query or fragment.');
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) invalid('Peer credential must be a 64-character hexadecimal token.');
  return { endpoint: url.origin, token, agentId: requireAgent(agentId) };
}

function protocolError() { return new PeerClientError('invalid_response', 'The local router returned an invalid Peer API response.'); }
function safeMessage(message, includeText = false) {
  if (!message || !MESSAGE_ID.test(message.id) || !AGENT_ID.test(message.from) || !AGENT_ID.test(message.to) || !['queued', 'dispatching', 'accepted', 'confirmed', 'uncertain', 'failed'].includes(message.status)) throw protocolError();
  if ((message.replyTo !== null && message.replyTo !== undefined && !MESSAGE_ID.test(message.replyTo)) || (message.rootId !== undefined && !MESSAGE_ID.test(message.rootId)) || (message.hops !== undefined && (!Number.isInteger(message.hops) || message.hops < 0 || message.hops > 8))) throw protocolError();
  if ((message.createdAt !== undefined && (typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt)))) || (message.deliveryId !== undefined && (typeof message.deliveryId !== 'string' || message.deliveryId.length > 200)) || (message.acknowledged !== undefined && typeof message.acknowledged !== 'boolean')) throw protocolError();
  const result = {};
  for (const key of ['id', 'from', 'to', 'replyTo', 'rootId', 'hops', 'createdAt', 'deliveryId', 'status', 'acknowledged', 'acknowledgedAt']) {
    if (message[key] !== undefined) result[key] = message[key];
  }
  if (includeText) {
    if (typeof message.text !== 'string' || message.text.length > 16000 || message.source?.kind !== 'agent' || message.source?.agentId !== message.from) throw protocolError();
    result.text = message.text;
    result.source = { kind: 'agent', agentId: message.from, senderIsBot: true };
  }
  return result;
}

/** Token-bound peer API client. No environment loading, filesystem or arbitrary URL access. */
export class PeerClient {
  #token;
  #verification = null;
  constructor(connection, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
    const validated = validatePeerConnection(connection);
    this.endpoint = validated.endpoint; this.agentId = validated.agentId; this.#token = validated.token;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) invalid('timeoutMs must be between 1 and 120000.');
    this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async #request(method, path, body) {
    let response;
    const uncertain = method === 'POST';
    try {
      response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method, redirect: 'error', headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch { throw new PeerClientError('connection_failed', uncertain ? 'Peer request was not confirmed. Retry an identical send/reply with the same idempotencyKey; do not generate a new one.' : 'Cannot reach the local Peer API. Check that the router is running with peer messaging enabled.', { uncertain }); }
    let raw, value;
    try {
      if (Number(response.headers?.get('content-length')) > 2_000_000) throw new Error();
      // Stream with a bound rather than buffering an unbounded response.
      const chunks = []; let length = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.byteLength; if (length > 2_000_000) { await reader.cancel(); throw new Error(); }
            chunks.push(Buffer.from(part.value));
          }
        } finally { reader.releaseLock(); }
        raw = Buffer.concat(chunks).toString('utf8');
      } else { raw = await response.text(); if (Buffer.byteLength(raw) > 2_000_000) throw new Error(); }
      value = JSON.parse(raw);
    } catch { throw new PeerClientError('invalid_response', 'The local router returned an invalid or oversized response.', { status: response.status, uncertain }); }
    if (!response.ok) {
      const code = ERROR_CODES.has(value?.error) ? value.error : 'request_rejected';
      throw new PeerClientError(code, `Peer request rejected (HTTP ${response.status}, ${code}).`, { status: response.status, uncertain: response.status >= 500 && uncertain });
    }
    return value;
  }
  async #verify(refresh = false) {
    if (refresh || !this.#verification) {
      this.#verification = this.#request('GET', '/agents').then(value => {
        if (value?.agentId !== this.agentId) throw new PeerClientError('identity_mismatch', 'Peer credential identity does not match the configured agent. No message was sent.');
        if (!Array.isArray(value.peers) || value.peers.length > 1000) throw protocolError();
        const peers = value.peers.map(peer => {
          if (!peer || !AGENT_ID.test(peer.id) || typeof peer.label !== 'string' || typeof peer.kind !== 'string') throw protocolError();
          return { id: peer.id, label: peer.label.slice(0, 200), kind: peer.kind.slice(0, 100) };
        });
        return { agentId: this.agentId, peers };
      }).catch(error => { this.#verification = null; throw error; });
    }
    return this.#verification;
  }
  async peers() { return this.#verify(true); }
  async send({ to, text, idempotencyKey, replyTo } = {}) {
    requireAgent(to); requireText(text); requireKey(idempotencyKey); if (replyTo !== undefined) requireMessage(replyTo);
    if (to === this.agentId) invalid('Self-messages are not allowed.');
    const verified = await this.#verify();
    if (!verified.peers.some(peer => peer.id === to)) throw new PeerClientError('peer_not_allowed', 'The target is not an allowed peer for this identity.');
    const value = await this.#request('POST', '/agent-messages', { to, text, idempotencyKey, ...(replyTo ? { replyTo } : {}) });
    try {
      if (value.message?.from !== this.agentId || value.message?.to !== to) throw protocolError();
      return { message: safeMessage(value.message) };
    } catch { throw new PeerClientError('invalid_response', 'Peer send response was invalid; delivery may have occurred. Retry only with the same idempotencyKey and payload.', { uncertain: true }); }
  }
  async reply({ messageId, text, idempotencyKey } = {}) {
    requireMessage(messageId); requireText(text); requireKey(idempotencyKey); await this.#verify();
    const value = await this.#request('POST', '/agent-replies', { messageId, text, idempotencyKey });
    try {
      if (value.message?.from !== this.agentId || value.message?.replyTo !== messageId) throw protocolError();
      return { message: safeMessage(value.message) };
    } catch { throw new PeerClientError('invalid_response', 'Peer reply response was invalid; delivery may have occurred. Retry only with the same idempotencyKey and payload.', { uncertain: true }); }
  }
  async inbox({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('Inbox limit must be an integer from 1 to 100.');
    await this.#verify();
    const value = await this.#request('GET', `/agent-inbox?limit=${limit}`);
    if (value?.agentId !== this.agentId || !Array.isArray(value.messages) || value.messages.length > limit) throw protocolError();
    const messages = value.messages.map(message => { if (message.to !== this.agentId) throw protocolError(); return safeMessage(message, true); });
    return { agentId: this.agentId, messages };
  }
  async ack({ messageId } = {}) {
    requireMessage(messageId); await this.#verify();
    const value = await this.#request('POST', '/agent-ack', { messageId });
    if (value?.messageId !== messageId || value.acknowledged !== true) throw protocolError();
    return { messageId, acknowledged: true };
  }
  async status({ messageId } = {}) {
    requireMessage(messageId); await this.#verify();
    const value = await this.#request('GET', `/agent-messages/${messageId}`);
    if (value.message?.id !== messageId || (value.message.from !== this.agentId && value.message.to !== this.agentId)) throw protocolError();
    return { message: safeMessage(value.message) };
  }
}
