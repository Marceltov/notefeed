# Sign-in and sender

!!! info "notefeed is private by default"
    notefeed stores nothing about a person: no accounts, no profiles, no names. Sign-in on this page is **opt-in**, and only the `NOTEFEED_OIDC_*` environment variables below switch it on. With them unset, nobody can sign in and no new note gets a sender; senders stored while sign-in was on stay on their notes and keep showing.

With sign-in on, people log in through your own OpenID Connect provider (Authentik, Keycloak and the like), or through several providers at once, instead of sharing the instance password, and the notes they post carry their name as a **sender**. It only adds to what notefeed does: read links, RSS, feed passwords and licences work as before.

## When you might want it

- A team shares one instance and wants to see who posted what.
- You'd rather give people a login through your provider than hand out the instance password.
- You use [MCP](mcp.md) clients and want each person to authorise with their own account.

If none of these applies, leave it off. A single person, or scripts posting to feeds, need nothing from this page.

## Setup

Set the first four variables. The mode is on only when all four are set; with one missing it stays off. The fifth is optional.

| Variable | Meaning |
|---|---|
| `NOTEFEED_OIDC_ISSUER` | The provider's issuer URL. notefeed finds the rest from `<issuer>/.well-known/openid-configuration`. |
| `NOTEFEED_OIDC_CLIENT_ID` | The client id the provider gave notefeed. |
| `NOTEFEED_OIDC_CLIENT_SECRET` | The client secret the provider gave notefeed. |
| `NOTEFEED_OIDC_ALLOW` | Who may sign in: comma-separated e-mail addresses, `@domain` entries, or `*`. |
| `NOTEFEED_OIDC_SENDER_CLAIM` | Optional, default `name,email`. Comma-separated id_token claims tried in order; the first non-empty string is the sender. It is shown on notes and stored in the note file, so pick a claim that is fine to publish: `sub` is stable but opaque, `email` exposes an address. It does not switch sign-in on and does not change who may sign in. |

The allow-list is required and is matched case-insensitively:

- `ann@example.com` allows that address.
- `@example.com` allows every address at that domain.
- `*` allows anyone your provider authenticates. Use it only when the provider itself decides who has an account.
- An empty list refuses everyone.

When the list matches by e-mail address, the provider must report the address as verified (`email_verified`).

