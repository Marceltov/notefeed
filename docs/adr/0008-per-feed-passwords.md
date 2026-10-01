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

* **Claiming (a):** a password can only be set by the request that creates the feed: `X-Feed-Password` on the first post, a `password` field in the JSON or form body, the web UI's optional field, or MCP's `password`. A password sent to a feed that exists and has none is `409 feed_exists`. An empty password, in the header, the body field or the MCP argument, is no password: curl leaves out a header with an empty value, and the form and both client packages already treat empty as absent, so every path agrees. The price is that a script whose password variable is unset creates an open feed without an error, which can then never be protected; the docs use `${FEED_PASSWORD:?}` in every curl example for that reason. So an open feed can never be taken over by someone who learns its name, and no owner exists to be locked out. First-to-set-wins would let any stranger who knows an open name lock its owner out of it. Proof by read id would make a link that is public by design (feed readers, dashboards) a write credential for the password.
* **Transport (b):** `X-Feed-Password` is separate from `Authorization`, so both locks can be used at once: `Authorization: Bearer <instance password>` and `X-Feed-Password`. A bearer that carries either would need two checks on one header and would leak which of the two failed; a rule that the instance password wins would make the operator able to read every feed, and nobody can say that to a user who asked for a feed of their own. The instance lock is checked first, so a locked instance still tells strangers nothing. A password is 1 to 256 printable ASCII characters (0x20 to 0x7E) with no space at the start or end: a header mangles other bytes and its parser strips surrounding spaces, so anything else could be set in the web UI and then be unusable from a script, or the reverse.
* **Storage (c):** `DATA_DIR/<feed>/.password` holds `scrypt$N$r$p$salt$hash`, hashed with `scrypt` from `node:crypto` (N=16384, r=8, p=1), so the parameters can change later without breaking stored hashes. The asynchronous `scrypt` is used, so the roughly 40 ms of hashing run on the thread pool and don't hold up other requests. argon2 would add a native dependency to a Docker image and to a source install; a database would be a second place to back up and to keep consistent with the folders. The file is read on every request, so the operator recovers a lost password by deleting it, and the feed is open at once; nothing is cached.
* **Atomic creation (d):** the first post prepares the feed folder with the hash inside it and renames it into place. If the rename wins, the feed exists and is protected from its first moment; if it loses to a concurrent creation, the request is refused (`401` if that feed is protected, `409` if not). There is no window in which the feed exists without its password. A note that would be refused (empty, too large) is validated before any of this, so it can't leave a protected empty feed. Access is checked before the request body is read, and the sender decides how long the body takes, so a post that proved no password is checked again once the body is in: if the feed was created protected in the meantime, the post is refused with `401`. A window of a few microseconds is left, between that second check and the note's file, and is accepted: a creation that lands exactly there gets one foreign note into the new feed, and a per-feed lock around creation would close it.
* **Browser session (e):** the unlock cookie is `nf_feed_<feed>` with the value `HMAC-SHA256(secret, feed + hash)`. It is stateless, so nothing is stored, and changing the password changes the hash and so signs every browser out. It is set for two paths, `/<feed>` for the pages and `/api/v1/feeds/<feed>` so the web UI's own JavaScript can call the API. Both match on a `/` boundary, so feed `foo`'s cookie is never sent to `foobar`. `Path=/` would send every feed's cookie to every request, and to the instance's other routes. The cookie has no server-side expiry (the browser keeps it a year) and is `HttpOnly`, `SameSite=Lax`, and `Secure` behind https. It is only accepted from this instance's own pages (the `Origin` check of ADR 0005), and only if no `X-Feed-Password` header came with the request. It is handed out in three places: the unlock form, a password change, and the post that creates a protected feed. All of the web UI's feed-password forms (unlock, lock, change, remove) need the same `Origin` check, so another site can neither act with a visitor's cookie nor use up their password attempts.
* **One check (f):** `backend/feedlock.ts` is the only place that decides access, and the only one that compares a password or a cookie. `checkFeedAccess(feed, { password, cookie }, ip)` is the check for requests: `postNote()` calls it (ADR 0005, so scripts, the web UI and MCP share it), and so do the API's read operations and the MCP read tools. `feedUnlocked(feed, cookie)`, in the same file, answers the `/<feed>` pages, which only need to know whether to show the unlock form; the frontend reaches it through the backend boundary (ADR 0003). A feed without a `.password` file passes every check. Wrong passwords count against the same per-IP failed-attempt limit as the instance password; once over it, the password is not even compared. A request with no password, or with only a stale cookie, is refused before any hashing and is not counted: otherwise anyone could lock the owner out for a minute just by requesting the feed, since all feeds and the instance password share that limit.
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
* Bad, because a read id is derived from the feed's name, so it is the same before and after the feed is protected. Anyone who learned a name's read id while the feed was open, or before it existed, keeps read access to the feed created there later. The web UI therefore shows no read link for a feed without notes, which stops strangers from collecting read ids for likely names, but an id learned earlier still works. A random read id per feed would fix it and is left to issue #40, because deleting a feed raises the same question.

### Confirmation

Vitest covers `backend/feedlock.ts` (hashing, verification, which passwords are accepted as new, the cookie, the attempt limit and that a request without a password is never counted), the creation rules in `postNote()` (header, body, existing open and protected feeds, an empty header or field, a refused note, and a slow body that finishes after the feed was created protected), the API operations and their `400`, `401`, `409` and `429` answers, the cookie's two paths and which post receives it, the `Origin` check on the feed-password forms, the missing read id of a feed without notes, and the MCP tools. Playwright creates a protected feed in the web UI, unlocks it in another browser, changes and removes the password, locks it again, checks that the form refuses a password a header could not carry and that a feed without notes shows no read link, and posts and lists from a script with `X-Feed-Password`.
