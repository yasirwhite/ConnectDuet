import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { AGENT_ID, DISCORD_ID, ensurePrivateHome } from './config.mjs';

const validAddress = value => typeof value === 'string' && (AGENT_ID.test(value) || (value.startsWith('discord:') && DISCORD_ID.test(value.slice(8))));
function decode(row) {
  return row ? { id: row.id, from: row.sender, to: row.recipient, text: row.body, replyTo: row.reply_to, source: JSON.parse(row.source), createdAt: row.created_at, status: row.status, rootId: row.root_id, hops: row.hops, error: row.error || null } : null;
}

/** Same-OS-user mailbox. Access is filesystem based, not an isolation boundary between agents. */
export class Store {
  constructor(home) {
    ensurePrivateHome(home);
    const path = join(home, 'messages.sqlite');
    this.db = new DatabaseSync(path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL,
        reply_to TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
        root_id TEXT NOT NULL, hops INTEGER NOT NULL, external_id TEXT UNIQUE,
        next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, discord_message_id TEXT);
      CREATE INDEX IF NOT EXISTS inbox ON messages(recipient,status,created_at);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS leases (key TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);`);
  }
  transaction(fn) {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.inTransaction = false; }
  }
  send({ from, to, text, replyTo = null, source = { kind: 'local' } }) {
    if (!validAddress(from) || !validAddress(to) || from === to) throw new Error('Invalid address or self-message.');
    if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Message text must contain 1–16000 characters.');
    if (to.startsWith('discord:') && text.length > 1800) throw new Error('Discord messages are limited to 1800 characters; send a shorter message.');
    if (!source || !['local', 'discord'].includes(source.kind)) throw new Error('Invalid message source.');
    if (source.kind === 'discord' && (!DISCORD_ID.test(source.messageId) || !DISCORD_ID.test(source.authorId) || !DISCORD_ID.test(source.channelId) || from !== `discord:${source.channelId}`)) throw new Error('Discord source identity is incomplete.');
    if (source.kind === 'local' && from.startsWith('discord:')) throw new Error('Local senders cannot impersonate Discord.');
    const externalId = source.kind === 'discord' ? `discord:${source.messageId}:${to}` : null;
    return this.transaction(() => {
      if (externalId) {
        const existing = this.db.prepare('SELECT * FROM messages WHERE external_id=?').get(externalId);
        if (existing) return decode(existing);
      }
      const id = randomUUID(); let rootId = id; let hops = 0;
      if (replyTo) {
        const original = this.get(replyTo);
        if (!original || original.to !== from || original.from !== to) throw new Error('Reply must be sent by the original recipient to the original sender.');
        rootId = original.rootId; hops = original.hops + 1;
        if (hops > 8) throw new Error('Reply chain reached the 8-hop limit. Start a new conversation deliberately.');
      }
      const queued = this.db.prepare("SELECT count(*) AS n FROM messages WHERE recipient=? AND status='pending'").get(to).n;
      if (queued >= 1000) throw new Error('Recipient inbox is full (1000 pending messages). Acknowledge messages first.');
      const recent = this.db.prepare('SELECT count(*) AS n FROM messages WHERE sender=? AND created_at>?').get(from, new Date(Date.now() - 60000).toISOString()).n;
      if (source.kind === 'local' && recent >= 60) throw new Error('Sender rate limit reached (60 messages/minute).');
      const createdAt = new Date().toISOString();
      this.db.prepare('INSERT INTO messages(id,sender,recipient,body,reply_to,source,created_at,status,root_id,hops,external_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, from, to, text, replyTo, JSON.stringify(source), createdAt, 'pending', rootId, hops, externalId);
      return this.get(id);
    });
  }
  get(id) { return decode(this.db.prepare('SELECT * FROM messages WHERE id=?').get(id)); }
  read(agentId, { limit = 20 } = {}) {
    if (!validAddress(agentId) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Inbox needs a valid recipient and limit 1–100.');
    return this.db.prepare("SELECT * FROM messages WHERE recipient=? AND status='pending' ORDER BY rowid LIMIT ?").all(agentId, limit).map(decode);
  }
  ack(agentId, id) {
    if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) throw new Error('Only local agent inboxes can be acknowledged.');
    return this.db.prepare("UPDATE messages SET status='acked' WHERE id=? AND recipient=? AND status='pending'").run(id, agentId).changes > 0;
  }
  replyAndAck(agentId, id, text, source = { kind: 'local' }) {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM messages WHERE sender=? AND reply_to=? ORDER BY rowid LIMIT 1').get(agentId, id);
      if (existing) return decode(existing);
      const original = this.get(id);
      if (!original || original.to !== agentId || original.status !== 'pending') throw new Error('Reply requires a pending message in this agent inbox.');
      const reply = this.send({ from: agentId, to: original.from, text, replyTo: id, source });
      this.ack(agentId, id); return reply;
    });
  }
  getMeta(key) { const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  setMeta(key, value) { this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  acquireLease(key, owner, durationMs = 15000, now = Date.now()) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM leases WHERE key=?').get(key);
      if (row && row.owner !== owner && row.expires > now) return false;
      this.db.prepare('INSERT INTO leases(key,owner,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires').run(key, owner, now + durationMs);
      return true;
    });
  }
  releaseLease(key, owner) { this.db.prepare('DELETE FROM leases WHERE key=? AND owner=?').run(key, owner); }
  recoverOutbox() { this.db.prepare("UPDATE messages SET status='uncertain',error='Previous process stopped during delivery; inspect Discord before resending.' WHERE recipient LIKE 'discord:%' AND status='sending'").run(); }
  claimOutgoing(now = Date.now()) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM messages WHERE recipient LIKE 'discord:%' AND status='pending' AND next_attempt<=? ORDER BY rowid LIMIT 1").get(now);
      if (!row) return null;
      this.db.prepare("UPDATE messages SET status='sending' WHERE id=?").run(row.id);
      return this.get(row.id);
    });
  }
  finishOutgoing(id, { status, error = null, retryAt = 0, discordMessageId = null }) {
    if (!['pending', 'sent', 'failed', 'uncertain'].includes(status)) throw new Error('Invalid outbox status.');
    this.db.prepare('UPDATE messages SET status=?,error=?,next_attempt=?,discord_message_id=? WHERE id=? AND status=\'sending\'').run(status, error, retryAt, discordMessageId, id);
  }
  deliveryIssues() { return this.db.prepare("SELECT * FROM messages WHERE status IN ('failed','uncertain') ORDER BY created_at DESC LIMIT 20").all().map(decode); }
  close() { this.db.close(); }
}
