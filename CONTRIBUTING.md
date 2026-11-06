# Contributing

Use Node.js 24 or later. Run `npm ci`, `npm test`, `npm run demo`, and `npm run check:release` before submitting a change. Tests must use temporary state, synthetic messages, and mock external services. Never test against a contributor's real Discord channels or agent sessions by default.

Open an issue with the expected behavior, OS, Node version, and sanitized reproduction steps. Never attach tokens, private messages, config/secrets files, or runtime databases. Changes to delivery, retries, source attribution, and permissions need failure-path tests.

Keep the product honest about delivery: storing a message, submitting a notification, and an agent acknowledging it are different states. Preserve that distinction in code and documentation. Do not enable agent tools, change sandbox settings, or install a service silently.
