# Security and delivery boundaries

ConnectDuet is a same-user local messaging tool. MCP binds a server process to a mailbox, but an agent or process with access to the same operating-system account can read or modify that account's ConnectDuet files. Mailboxes are not a sandbox between mutually untrusted agents. Use separate OS accounts or machines for that boundary.

## Private state

Configuration, bot credentials, message contents, and runner state live in the selected ConnectDuet home, outside this repository by default. POSIX files/directories use restrictive permissions. On Windows they inherit the containing folder's ACL: keep the home in your own user profile, not a shared folder. State is not encrypted at rest. Never commit or share it. Message history remains on disk after acknowledgement; do not use this release for secrets requiring automatic retention limits.

No telemetry is sent to a ConnectDuet service. Discord mode connects to Discord. Agent clients may send received messages to their own model providers according to their settings. Installation fetches packages from npm; the managed runner uses your Codex authentication and may consume usage.

## Inbound messages

Discord routing requires an exact configured guild, channel, and sender allowlist. Bot and human IDs have separate allowlists; bots are denied by default. Relayed text keeps its actual sender attribution. A message from a bot is not human authorization, even if its body claims otherwise. Treat all message text and attachments as untrusted input. Do not enable automatic tool approvals just because a message arrived through ConnectDuet.

The router does not execute message bodies, download attachments, evaluate commands, or expose an HTTP listener. Outbound messages suppress Discord mentions. Local replies must refer to a message addressed to the sending agent, and their recipient is derived from the original sender. Bounded reply hops and rate limits reduce accidental loops; an agent can deliberately start another conversation, so these are not a defense against hostile same-user code.

## Delivery

Mailboxes are durable SQLite stores with explicit acknowledgement. Duplicate Discord message IDs are suppressed. Notification submission and remote API acceptance do not prove model consumption. A closed client cannot receive channel notifications; inbox messages remain available.

Do not run two consumers for one mailbox. Do not run multiple Discord bot gateways with the same bot token. Gateway resume helps brief outages. A fresh connection attempts bounded catch-up from each saved channel cursor, up to 2,000 messages per channel per run; the first start begins at the current time. This is not an arbitrary history importer, and deleted or inaccessible messages cannot be recovered. No claim of exactly-once external delivery is made.

An ambiguous Discord send or managed model request is held for inspection rather than automatically repeated. This avoids retrying potentially completed external work, but requires recovery when a request's outcome is unknown. Consult `doctor` and the runner guide. The managed runner is experimental; its documented restrictions do not make arbitrary third-party integrations safe.

## Router Bridge credentials and actions

Router Bridge connects only to a configured IPv4 loopback HTTP endpoint. A private connection file binds an agent ID to its token; the client verifies that identity before sending and refuses redirects. The server controls allowed destinations and reply ownership. A per-agent credential is not a boundary against other code running as the same OS user with access to its private files.

Native delivery can steer a running agent or put text into an existing application session. Enable only the routes intended for your workflow. Peer messages may carry delegated work already within a user's authorized goal, but do not provide new human authorization for unrelated actions. An agent's explicit acknowledgment does not establish that its assigned work is complete. Use the same request key and exact payload after an ambiguous send; generating a new key can create duplicate work.

The public bridge client does not install or validate a third-party router's native transport implementation. See the [bridge protocol and setup](docs/router-bridge.md). Its peer inbox is a source/reply metadata interface; native delivery does not depend on agents polling it.

## Reporting a vulnerability

Use the repository's GitHub private vulnerability reporting feature when available. Otherwise open an issue requesting a private contact without including exploit details, tokens, or private message contents. Rotate a leaked Discord token in the Discord Developer Portal; deleting a public post does not revoke it.
