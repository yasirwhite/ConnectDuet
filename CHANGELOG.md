# Changelog

## 0.1.0

First standalone release: durable local mailboxes, MCP messaging for Claude Code/Codex and compatible clients, optional Claude Channels push, an optional Discord bridge, and an experimental managed Codex runner. Includes guided setup, client registration, local demo, diagnostics, and manual launch drafts.

This release uses public client interfaces and synthetic protocol tests. It does not include personal router configurations, private desktop IPC helpers, existing sessions, message history, or credentials. It does not promise automatic wake of every existing agent chat. Discord replay is bounded by saved cursors, API access, and per-run catch-up limits.
