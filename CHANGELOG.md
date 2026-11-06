# Changelog

## 0.2.0

Adds Router Bridge tools so one coordinating agent can discover, message, and receive replies from configured native sessions through a compatible local router. Existing native routes can steer an active Codex session or enter a Claude session through its frontend; the bridge client does not install those adapters. Sender-bound credentials, idempotent requests, bounded reply chains, individual delivery status, and explicit acknowledgement preserve the difference between submission and receipt.

Includes CLI and MCP access, private per-session Claude configuration, revised orchestration-first documentation, and a 12-second conceptual animation rendered with OpenDemo. Standalone mailbox mode remains available without a native router.

## 0.1.0

First standalone release: durable local mailboxes, MCP messaging for Claude Code/Codex and compatible clients, optional Claude Channels push, an optional Discord bridge, and an experimental managed Codex runner. Includes guided setup, client registration, local demo, diagnostics, and manual launch drafts.

This release uses public client interfaces and synthetic protocol tests. It does not include personal router configurations, private desktop IPC helpers, existing sessions, message history, or credentials. It does not promise automatic wake of every existing agent chat. Discord replay is bounded by saved cursors, API access, and per-run catch-up limits.
