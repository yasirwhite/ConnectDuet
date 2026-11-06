# Agent integrations

ConnectDuet keeps one local mailbox per configured agent ID. Each session starts its own stdio MCP process, sharing the same private ConnectDuet home. No daemon is required for local messaging; run `connectduet start` only for Discord.

## Claude Code and Codex

After `connectduet setup --local`, register the two default identities:

```sh
connectduet connect --client claude --agent claude --install
connectduet connect --client codex --agent codex --install
```

Omit `--install` to print the registration commands first. The helper records absolute executable paths; keep ConnectDuet installed at that location. Claude registration defaults to local scope in the current project; `--scope user` makes it available across projects. Restart the clients after registration and check `/mcp`. Restart ConnectDuet MCP processes and the Discord bridge after changing mailbox or route configuration. The commands use the documented interfaces: [Claude Code MCP](https://code.claude.com/docs/en/mcp) and [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

In Claude Code, ask: “Use ConnectDuet to send codex a short review request.” In Codex, ask: “Read my ConnectDuet inbox, reply to the request, and acknowledge the original message.” Then ask Claude to read its inbox.

The tools are `connectduet_peers`, `connectduet_send`, `connectduet_inbox`, `connectduet_reply`, and `connectduet_ack`. Inbox reads do not consume messages. Acknowledgement is explicit; reply does not imply acknowledgement. Local messages allow 16,000 characters; Discord outbound text allows 1,800 characters. Replies carry an eight-hop budget. Do not automatically reply to acknowledgements or start fresh conversations to defeat that limit.

Standard MCP exposes tools when the model calls them. It does **not** wake idle Codex or Claude sessions. For an optional, separately managed Codex session, see the experimental [Codex runner](codex-runner.md). ConnectDuet does not attach to existing Codex Desktop sessions or inject into GUI composers. Local MCP client tests verify the protocol, not whether a particular model will choose to call a tool.

## Optional Claude Code push notifications

Register a channel-enabled MCP entry:

```sh
connectduet connect --client claude --agent claude --channel --install
claude --dangerously-load-development-channels server:connectduet-claude
```

Use an interactive terminal and accept Claude Code's channel prompt. Custom channels remain a research-preview feature; organization policy can disable them. The development flag is per entry and does not work in non-interactive `-p` sessions. It is an opt-in to a custom channel, not a permission bypass for agent actions. See the [official channel reference](https://code.claude.com/docs/en/channels-reference).

ConnectDuet pushes pending messages after MCP initialization. Successful notification writes are not proof Claude consumed them; messages remain pending until `connectduet_ack`. The process suppresses repeated notifications during that connection, retries failed transport writes at most three times, and may notify again after restart. Use inbox tools if a notification is missed. No remote permission-approval relay is enabled.

## Two Claude sessions, including in the same project

Generate one private session configuration per mailbox:

```sh
connectduet agent add --id reviewer
connectduet agent add --id implementer
connectduet connect --client claude --agent reviewer --session
connectduet connect --client claude --agent implementer --session
```

Run each printed `claude` command in a separate terminal. Add `--channel` to both `connect` commands for preview push. The helper writes `clients/claude-ID.json` under your ConnectDuet home and prints a command; it neither launches Claude nor changes client-wide registration.

Each command uses `--mcp-config` with `--strict-mcp-config`, so **only that invocation's selected ConnectDuet MCP server loads**. Other normally configured MCP tools are excluded for that invocation. This prevents both sessions from accidentally loading both mailboxes. Claude's own built-in tools remain governed by its settings. These flags are documented in the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

Ask the implementer session to message `reviewer`, then ask the reviewer session to read, reply, and acknowledge. Use a single consumer per mailbox. The helper replaces its generated file when rerun; keep custom MCP configurations in a separate file. This is for independently launched sessions; it does not automatically assign identities to native Claude subagents.

## Other clients and deployment boundaries

Sharing an ID means sharing an inbox; acknowledgements apply to that mailbox. For non-Claude clients, use their separate session/profile configuration features when you need different identities. User-scoped registration exposes the configured mailbox to sessions using that client configuration.

Any local stdio MCP client can launch:

```sh
node /absolute/path/to/ConnectDuet/src/cli.mjs mcp --agent reviewer --home /absolute/path/to/private-home
```

Set the executable and each argument as separate MCP configuration fields. Both peers need the same private home; this release does not synchronize mailboxes across computers. Discord can provide the external conversation surface.

Local agents run as the same OS user and are not isolated from each other's files. Tool identity binding prevents accidental sender changes through tool parameters; it is not a security boundary against code with access to the private home. Preserve source attribution, and treat peer/bot messages as untrusted content rather than human authorization.
