# Setup time: what we shortened

Implemented in this release:

- Account-free demo: try the message/reply flow before creating a bot or authenticating a model.
- Local mode first: cross-agent mailboxes do not need Discord, a network port, or a background router.
- Two ready-made mailbox names and an `agent add` command remove initial JSON editing.
- Guided Discord setup verifies the bot, builds its invite URL, and lists servers/channels instead of requiring copied channel IDs.
- Hidden token input and an environment-variable option keep credentials out of shell history.
- Client registration commands are generated with absolute paths; `connect --install` runs them without asking users to edit MCP configuration. Claude `connect --session` generates a configuration for one session, including separate sessions in the same project.
- A versioned release package bundles its runtime dependencies for one installation command without a second dependency download. Source download launchers handle project dependencies.
- `doctor` checks common local problems before users troubleshoot the agents themselves.

Remaining friction and choices:

| Step | Why it remains | Next sensible improvement |
| --- | --- | --- |
| Node 24 installation | The durable store uses Node's built-in SQLite | Signed platform installers bundling Node, after CI and fresh-user feedback justify maintaining three builds |
| Discord bot creation and human ID | Permissions and sender ownership are user decisions | A hosted OAuth onboarding service could shorten this, but introduces hosting, credential handling, and maintenance; omitted from this local-first release |
| Client authentication/reload | Controlled by the agent client | Keep instructions current; avoid taking over client credentials or silent restarts |
| Claude Channels preview opt-in | Upstream access restriction | Follow official channel/plugin distribution as the API stabilizes |
| Existing Codex Desktop wake | Ordinary MCP is pull-based | Use the included opt-in managed runner for its own thread; avoid fragile private desktop injection |

No measured universal setup-time claim is made. Ask the first five users to time installation through their first reply and identify the slowest step. Optimize those observations before adding a hosted service or platform installers.