You also need [`PUBLIC_URL`](configuration.md#public_url), because the redirect URI is `<PUBLIC_URL>/api/oidc/callback`, and `NOTEFEED_SECRET`, which signs the sign-in cookies. Register that redirect URI with the provider.

```yaml
environment:
  PUBLIC_URL: https://notes.example.com
  NOTEFEED_SECRET: ${NOTEFEED_SECRET}
  NOTEFEED_OIDC_ISSUER: https://authentik.example.com/application/o/notefeed/
  NOTEFEED_OIDC_CLIENT_ID: ${NOTEFEED_OIDC_CLIENT_ID}
  NOTEFEED_OIDC_CLIENT_SECRET: ${NOTEFEED_OIDC_CLIENT_SECRET}
  NOTEFEED_OIDC_ALLOW: "@example.com,guest@example.org"
```

### Example: Authentik

1. In Authentik, create an **OAuth2/OpenID provider**. Set the client type to confidential, and the redirect URI to `https://notes.example.com/api/oidc/callback` (your `PUBLIC_URL` plus `/api/oidc/callback`).
2. Under scopes, select `openid`, `profile` and `email`.
3. Create an **application** that uses the provider, with the slug `notefeed`.
4. Copy the client id and client secret into `NOTEFEED_OIDC_CLIENT_ID` and `NOTEFEED_OIDC_CLIENT_SECRET`.
5. Set `NOTEFEED_OIDC_ISSUER` to the issuer of the application's OpenID configuration, for example `https://authentik.example.com/application/o/notefeed/`.

That is the simple case with one provider. To offer more than one, see [Several providers](#several-providers). Other providers work the same way: see [Other providers](#other-providers) for their issuer URLs, and [URLs and what the provider needs](#urls-and-what-the-provider-needs) for everything the provider has to support.

## Several providers

You can add as many providers as you like, for example one for your team and one for guests. Each provider is its own set of variables, with a name of your choosing in them: `NOTEFEED_OIDC_<NAME>_ISSUER` and so on. The single-provider setup above keeps working unchanged.

Nothing is predefined. `<NAME>` is any name you pick from capital letters, digits and underscores (`WORK`, `GUESTS`, `MY_IDP`), not a list of supported providers: notefeed finds your providers by looking for these variables. Authentik, Google and the others on this page are only examples of what you can connect.

| Variable | Meaning |
|---|---|
| `NOTEFEED_OIDC_<NAME>_ISSUER` | The provider's issuer URL. |
| `NOTEFEED_OIDC_<NAME>_CLIENT_ID` | The client id the provider gave notefeed. |
| `NOTEFEED_OIDC_<NAME>_CLIENT_SECRET` | The client secret the provider gave notefeed. |
| `NOTEFEED_OIDC_<NAME>_ALLOW` | Who may sign in through this provider, in the same form as `NOTEFEED_OIDC_ALLOW`. |
| `NOTEFEED_OIDC_<NAME>_SENDER_CLAIM` | Optional, default `name,email`, as `NOTEFEED_OIDC_SENDER_CLAIM`. |
| `NOTEFEED_OIDC_<NAME>_LABEL` | Optional. The text of the button: **Sign in with** plus this label. Without it the label is the provider's host. |

- A provider is active only when its issuer, client id, client secret and allow-list are all set. With one of them missing or the allow-list empty, that provider is left out and the others still work.
- The unprefixed variables (`NOTEFEED_OIDC_ISSUER` and the rest, with `NOTEFEED_OIDC_LABEL` for its label) are one more provider, called `default`. The name `DEFAULT` is therefore reserved and ignored.
- A name must be capital letters and digits, separated by single underscores. A name with a lowercase letter or a hyphen is not recognised.
- Every provider has its own allow-list and its own sender claim. Someone on one provider's list can't sign in through another provider unless that one lists them too.
- The login page shows one **Sign in with** button per provider: the default one first, then the others in alphabetical order of their names.
- All providers share one redirect URI, `<PUBLIC_URL>/api/oidc/callback`. Register that same URI at each provider.

This example has two providers, `WORK` and `GUESTS`. The names are only examples, pick your own:

```yaml
environment:
  PUBLIC_URL: https://notes.example.com
  NOTEFEED_SECRET: ${NOTEFEED_SECRET}
  NOTEFEED_OIDC_WORK_ISSUER: https://authentik.example.com/application/o/notefeed/
  NOTEFEED_OIDC_WORK_CLIENT_ID: ${NOTEFEED_OIDC_WORK_CLIENT_ID}
  NOTEFEED_OIDC_WORK_CLIENT_SECRET: ${NOTEFEED_OIDC_WORK_CLIENT_SECRET}
  NOTEFEED_OIDC_WORK_ALLOW: "@example.com"
  NOTEFEED_OIDC_WORK_LABEL: Example Corp
  NOTEFEED_OIDC_GUESTS_ISSUER: https://accounts.google.com
  NOTEFEED_OIDC_GUESTS_CLIENT_ID: ${NOTEFEED_OIDC_GUESTS_CLIENT_ID}
  NOTEFEED_OIDC_GUESTS_CLIENT_SECRET: ${NOTEFEED_OIDC_GUESTS_CLIENT_SECRET}
  NOTEFEED_OIDC_GUESTS_ALLOW: "guest@example.org"
  NOTEFEED_OIDC_GUESTS_SENDER_CLAIM: email
```

The login page then offers **Sign in with Example Corp** and **Sign in with accounts.google.com**.

## URLs and what the provider needs

Everything below is built from your [`PUBLIC_URL`](configuration.md#public_url), here `https://notes.example.com`, and from your provider's issuer URL. With [several providers](#several-providers) the same applies to each one.

| What | URL | Where it goes |
|---|---|---|
| Redirect URI | `https://notes.example.com/api/oidc/callback` | One for all providers: register it at each provider, as its only redirect (callback) URI. It must match exactly: scheme, host, port, path, and no trailing slash. |
| Issuer | the provider's issuer URL, for example `https://authentik.example.com/application/o/notefeed/` | `NOTEFEED_OIDC_ISSUER`. |
| Discovery document | `<issuer>/.well-known/openid-configuration` | notefeed reads it to find the provider's authorize and token endpoints. Nothing to register. |
| Sign-in start | `https://notes.example.com/api/oidc/start` | What the **Sign in with** buttons open, one per provider. Nothing to register. |
| MCP endpoint and its OAuth URLs | `/mcp`, `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`, all under `PUBLIC_URL` | notefeed is the OAuth server for MCP clients, so the provider never sees them. The provider still only needs the one redirect URI above, and an [MCP client](mcp.md) needs no extra setup there. |

The provider has to support:

- The **authorization code flow with PKCE** (`S256`), for a **confidential** client (one with a client secret).
- Client authentication with the secret **in the token request body** (`client_secret_post`). A provider that defaults to HTTP Basic authentication (`client_secret_basic`) needs the client switched to `client_secret_post`.
- The scopes `openid profile email`.
- An `id_token` from the token endpoint that carries `iss`, `aud` (your client id), `exp`, `nonce` and the claim for the sender. notefeed reads the claims from the `id_token` only and never calls the user-info endpoint, so a provider that leaves `name` or `email` out of the `id_token` needs a setting to include them, or a different [`NOTEFEED_OIDC_SENDER_CLAIM`](#setup).
- For an allow-list of addresses or domains, the `email` and `email_verified` claims.

Two details trip people up:

- `NOTEFEED_OIDC_ISSUER` must equal the `issuer` value in the discovery document: scheme, host, port and path. Only one trailing slash may differ, so `https://authentik.example.com/application/o/notefeed` and `.../notefeed/` both work. Copy it from the document to be sure.
- The redirect URI is built from `PUBLIC_URL`. Without it notefeed uses the `Host` header the request arrived with, and `http` unless `NOTEFEED_TRUST_PROXY` is set, which behind a proxy gives a redirect URI the provider rejects. Set `PUBLIC_URL` to the address people really use, see [Reverse proxy](reverse-proxy.md).

For a try-out on your own machine, `http://localhost:3000` works as `PUBLIC_URL`, with the redirect URI `http://localhost:3000/api/oidc/callback`, if the provider accepts a plain-http redirect for localhost.

## Other providers

This table lists examples only: notefeed has no built-in list, and any OpenID Connect provider works. These are the usual issuer URLs. Your provider's discovery document is the authority: open `<issuer>/.well-known/openid-configuration` and use its `issuer`.

| Provider | Issuer | Notes |
|---|---|---|
| Authentik | `https://authentik.example.com/application/o/<slug>/` | The document's issuer ends in a slash; setting it with or without one works. See the [example](#example-authentik). |
| Keycloak | `https://keycloak.example.com/realms/<realm>` | Older versions have `/auth` before `/realms`. Create an OpenID Connect client with **Client authentication** on and the standard flow enabled. |
| Authelia | `https://auth.example.com` | Set the client's `token_endpoint_auth_method` to `client_secret_post`; Authelia defaults to `client_secret_basic`. |
| Google | `https://accounts.google.com` | Create an OAuth client of type **Web application** and add the redirect URI. Use an address or domain allow-list, not `*`: `*` would let any Google account sign in. |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` | Register the redirect URI under the **Web** platform. Entra may leave `email` or `email_verified` out of the `id_token`; check yours. If it does, address and domain entries can't match, so restrict who may use the app in Entra and set `NOTEFEED_OIDC_ALLOW` to `*`, or use `preferred_username` as [`NOTEFEED_OIDC_SENDER_CLAIM`](#setup). |

## Check that it works

1. Open `<issuer>/.well-known/openid-configuration` in a browser, or run `curl -s <issuer>/.well-known/openid-configuration | jq -r .issuer`. It must return JSON whose `issuer` is what you set in `NOTEFEED_OIDC_ISSUER`, apart from at most one trailing slash.
2. Restart notefeed and open `https://notes.example.com/login`. There is a **Sign in with** button for each provider, named after its `_LABEL` or its host. If one is missing, one of that provider's four variables is empty or unset.
3. Click one and sign in at the provider. You land back on notefeed, signed in.
4. Post a note from the web UI. It shows **by** and your name or address next to the time.
5. Optional: connect an [MCP client](mcp.md). Its authorize page has the same buttons.

## What is stored

Every note file starts with a small `---` header block, with sign-in on or off: empty (`---` then `---`) for a note without a sender. For a note posted by a signed-in person the sender is one line in that header, and nothing else is stored about them. Note files written before this are untouched. The body follows the header exactly as posted:

```markdown
---
sender: "Ann Example"
---
The deploy finished.
```

The sender is the first non-empty claim of `NOTEFEED_OIDC_SENDER_CLAIM` in the provider's id_token (control and text-direction override characters in it are replaced by spaces, as in a note's title), by default the `name` claim, or the e-mail address when there is no name. There is no user table, no session list and no record of who signed in. The sign-in itself is a signed cookie in the person's browser.

## Where the sender is shown

The sender shows on the feed page, in the note's read view, in the RSS item (as `<dc:creator>`) and in the API's note JSON as `sender`, which is absent when a note has none. The sign-in page and the compose area tell people: "Your name is shown on your notes, including on the public read link and RSS."

A feed's **Show who posted** setting (`show_sender` in the [settings API](posting.md#feed-settings-and-deleting-a-feed)) is on by default. Turn it off and the sender is left out of the public read view, the RSS feed and the public read API. The feed page and the API behind your password still show it. The setting applies when a note is shown, not when it is written, so it also covers existing notes, and turning it back on shows them again.

!!! warning "A copy can't be recalled"
    A note already fetched by an RSS reader, cached or archived keeps the sender it had. Turning the setting off hides it from now on, nothing more.

## Scripts and passwords

`NOTEFEED_PASSWORD` keeps working as a bearer token for scripts and the REST API. A note posted with the password has no sender. Sign-in does not give scripts anything: with sign-in alone (no password), the instance is locked to signed-in people, who get browsers and MCP clients, and scripts can't post. Set a password as well if scripts need to.

## MCP

On the OAuth authorize page that MCP clients such as Claude.ai open, there is a **Sign in with** button for each provider next to the password field. A client authorised that way posts with the person's sender. See [MCP](mcp.md).

## Removing a person

Take them off the allow-list (`NOTEFEED_OIDC_ALLOW`, or `NOTEFEED_OIDC_<NAME>_ALLOW` for a named provider) and restart: they can no longer sign in. What they already signed in with runs out within 7 days on every path: browser sessions expire then, and MCP clients authorised through the provider must sign in again after the same 7 days (their last access token works up to an hour longer). Turning sign-in off ends those MCP clients at their next token refresh. To sign everyone out at once, change `NOTEFEED_SECRET`; on an instance that also has a password, changing `NOTEFEED_PASSWORD` works too (see below). Their notes keep the `sender` line until you delete the notes or edit that line out of the note files. There are no user records to delete. Removing a provider's variables stops new sign-ins through it, but sign-ins already made through it stay valid until they expire (up to 7 days, MCP clients until their sign-in limit); change `NOTEFEED_SECRET` to sign everybody out at once.

## Limits

- Removing a provider's variables stops new sign-ins through it, but sign-ins already made through it stay valid until they expire (up to 7 days, MCP clients until their sign-in limit). Change `NOTEFEED_SECRET` to sign everybody out at once.
- The provider must use `https`. Plain `http` is accepted only for a loopback address such as `localhost`, for testing.
- A sign-in lasts 7 days, in the browser and for an MCP client, then the person signs in again.
- Sessions are signed with a key derived from the server secret and the password, so changing `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out.
- Failed sign-ins count toward the [rate limit](configuration.md#rate-limits-and-caps). Without `NOTEFEED_TRUST_PROXY`, all clients share one bucket.
- A note file stored by an older notefeed (it has no header) whose first lines are `---`, then only `key: <JSON>` lines or nothing, then `---` reads as having a header: that part is hidden from the displayed body (the file is untouched), and a `sender: "X"` line in it reads as a note from `X`, with sign-in on or off. A legacy note starting `---` and `---` loses that pair from the displayed body. Notes written since always start with the header, so text typed into a note can never read as a sender or other metadata.

## Logs

notefeed logs one line for each failed sign-in, at level `warn` with `"component":"oidc"`: the `msg` is the step that failed, and fields add, where it helps, the provider (`provider`), the issuer (`issuer`, without any user, password or query part), the HTTP status (`status`) or a short error code (`error`). It never logs a secret, token, e-mail address or name, and never echoes text from the request: the `unknown provider` line carries the requested provider id only when it looks like one (lowercase letters, digits and underscores). A sign-in refused because of [too many failed attempts](configuration.md#rate-limits-and-caps) is not logged, since that check comes first. A sign-in that works logs `sign-in succeeded` at level `info` with the provider id only, never who signed in. For example:

```json
{"level":"warn","time":"2026-10-02T09:14:03.512Z","component":"oidc","provider":"default","status":401,"error":"invalid_client","msg":"token request rejected"}
```

Read them with `docker compose logs notefeed`, or your container runtime's equivalent, for example `docker compose logs notefeed | grep '"component":"oidc"'`. See [Logs](operations.md#logs) for the format and the other lines.

## Troubleshooting

Every failed sign-in shows the same message, "Sign-in didn't work. Try again.", so start with the [logs](#logs): the `oidc` line's `msg` names the cause, see [What the log says](#what-the-log-says). To tell an allow-list problem from a provider problem, set `NOTEFEED_OIDC_ALLOW` to `*` for a moment: if signing in then works, the allow-list was the cause.

| What you see | Likely cause |
|---|---|
| No **Sign in with** button on the login page | One of the four variables is unset or empty, or `NOTEFEED_OIDC_ALLOW` is empty. |
| A button is missing for one provider | One of that provider's four variables is missing, or its allow-list is empty. The other providers are not affected. |
| A named provider doesn't show at all | Its name isn't recognised: it has a lowercase letter or a hyphen. Use capital letters, digits and underscores, as in `NOTEFEED_OIDC_MY_IDP_ISSUER`. |
| The provider shows a redirect or `redirect_uri` error before you return | The registered redirect URI differs from `<PUBLIC_URL>/api/oidc/callback`: scheme, host, port, path or a trailing slash. Behind a proxy, `PUBLIC_URL` is not set. |
| Back on notefeed with "Sign-in didn't work" | The issuer differs from the discovery document's `issuer` in more than one trailing slash: another scheme, host, port or path. |
| The same | The provider can't be reached from the notefeed container (DNS, a firewall, a certificate it doesn't trust), or its URLs are plain `http`. |
| The same | The person isn't on the allow-list, or the provider doesn't report their e-mail address as verified. |
| The same | The `id_token` has none of the sender claims, which by default are `name` and `email`. Check the scopes and the provider's claim settings, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |
| The same | The client secret is wrong, or the provider expects `client_secret_basic` instead of `client_secret_post`. |
| The same | The sign-in took longer than 10 minutes, or the browser blocks cookies. Try again. |
| The same, after many tries | Failed sign-ins count toward the [rate limit](configuration.md#rate-limits-and-caps). Wait a minute. |
| Signed out after a while, or after changing the password | Expected: a sign-in lasts 7 days, and a changed `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out. |
| A note has no sender | It was posted with the instance password or by a script, which never carries a sender. |

### What the log says

| `msg` | Cause | Fix |
|---|---|---|
| `unknown provider` | The sign-in named a provider that isn't configured (`provider` shows its id when it has a provider id's shape), or none while several are. | Use the buttons on the login page; check the provider's four variables. |
| `issuer is not an https URL` | `NOTEFEED_OIDC_ISSUER` is not a URL, or plain `http` on a host other than `localhost`. | Set the issuer to the `https` URL from the discovery document. |
| `discovery failed` with `status` | The discovery document answered with that HTTP status, or with something other than JSON (`"status":200` and `"error":"not a JSON object"`). | Open `<issuer>/.well-known/openid-configuration`; a 404 usually means a wrong issuer path. |
| `discovery failed` with `error` | The provider can't be reached from the notefeed container: `ENOTFOUND` (DNS), `ECONNREFUSED` (nothing listening), `CERT_HAS_EXPIRED` or another certificate error, `TimeoutError` (no answer within 10 seconds). | Fix DNS, the firewall or the certificate between notefeed and the provider. |
| `issuer does not match the discovery document` | The configured issuer (`issuer`) and the document's (`document`) differ in more than one trailing slash. | Copy the document's `issuer` into `NOTEFEED_OIDC_ISSUER`. |
| `discovery endpoint is not https` | The document's authorize or token endpoint, named by `endpoint`, is missing or plain `http`. | Serve the provider over `https`, or set its external URL so its endpoints use it. |
| `provider denied the sign-in` | The provider sent the person back with an error, such as `"error":"access_denied"` when they declined or aren't allowed in the provider. | Check the provider's own policies and logs for that person. |
| `state mismatch or missing sign-in cookie` | The sign-in cookie is missing, expired (after 10 minutes) or from another sign-in, or the browser blocks cookies. | Try again from the login page in one tab. |
| `no code in the callback` | The provider came back without an authorization code. | Check that the provider's client uses the authorization code flow. |
| `provider no longer configured` | The provider was removed or switched off while the sign-in was under way. | Try again; check that provider's variables. |
| `token request rejected` with `"error":"invalid_client"` | The client id or secret is wrong, or the provider expects `client_secret_basic`. | Copy the client id and secret again; switch the client to `client_secret_post`. |
| `token request rejected` with another `error` or `status` | `invalid_grant` usually means the redirect URI or the PKCE verifier didn't match, or the code was used already; a network `error` means the token endpoint can't be reached. | Check the redirect URI and that the provider supports PKCE `S256`. |
| `token response has no id_token` | The token endpoint answered without an `id_token`. | Make sure the client requests the `openid` scope and is an OpenID Connect client, not plain OAuth 2. |
| `id_token invalid` with `check` | The `id_token` failed one check: `iss` (another issuer), `aud` (another client id), `azp` (several audiences without this client as `azp`), `exp` (expired: check the server clocks), `nonce` (not the one sent), `malformed` (not a readable JWT). | Fix what the named check points to; for `iss`, the provider's issuer setting. |
| `person not on the allow-list` | The person's verified address matches no entry of that provider's allow-list. | Add the address or its `@domain` to the allow-list, if they should get in. |
| `address needs a verified email` | The allow-list matches by address, but the `id_token` has no `email`, or `email_verified` isn't `true`. | Have the provider include `email` and `email_verified` and verify the address, or use `*` with access restricted at the provider. |
| `no sender claim in the id_token` | None of the claims named by `claims` is a non-empty string in the `id_token`. | Add the `profile` and `email` scopes or claims at the provider, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |

## Privacy page and imprint

A sender name or e-mail address is personal data, and as the operator you are its controller. Before you switch sign-in on, check that your privacy page and imprint say that notes carry the signed-in person's name, e-mail or other identifier, as configured, that it is shown on the public read link and in RSS unless the feed hides it, and how a person can have it removed.
