---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# MCP endpoint on the official SDK, with notefeed as its own stateless OAuth server

## Context and Problem Statement

AI assistants (Claude Code, Claude Desktop, Claude.ai, any MCP client) should post notes to feeds and read them back over one URL, `<PUBLIC_URL>/mcp`. On an open instance there is no auth step. On a locked instance, Claude Code and scripts can send the password as a bearer, but the Claude.ai and Desktop connectors can't send headers: they need the OAuth flow of the MCP authorization spec. How should notefeed serve MCP and authorize those clients? (Issue #7, building on ADR 0001 and ADR 0005.)

## Decision Drivers

* An open instance needs no setup, and a locked one needs no extra secret or database: the instance password is the only credential.
* Posting must obey exactly the rules of the HTTP API.
* Few dependencies, and none that pull in a web framework next to Next.js.
* No server-side fetches of URLs a client chooses.

## Considered Options

* **SDK v2 and notefeed as its own stateless OAuth server with Dynamic Client Registration (DCR).**
* **Client ID Metadata Documents (CIMD)** instead of DCR.
* **Dual-era support:** the 2026-07-28 protocol and the older initialize/session one.
* **The v1 SDK** with its express-based auth router.

## Decision Outcome

Chosen option: "SDK v2 and notefeed as its own stateless OAuth server with DCR", because it needs no new infrastructure and works with the clients that matter.

* **Protocol:** MCP 2026-07-28 only. Legacy clients get the spec's `400` naming the supported version. `@modelcontextprotocol/server` 2.2.0 (MIT, depends only on `zod`) implements it and exposes a web-standard `fetch` handler, which a Next.js route can mount. It is pinned exactly.
* **Tools:** `post_note`, `list_notes`, `get_note`, each taking the feed name. `post_note` goes through `postNote()` (ADR 0005), so size, rate limit, caps and feed creation are the API's. Known failures become `isError` results with the API's message; any other failure is logged and returns `isError` with just "internal error", so no path or stack reaches the client. The SDK's default response mode is used: one JSON body per request, since no tool sends mid-call notifications.
* **Locked instance:** `/mcp` accepts `Authorization: Bearer <password>` (same check and failed-attempt limit as the API) or an OAuth access token for `<PUBLIC_URL>/mcp`. Otherwise `401` with `WWW-Authenticate` pointing at the protected-resource metadata. An `Origin` that isn't the public host is `403` (DNS rebinding). That only stops DNS rebinding when `PUBLIC_URL` is set: without it the public host comes from the request's own `Host` header, which a rebinding page controls. An access token we signed that has expired or names another resource answers `401` with `error="invalid_token"`, so the client refreshes, and doesn't count as a failed password attempt.
* **OAuth:** notefeed is its own authorization server (issuer `PUBLIC_URL`, RFC 8414 and RFC 9728 metadata, PKCE `S256`, public clients). Login is the instance password. Clients register through DCR. The metadata documents, `/oauth/register` and `/oauth/token` send `Access-Control-Allow-Origin: *` (and the first three answer `OPTIONS` preflights) so browser-based clients can use them; none of them reads a cookie.
* **Nothing is stored.** Client ids, codes, access and refresh tokens are `base64url(payload).base64url(HMAC-SHA256)`, with the key derived from the server secret and the hash of the password. Each carries a type, so one kind can't be used as another. Codes last 5 minutes, access tokens 1 hour, refresh tokens 30 days, rotated on use. Changing the password changes the key and revokes everything.
* **Open instance:** every OAuth endpoint answers `404`, and `/mcp` never answers `401`.

Not done, on purpose: CIMD (it needs fetches of client-chosen URLs, with the SSRF guards that come with them; DCR is deprecated in 2026-07-28 but still allowed, and what trilium-mcp ships); dual-era support (more code for clients that will update); the v1 SDK (its express, hono and cors dependencies for a router we'd have to bridge to Next.js). Also out of scope: scopes, a revocation endpoint (changing the password revokes everything), a consent step separate from the password, read-id variants of the read tools, and per-feed passwords (#8).

### Consequences

* Good, because there is no new storage, secret or setting: the password and the existing server secret are enough, and a restart or a second instance with the same secret keeps clients logged in.
* Good, because the endpoint and the HTTP API share one write path and one set of limits.
* Good, because the SDK's only dependency is `zod`, which notefeed already uses.
* Bad, because single use of codes and refresh-token rotation rest on an in-memory set of used `jti` values. After a restart, a code or refresh token that was already used can be replayed once within its lifetime (5 minutes, 30 days). Persisting the set in `DATA_DIR` would close that.
* Bad, because open registration lets anyone mint a client with a name and redirect URIs of their choosing, and send someone a login link that shows that name. The page therefore shows the client's name and the host it returns to, and sends `Content-Security-Policy: frame-ancestors 'none'` so it can't be framed. A user who enters the password for a client they don't recognize still hands it a code for their notes.
* Bad, because only 2026-07-28 clients connect; older ones must be updated.
* Bad, because tokens can't be revoked one by one: the only revocation is changing the password, which signs out every client and every browser.

### Confirmation

Vitest runs the protocol, tools, auth gate and the full OAuth flow in-process (`backend/mcp.test.ts`, `backend/oauth/`), including the refusals: tampered client id, unregistered redirect URI, wrong verifier, expired or reused code, wrong resource, reused refresh token, changed password, open instance. Playwright posts over `/mcp` against the production build and shows the note on its feed page, which also proves the SDK bundles into the standalone output, and walks the login page on a locked instance. A Claude.ai connector against a locked instance is checked by hand after deploying.
