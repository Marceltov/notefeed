---
status: accepted
date: 2026-09-30
decision-makers: Marcel Bruckner
---

# Open feeds identified by name, with derived read links and an optional instance password

## Context and Problem Statement

Until 0.3, a notefeed instance held one feed protected by a shared `NOTEFEED_TOKEN` (bearer for the API, session cookie for the web UI). The goal is a hosted service at notefeed.me that anyone can use without accounts, like ntfy.sh, while self-hosters keep a simple private option. How should feeds be identified and protected on an instance that is open to the internet? (Issue #5.)

## Decision Drivers

* No accounts or sign-up: a script or dashboard needs one URL.
* Feed readers store their URL in config files (often committed to git), so reading must not imply posting.
* An open instance must survive abuse: guessing, flooding, oversized bodies.
* A homelab exposed to the internet must still be lockable.

## Considered Options

* Feed name in the URL is the only credential, read and write alike (exactly like ntfy topics).
* Feed name for writing, plus a read-only link derived from it with a server secret.
* Accounts with per-user API keys.

## Decision Outcome

Chosen option: "Feed name for writing, plus a read-only link derived from it", because it keeps ntfy's zero-setup model while letting a feed's RSS URL be shared or committed without handing out posting rights.

* A feed is `DATA_DIR/<feed>/`, name `^[a-z0-9_-]{1,64}$`; app paths (`r`, `api`, `login`, `logout`, `mcp`, …) are reserved.
* Read id = first 22 chars of `base64url(HMAC-SHA256(secret, feed))` (128 bits); the secret comes from `NOTEFEED_SECRET` or a generated `DATA_DIR/.secret` (≥ 32 bytes, mode 0600, never silently regenerated). Unknown read ids return an empty feed, so links can't be probed.
* `NOTEFEED_PASSWORD` optionally locks everything except read links; failed password attempts are rate-limited because a human-chosen password is guessable where the old random token was not.
* Posts are rate-limited per client IP (`NOTEFEED_RATE_LIMIT`), bodies are capped while streaming, and `NOTEFEED_MAX_FEEDS` / `NOTEFEED_MAX_NOTES_PER_FEED` optionally cap growth. Behind a proxy (`NOTEFEED_TRUST_PROXY=1`) the **last** `X-Forwarded-For` entry is used: it is the address the trusted proxy saw, whether the proxy appends or overwrites.
* The web UI suggests feed names with ≥ 64 bits of randomness, since the name is the write key.

### Consequences

* Good, because notefeed.me works with a single URL per feed and no sign-up, and read links are safe to publish.
* Good, because self-hosters still get a private instance with one variable.
* Bad, because anyone who learns a feed name can read and post to it; short or guessable names are the user's risk (per-feed passwords are tracked in #8).
* Bad, because without a trusted proxy all direct clients share one rate-limit bucket (Next.js exposes no trustworthy client address), so one abuser can throttle others, including the owner's login on a locked instance.
* Bad, because this breaks the 0.3 API (`NOTEFEED_TOKEN`, `/api/notes`, `/feed.xml`) and the client packages (0.4.0).

### Confirmation

Vitest covers feed-name validation (including traversal and reserved names), per-feed isolation, read-id derivation and secret handling, the proxy's rewrite and lock rules, rate limits (posts and failed passwords), caps, the streaming body cap, and the web UI's server actions. Both client packages have parity tests.

## More Information

Spec and plan were worked out in the brainstorming session for #5; the MCP endpoint (#7) builds on this model and passes the feed name as a tool parameter.
