---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Playwright end-to-end tests against the production build

## Context and Problem Statement

Vitest covers the libraries, route handlers and server actions, but nothing ran the web UI in a browser: opening a feed, posting with the compose box, the read-only view, login and logout. Regressions there (a broken client component, a proxy redirect, a leaked feed name in a page payload) only showed up by hand. How should the UI flows be tested? (Issue #23.)

## Considered Options

* Playwright against `next start`, one server per configuration
* Playwright against `next dev`
* More Vitest tests with a DOM environment (jsdom + Testing Library)

## Decision Outcome

Chosen option: Playwright against `next start`. It tests what ships (the production build, the real proxy, real server actions) and the HTML a reader actually receives, which jsdom component tests can't. `next dev` would be faster to start but differs from production in compilation and payloads.

`NOTEFEED_PASSWORD` is read at startup, so `playwright.config.ts` starts two servers from one build: open on `:3100`, locked on `:3101`, each with its own `DATA_DIR` under `test-results/` and the rate limit off. Tests are split by file into matching projects. Chromium only.

### Consequences

* Good: the main flows, open and locked, are checked on every push in about ten seconds of test time.
* Neutral: `npm run test:e2e` builds first; locally, an already running server on those ports is reused.
* Bad: CI installs Chromium in a separate `e2e` job. The image build is gated on `check` only, so a failing e2e run doesn't block `:main`; gate it too if that turns out to matter.
