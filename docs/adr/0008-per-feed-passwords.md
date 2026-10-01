---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Optional per-feed passwords, set when the feed is created and checked in one place

## Context and Problem Statement

A feed is identified by its name, and anyone who knows the name can read and post (ADR 0001). The only lock is the instance password, which covers every feed at once and belongs to the operator. On a shared or hosted instance, a person wants to protect their own feed without the operator and without an account. How do feeds get a password of their own, and how does it fit the existing paths? (Issue #8, building on ADR 0001, ADR 0003, ADR 0005 and ADR 0007.)

## Decision Drivers

* No accounts, no user management and no database: notefeed has none (ADR 0001).
* Nobody who merely knows a feed's name can lock its owner out of it.
* Scripts, the web UI, the client packages and MCP all work with it, and an instance password still works next to it.
* One access check, not one per entry point (ADR 0003, ADR 0005).
* No new dependency, setting or storage service.
* The operator can always recover a feed whose password was lost.

## Considered Options

Claiming: who may set a password, and when.

* **Only when the feed is created**, by the post that creates it.
* **First to set wins:** any caller may add a password to an open feed.
* **Proof by read id:** whoever presents the feed's read id may set one.

Transport: how a script sends it.

* **A separate `X-Feed-Password` header**, next to `Authorization`.
* **`Authorization: Bearer` carries either password**, and the server tries both.
* **The instance password wins:** it opens every feed, and a feed password is only for unlocked instances.

Storage:

* **A scrypt hash from `node:crypto` in a plain file**, `DATA_DIR/<feed>/.password`.
* **argon2**, which needs a native dependency.
* **A database** or an extra index file.

## Decision Outcome

Chosen options: password at creation only, a separate header, and a scrypt hash in a file, because together they need no accounts, no dependency and no new store.

* **Claiming (a):** a password can only be set by the request that creates the feed: `X-Feed-Password` on the first post, a `password` field in the JSON or form body, the web UI's optional field, or MCP's `password`. A password sent to a feed that exists and has none is `409 feed_exists`, and that includes an empty `X-Feed-Password:` header, since an empty value counts as sent. So an open feed can never be taken over by someone who learns its name, and no owner exists to be locked out. First-to-set-wins would let any stranger who knows an open name lock its owner out of it. Proof by read id would make a link that is public by design (feed readers, dashboards) a write credential for the password.
* **Transport (b):** `X-Feed-Password` is separate from `Authorization`, so both locks can be used at once: `Authorization: Bearer <instance password>` and `X-Feed-Password`. A bearer that carries either would need two checks on one header and would leak which of the two failed; a rule that the instance password wins would make the operator able to read every feed, and nobody can say that to a user who asked for a feed of their own. The instance lock is checked first, so a locked instance still tells strangers nothing.
* **Storage (c):** `DATA_DIR/<feed>/.password` holds `scrypt$N$r$p$salt$hash`, hashed with `scryptSync` from `node:crypto` (N=16384, r=8, p=1), so the parameters can change later without breaking stored hashes. argon2 would add a native dependency to a Docker image and to a source install; a database would be a second place to back up and to keep consistent with the folders. The file is read on every request, so the operator recovers a lost password by deleting it, and the feed is open at once; nothing is cached.
* **Atomic creation (d):** the first post prepares the feed folder with the hash inside it and renames it into place. If the rename wins, the feed exists and is protected from its first moment; if it loses to a concurrent creation, the request is refused (`401` if that feed is protected, `409` if not). There is no window in which the feed exists without its password. A note that would be refused (empty, too large) is validated before any of this, so it can't leave a protected empty feed.
* **Browser session (e):** the unlock cookie is `nf_feed_<feed>` with the value `HMAC-SHA256(secret, feed + hash)`. It is stateless, so nothing is stored, and changing the password changes the hash and so signs every browser out. It is set for two paths, `/<feed>` for the pages and `/api/v1/feeds/<feed>` so the web UI's own JavaScript can call the API. Both match on a `/` boundary, so feed `foo`'s cookie is never sent to `foobar`. `Path=/` would send every feed's cookie to every request, and to the instance's other routes. The cookie has no server-side expiry (the browser keeps it a year) and is `HttpOnly`, `SameSite=Lax`, and `Secure` behind https. It is only accepted from this instance's own pages (the `Origin` check of ADR 0005), and only if no `X-Feed-Password` header came with the request.
* **One check (f):** `checkFeedAccess(feed, { password, cookie }, ip)` in `backend/feedlock.ts` is the only access check. `postNote()` calls it first (ADR 0005, so scripts, the web UI and MCP share it), and so do the API's read operations, the `/<feed>` pages and the MCP read tools. It sits behind the backend boundary (ADR 0003): the frontend only asks `feedUnlocked` and shows the unlock form. A feed without a `.password` file passes every check. Wrong passwords count against the same per-IP failed-attempt limit as the instance password; once over it, the password is not even compared.
* **Change and remove:** `PUT` and `DELETE /api/v1/feeds/{feed}/password` (current password in `X-Feed-Password`, the new one in the JSON body), and the same two actions in the web UI's settings. Neither can add a password to an open feed (`409`).

Out of scope: per-feed read passwords (read links stay public by design), and gating feed protection to a paid tier (a hosting decision, issue #42).

### Consequences

* Good, because there is no new dependency, setting, database or account, and an instance without feed passwords behaves exactly as before.
* Good, because every entry point goes through the same check, so a bug or a fix shows up everywhere.
* Good, because the operator keeps full control: deleting one file recovers a feed.
* Bad, because a `401` for a protected feed reveals that it exists. The notes and the read id stay hidden.
* Bad, because a lost password can't be recovered without the operator. On a self-hosted instance that is the user.
* Bad, because the `password` field in a body only creates, and never unlocks: to reach a protected feed a script must send the header (or the cookie, in a browser).
* Bad, because change and remove are not locked against each other and are not undone: whoever knows the password can change or remove it, and removing it leaves an open feed.
* Bad, because the cookie never expires on the server and a copied cookie works until the password changes.
* Bad, because read links stay public: someone with the read link can read a protected feed's notes.

### Confirmation

Vitest covers `backend/feedlock.ts` (hashing, verification, the cookie, the attempt limit), the creation rules in `postNote()` (header, body, existing open and protected feeds, an empty header, a refused note), the API operations and their `409` and `401` answers, the cookie's two paths, and the MCP tools. Playwright creates a protected feed in the web UI, unlocks it, changes and removes the password, and posts to it with the header.
