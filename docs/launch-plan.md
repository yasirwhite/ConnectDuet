# A small launch plan

Share manually, one community at a time. Start with five people completing setup, not a star target. Record their OS, setup time, first successful message, and confusing step; fix the most common obstacle before the next post. A short recording should show two clearly labeled sessions exchanging one message and reply, then the setup command. Use synthetic messages only.

## Where to share

Rules checked November 5, 2026; reopen the current pinned thread before posting.

1. **r/codex weekly showcase — first.** The [showcase](https://www.reddit.com/r/codex/comments/1xmyhim/show_us_all_what_youve_been_building_with_codex/) expressly invites projects built using Codex. Lead with the working MCP exchange and explain the pull-based inbox limitation. [Community rules](https://www.reddit.com/r/codex/) favor relevant, detailed contributions.
2. **r/ClaudeAI showcase — second.** [Rule 7](https://www.reddit.com/r/ClaudeAI/) permits projects built with or specifically for Claude, requires a clear explanation, free trial, minimal promotion, and no referral links. Feed posts require over 100 karma. The [current showcase thread](https://www.reddit.com/r/ClaudeAI/comments/1xi1yek/show_us_what_youve_created_with_claude/) is the simpler placement. Describe the actual Claude contribution; don't claim Claude wrote this standalone release.
3. **r/ClaudeCode weekly showcase — conditional.** Its [thread instructions](https://www.reddit.com/r/ClaudeCode/comments/1xlurut/weekly_showcase_thread_what_are_you_building_with/) put quick project sharing here and ask how Claude Code was used. Use this if you can describe its real role in the original router. Don't repeat the same promotion across all three immediately.

Later, consider [Show HN](https://news.ycombinator.com/showhn.html) once strangers can run the demo: explain the original problem, durable mailbox design, and remaining limits. **Write that post yourself:** [HN rules](https://news.ycombinator.com/newsguidelines.html) prohibit generated post text. Skip r/LocalLLaMA for this release: its [rules](https://www.reddit.com/r/LocalLLaMA/) disallow primarily LLM-generated copy/code, and this release centers on hosted coding agents.

## Draft: r/codex showcase comment

I built ConnectDuet with Codex to stop manually copying messages between coding sessions. It's an open-source local bridge: Claude Code and Codex get named mailboxes and MCP tools to send, read, reply, and acknowledge messages. Discord is optional.

The demo runs without a Discord account or model calls. Real use requires Node 24+ and your existing agent clients. The important limit: Codex reads its inbox through tools; ordinary MCP does not automatically wake an idle Codex session. Claude push uses the Channels research preview.

[Repo and setup](https://github.com/yasirwhite/ConnectDuet). I'd like feedback on the first confusing setup step, especially across Windows, macOS, and Linux.

## Draft: r/ClaudeAI showcase comment

I made ConnectDuet for Claude Code sessions that need to hand messages to another session or to Codex. It grew out of a router I used myself; Codex helped prepare this standalone release.

It uses local durable mailboxes, explicit replies and acknowledgements, plus an optional Discord bridge. It's open source and free to try, with a demo requiring no model calls. Agent subscriptions are separate. Claude push requires its Channels research preview; Codex uses a tool-based inbox. It doesn't promise to wake every desktop chat.

[Source and setup](https://github.com/yasirwhite/ConnectDuet). What would make this easier to fit into your workflow?

For r/ClaudeCode, adapt the second draft and add one truthful sentence explaining what Claude Code actually helped build. No posts have been sent.
