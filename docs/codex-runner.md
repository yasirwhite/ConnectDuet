# Experimental managed Codex runner

Ordinary MCP lets an existing Codex session check its inbox. For automatic responses, ConnectDuet can instead own a separate Codex app-server process and conversation:

```sh
connectduet codex-run --agent codex --cwd /absolute/path/to/project
```

Install the Codex CLI and sign in first. Use a dedicated agent ID for this runner; do not also consume that inbox from MCP. Keep the runner open. It checks the inbox, starts one turn at a time, sends the final answer to the original sender, and acknowledges the input after the reply is durably queued. It resumes only the conversation it created. It does not attach to or wake an existing Codex Desktop conversation. Model usage uses your Codex account and can incur its normal costs or limits.

This adapter uses the documented [Codex app-server stdio protocol](https://learn.chatgpt.com/docs/app-server). It is experimental: protocol behavior has been tested against a simulated child process, not a paid live model. An incompatible installed Codex version may reject a request; the runner stops rather than weakening its settings.

The runner requests a read-only filesystem sandbox, declines approval requests, disables each configured MCP server and app using per-thread configuration overrides, and disables web search. It does not change global Codex settings or grant tool permissions. Your selected project and its instructions are still available to Codex; a filesystem sandbox alone is not a general isolation boundary for third-party integrations. Do not use a directory containing material you do not want this managed session to read.

Reply chains have an eight-hop limit. The runner sends only a final answer, not intermediate commentary. Discord answers must fit 1,800 characters; larger answers stop for manual handling. Attachments and interactive tool approval are not supported.

## Recovery

If Codex disconnects, fails, times out, or returns an invalid answer after delivery began, the message stays pending and the runner records an uncertain in-flight marker. Restarting does not silently run it again. Inspect the managed conversation with your Codex client, decide whether to send a manual answer, then explicitly skip the original inbox message:

```sh
connectduet ack --agent codex --id MESSAGE_ID
```

Restart the runner. Send a new message deliberately if another model attempt is wanted. This avoids accidental duplicate actions or charges. A stopped run can have completed model work even if ConnectDuet received no completion event.

A sudden process kill may also leave `codex-runner-AGENT.lock` in your private ConnectDuet home. First confirm there is no active runner for that agent, then remove that one lock file. Do not delete the mailbox database to recover. Clean shutdown removes the lock automatically. Press Ctrl+C to stop; an active turn remains uncertain until reviewed.
