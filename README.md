# ConnectDuet

**Give your coding agents a way to talk to each other.**

ConnectDuet gives Claude Code, Codex, and other MCP clients named local mailboxes. Agents can send a message, read an inbox, reply, and acknowledge receipt. An optional Discord bridge lets you talk to them from your own server.

Built from the idea behind a working personal Discord router, rewritten for a clean, portable release. No hosted ConnectDuet account, model API key, or Discord account is needed to try the demo. Your agent subscriptions remain separate.

```text
Claude Code <----> local durable mailboxes <----> Codex / other MCP clients
                             ^
                             |
                    optional Discord bot
```

## Try it

Install [Node.js 24 or later](https://nodejs.org/en/download), then run:

```sh
npm install --global https://github.com/yasirwhite/ConnectDuet/releases/download/v0.1.0/connectduet-0.1.0.tgz
connectduet demo
connectduet setup --local
```

The demo exchanges synthetic messages between two mailboxes without launching a model. Local setup creates `claude` and `codex` mailboxes in your private ConnectDuet home.

Generate a launch configuration for Claude and register the Codex mailbox:

```sh
connectduet connect --client claude --agent claude --session
connectduet connect --client codex --agent codex --install
connectduet doctor
```

Run the printed Claude launch command from your project directory; it loads only that session's mailbox MCP configuration. Restart or reload Codex so it sees the registered MCP server. Ask Claude: **“Use ConnectDuet to send codex a message asking it to review my plan.”** Ask Codex: **“Check my ConnectDuet inbox and reply to Claude.”** Acknowledge a message once it has been handled. The tools preserve it until then.

Omit `--install` to print a persistent registration command for review. Claude persistent registration defaults to the current project (`--scope local`); `--session` avoids changing client registration and supports two identities in the same project. Each mailbox should have one consuming agent session. Add more named mailboxes with `connectduet agent add --id reviewer`. See [integration instructions](docs/integrations.md) for multiple sessions and other MCP clients.

### Prefer a download?

Download the [source ZIP](https://github.com/yasirwhite/ConnectDuet/archive/refs/tags/v0.1.0.zip), extract it, and open `Start-ConnectDuet.cmd` on Windows. On macOS or Linux, run `sh start-connectduet.sh` in the extracted folder. The launchers install project dependencies and open guided setup. Node must already be installed; the first dependency download needs internet access. This is a guided install, not a zero-configuration promise.

For development:

```sh
git clone https://github.com/yasirwhite/ConnectDuet.git
cd ConnectDuet
npm ci
npm test
npm run demo
npm run setup
```

## Delivery modes

| Mode | What happens | Requirements |
| --- | --- | --- |
| Standard MCP | Agent checks its inbox through tools | MCP-capable client; no router daemon for local messages |
| Claude Code Channels | Pushes a notification into a running Claude Code session | Opt-in research preview; [setup and restrictions](docs/integrations.md) |
| Managed Codex runner | Processes incoming messages in its own Codex thread | Experimental; installed/authenticated Codex CLI; [runner guide](docs/codex-runner.md) |
| Discord | Routes allowlisted messages into mailboxes and sends explicit replies | Your own bot, Message Content Intent, configured channel and sender allowlists |

**Standard MCP does not wake an idle Codex session.** The managed runner creates its own conversation; it does not take over an existing Codex Desktop chat. A queued message or submitted notification is not proof that a model read it. An explicit acknowledgement is tracked separately.

## Add Discord

Run `connectduet setup` on a fresh install and choose Discord. If you already used local setup, `connectduet setup --force` replaces its configuration; retain any custom mailbox names you want to keep. The wizard validates your bot token, generates its invite link, lists your servers and text channels, and asks which human user IDs may send messages.

```sh
connectduet start
```

Keep that terminal running for Discord routing. Message the configured channel, then ask the destination agent to read its inbox and reply. Ordinary agent chat output is not automatically posted: use the reply/send tools. Discord bot senders are denied unless explicitly allowlisted. Mentions are suppressed on outgoing messages.

Tokens are entered without displaying them and stored outside the repository, or supplied through `CONNECTDUET_DISCORD_TOKEN`. Do not paste tokens into command arguments, issues, or chat. Attachments are not downloaded or executed; this first release is a text bridge. See [security and delivery limits](SECURITY.md).

## Useful commands

```sh
connectduet send --from claude --to codex --text "Please review the plan"
connectduet inbox --agent codex
connectduet ack --agent codex --id MESSAGE_ID
connectduet connect --client claude --agent claude --channel
connectduet codex-run --agent codex --cwd /path/to/project
```

Use `connectduet --help` for options. `--home PATH` or `CONNECTDUET_HOME` selects a separate mailbox installation. Default state is under `~/.connectduet`. Local state and credentials never belong in Git.

## What is tested

Automated tests exercise temporary mailboxes, permission checks, duplicate delivery, mocked Discord transport, MCP over stdio, setup, and the managed runner protocol. No test sends a real Discord message or spends model credits. The repository includes Windows, macOS, and Linux CI. Real agent/channel behavior still depends on the installed client version, authentication, and preview access.

See [setup improvements](docs/setup-improvements.md), [release notes](CHANGELOG.md), and the [short launch plan with manual post drafts](docs/launch-plan.md). MIT licensed. Not affiliated with Anthropic, OpenAI, or Discord.
