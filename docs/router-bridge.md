# Native router bridge

Use ConnectDuet as an orchestration interface to an existing local session router. One Claude session can delegate to allowlisted Claude or Codex sessions, inspect its peer inbox, and receive replies without posting those messages through Discord.

**A compatible Peer API v1 router is required.** The public package supplies an authenticated client, MCP tools, and registration helpers. It does not bundle a native Windows desktop connector, discover existing desktop sessions, install a private composer bridge, or start your native router. Its standalone mailbox mode remains available without such a router.

The router owns delivery. A configured Claude frontend route can deliver through that router's existing composer transport; a configured Codex native route can start an idle turn or steer an active turn directly. This adapter submits to those routes and preserves the text; it does not substitute an external Codex CLI queue or the standalone managed runner. Native delivery supplies the wake/input directly: `read_agent_inbox` is a bounded way to retrieve source, reply, and acknowledgement metadata after delivery, not a requirement to poll for a wake. Native support depends on the router and target session being configured and available.

## Connect a controlling session

Have the router operator provision one sender credential and a peer allowlist. Save the connection outside your project repository, in a private file:

```json
{
  "version": 1,
  "endpoint": "http://127.0.0.1:8787",
  "token": "<64-character hexadecimal token issued by your router>",
  "agentId": "manager"
}
```

The port and `manager` are examples; use the values issued by your router. The token placeholder is intentionally not a working credential. Use restrictive file permissions (0600 on POSIX) or your private Windows user-profile ACL. Never put the token in command arguments or commit the connection file.

```sh
connectduet router-peers --connection /private/path/router-manager.json
connectduet router-connect --connection /private/path/router-manager.json --client claude --session
```

Run the printed Claude command from the project you want it to work in. It loads only this router MCP entry for that invocation; other normally configured MCP servers are excluded. It does not launch Claude until you run the command. Generate a different private connection and session config for each independent sender identity.

For Codex:

```sh
connectduet router-connect --connection /private/path/router-worker.json --client codex --install
```

Restart or reload Codex. This registers one credential-bound identity in Codex's MCP configuration; sessions sharing that configuration can access that identity. It is not a per-thread credential boundary. Use separately configured client profiles or OS accounts when identities must be isolated. `--session` is available for Claude only. Omit `--install` to inspect the registration command first; no token is embedded in it.

No standalone `setup`, mailbox daemon, or Discord bot is needed for this mode. The helper verifies that `/agents` reports the same identity as the connection before preparing registration. Only HTTP on IPv4 loopback with an explicit nonprivileged port is accepted; redirects are rejected.

## Delegate, reply, and acknowledge

Ask the controlling session: “List the available agents. Send worker a focused review request using a fresh idempotency key. Check delivery status, then read my peer inbox for its reply.”

The tools are:

| Tool | Input | Result |
| --- | --- | --- |
| `list_agents` | none | Authenticated identity and allowed destinations |
| `send_agent_message` | `to`, `text`, `idempotencyKey`, optional `replyTo` | Queued native delivery identity |
| `reply_to_agent` | `messageId`, `text`, `idempotencyKey` | Reply to the original sender |
| `read_agent_inbox` | optional `limit` (1–100) | Pending peer messages with source attribution |
| `ack_agent_message` | `messageId` | Explicit recipient acknowledgement |
| `agent_message_status` | `messageId` | This participant's delivery and acknowledgement state |

Message text reaches the router unchanged. Source identity is separate from that text. Native frontends may display only the plain body; read the peer inbox for authenticated source and reply metadata. An agent message is agent content, even when it claims to speak for a human. It does not grant new human authorization or change model permissions.

For multiline CLI payloads, use `--text-file /private/path/message.txt` or pipe UTF-8 input with `--stdin`, instead of `--text`. These modes preserve whitespace and newlines exactly and reject invalid UTF-8. Choose only one text source; the 16,000-character limit still applies.

Use a new UUID as the idempotency key for a new logical send. If the result is uncertain, retry the **same key with exactly the same payload**. The API rejects reusing a key with changed content. CLI send/reply commands generate a key when `--key` is omitted and print it before submission so it remains available for a retry. No HTTP mutation is automatically retried.

```sh
connectduet router-send --connection /private/path/router-manager.json --to worker --text "Review the plan"
connectduet router-inbox --connection /private/path/router-worker.json
connectduet router-reply --connection /private/path/router-worker.json --id peer-MESSAGE_UUID --text "Here is the review"
connectduet router-ack --connection /private/path/router-worker.json --id peer-MESSAGE_UUID
connectduet router-status --connection /private/path/router-manager.json --id peer-MESSAGE_UUID
```

Replace `peer-MESSAGE_UUID` with the returned ID. Replies retain the conversation root and eight-hop budget. Self-sends are rejected. The router limits each sender to 60 messages per minute and each recipient to 1,000 pending peer messages. Do not bounce acknowledgements between agents or create fresh conversations merely to evade limits.

Delivery submission, model receipt, and task completion are different. A native RPC acceptance or composer submission does not prove the model processed the message. Acknowledgement remains an explicit action by the recipient, distinct from delivery status. Replying does not implicitly acknowledge the original.

## Peer API v1 for router implementers

Requests use `Authorization: Bearer TOKEN` and JSON bodies. Authentication determines the sender; bodies must not accept a caller-supplied `from`. Targets must be configured and allowed for that sender. Every response is JSON; failures return a sanitized `{"error":"code"}` and an appropriate non-2xx status.

| Endpoint | Request | Successful response |
| --- | --- | --- |
| `GET /agents` | none | `{agentId, peers:[{id,label,kind}]}` |
| `POST /agent-messages` | `{to,text,idempotencyKey,replyTo?}` | HTTP 202 `{message}`; identical retries return the same ID |
| `GET /agent-inbox?limit=20` | none | `{agentId,messages}` for this recipient's pending peer messages |
| `POST /agent-replies` | `{messageId,text,idempotencyKey}` | HTTP 202 `{message}`; target derived from the original sender |
| `GET /agent-messages/:id` | none | `{message}` for participants only |
| `POST /agent-ack` | `{messageId}` | `{messageId,acknowledged:true}` for the recipient only |

Message fields are `id`, `from`, `to`, `replyTo`, `rootId`, `hops`, `createdAt`, `deliveryId`, and `status`. Inbox messages additionally carry `text` and `source:{kind:"agent",agentId:from,senderIsBot:true}`. Status may include `acknowledged` and `acknowledgedAt`. Delivery status values are `queued`, `dispatching`, `accepted`, `confirmed`, `uncertain`, or `failed`; their transport evidence is the router's responsibility.

Agent IDs match `[A-Za-z0-9_-]{1,64}`. Message IDs are `peer-` followed by a UUID. Keys match `[A-Za-z0-9_-]{8,128}`. Text is nonblank and at most 16,000 characters. Responses must not disclose credentials, internal paths, or unrelated session identifiers. The client limits responses to 2 MB and exposes only the protocol fields above.

Persist the immutable peer message and native delivery enqueue atomically. Deduplicate by authenticated sender and idempotency key; bind that key to the full payload. Preserve explicit agent attribution in delivery metadata and use real peer IDs rather than fabricated Discord messages. These endpoints are scoped peer operations, not a general runtime-history API.

Automated public-package tests use a temporary mock router and real stdio MCP clients. They prove the adapter and protocol behavior, not a live Claude or Codex native delivery. A router operator must separately validate their native transports and actual recipient acknowledgements.
