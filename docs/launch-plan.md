# ConnectDuet v0.2 launch plan

Lead with one Claude Duet manager coordinating friendly Claude sessions. Codex and other local agents are the bonus. Share manually, one community at a time; aim for five people completing setup and sending a first message. Record their OS, setup time, and first confusing step, then fix the common obstacle.

Use the [OpenDemo overview GIF](assets/connectduet-overview.gif) to explain the workflow. Label it **conceptual animation, not a live recording**. The public Router Bridge tools require a compatible existing local router. Its native adapters can submit through Claude's frontend composer and steer an active Codex turn or start an idle one; those adapters are **not bundled**. Independent mailbox mode is the fallback.

## Where to share

Rules checked November 5, 2026; reopen the current pinned thread before posting.

1. **r/ClaudeAI showcase — first.** [Rule 7](https://www.reddit.com/r/ClaudeAI/) permits projects built with or specifically for Claude, requires a clear explanation, free trial, minimal promotion, and no referral links. Feed posts require over 100 karma. The [showcase thread](https://www.reddit.com/r/ClaudeAI/comments/1xi1yek/show_us_what_youve_created_with_claude/) is the simpler placement. Describe the actual Claude contribution; don't claim Claude wrote this standalone release.
2. **r/codex weekly showcase — second.** The [showcase](https://www.reddit.com/r/codex/comments/1xmyhim/show_us_all_what_youve_been_building_with_codex/) invites projects built using Codex. Explain the difference between native router delivery and mailbox polling. [Community rules](https://www.reddit.com/r/codex/) favor relevant, detailed contributions.
3. **r/ClaudeCode weekly showcase — conditional.** Its [thread instructions](https://www.reddit.com/r/ClaudeCode/comments/1xlurut/weekly_showcase_thread_what_are_you_building_with/) put quick project sharing here and ask how Claude Code was used. Use this if you can describe its real role in the original router. Don't repeat the same promotion across all three immediately.

Later, consider [Show HN](https://news.ycombinator.com/showhn.html) after independent setup feedback. **Write that post yourself:** [HN rules](https://news.ycombinator.com/newsguidelines.html) prohibit generated post text. Skip r/LocalLLaMA: its [rules](https://www.reddit.com/r/LocalLLaMA/) disallow primarily LLM-generated copy/code.

## Draft: r/ClaudeAI showcase comment

I made ConnectDuet so one Claude Duet manager can coordinate friendly Claude sessions instead of making me carry messages between them. Codex and other local agents can join too. It grew out of a router I use myself; Codex helped prepare the public release.

Version 0.2 adds Router Bridge tools for a compatible existing local router. That router supplies the Claude frontend composer and Codex active-turn/idle-turn adapters; they aren't bundled. Without one, you can use the independent local mailboxes. It's open source and free to try; agent subscriptions are separate.

[Repo and setup](https://github.com/yasirwhite/ConnectDuet). The [overview GIF](https://github.com/yasirwhite/ConnectDuet/blob/main/docs/assets/connectduet-overview.gif) is a conceptual animation, not a live recording. What would make this useful in your workflow?

## Draft: r/codex showcase comment

I built ConnectDuet with Codex to help a Claude Duet manager coordinate other Claude sessions, with Codex as another teammate.

Its v0.2 Router Bridge connects to a compatible local router whose native adapters can steer an active Codex turn or start an idle one. Those native adapters aren't included in the public bundle. Independent mailbox mode works without them, but its ordinary MCP inbox doesn't wake idle Codex sessions.

[Source and setup](https://github.com/yasirwhite/ConnectDuet). The local demo needs no model calls. I'd appreciate feedback on the first confusing setup step.

For r/ClaudeCode, adapt the first draft and add one truthful sentence explaining what Claude Code actually helped build. No posts have been sent.
