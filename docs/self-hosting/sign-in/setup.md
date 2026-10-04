# Sign-in setup

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

You also need [`PUBLIC_URL`](../configuration.md#public_url), because the redirect URI is `<PUBLIC_URL>/api/oidc/callback`, and `NOTEFEED_SECRET`, which signs the sign-in cookies. Register that redirect URI with the provider.

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

That is the simple case with one provider. To offer more than one, see [Several providers](providers.md#several-providers). Other providers work the same way: see [Other providers](providers.md#other-providers) for their issuer URLs, and [URLs and what the provider needs](#urls-and-what-the-provider-needs) for everything the provider has to support.

## URLs and what the provider needs

Everything below is built from your [`PUBLIC_URL`](../configuration.md#public_url), here `https://notes.example.com`, and from your provider's issuer URL. With [several providers](providers.md#several-providers) the same applies to each one.

| What | URL | Where it goes |
|---|---|---|
| Redirect URI | `https://notes.example.com/api/oidc/callback` | One for all providers: register it at each provider, as its only redirect (callback) URI. It must match exactly: scheme, host, port, path, and no trailing slash. |
| Issuer | the provider's issuer URL, for example `https://authentik.example.com/application/o/notefeed/` | `NOTEFEED_OIDC_ISSUER`. |
| Discovery document | `<issuer>/.well-known/openid-configuration` | notefeed reads it to find the provider's authorize and token endpoints. Nothing to register. |
| Sign-in start | `https://notes.example.com/api/oidc/start` | What the **Sign in with** buttons open, one per provider. Nothing to register. |
| MCP endpoint and its OAuth URLs | `/mcp`, `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`, all under `PUBLIC_URL` | notefeed is the OAuth server for MCP clients, so the provider never sees them. The provider still only needs the one redirect URI above, and an [MCP client](../../integrations/mcp.md) needs no extra setup there. |

The provider has to support:

- The **authorization code flow with PKCE** (`S256`), for a **confidential** client (one with a client secret).
- Client authentication with the secret **in the token request body** (`client_secret_post`). A provider that defaults to HTTP Basic authentication (`client_secret_basic`) needs the client switched to `client_secret_post`.
- The scopes `openid profile email`.
- An `id_token` from the token endpoint that carries `iss`, `aud` (your client id), `exp`, `nonce` and the claim for the sender. notefeed reads the claims from the `id_token` only and never calls the user-info endpoint, so a provider that leaves `name` or `email` out of the `id_token` needs a setting to include them, or a different [`NOTEFEED_OIDC_SENDER_CLAIM`](#setup).
- For an allow-list of addresses or domains, the `email` and `email_verified` claims.

Two details trip people up:

- `NOTEFEED_OIDC_ISSUER` must equal the `issuer` value in the discovery document: scheme, host, port and path. Only one trailing slash may differ, so `https://authentik.example.com/application/o/notefeed` and `.../notefeed/` both work. Copy it from the document to be sure.
- The redirect URI is built from `PUBLIC_URL`. Without it notefeed uses the `Host` header the request arrived with, and `http` unless `NOTEFEED_TRUST_PROXY` is set, which behind a proxy gives a redirect URI the provider rejects. Set `PUBLIC_URL` to the address people really use, see [Reverse proxy](../reverse-proxy.md).

For a try-out on your own machine, `http://localhost:3000` works as `PUBLIC_URL`, with the redirect URI `http://localhost:3000/api/oidc/callback`, if the provider accepts a plain-http redirect for localhost.

## Check that it works

1. Open `<issuer>/.well-known/openid-configuration` in a browser, or run `curl -s <issuer>/.well-known/openid-configuration | jq -r .issuer`. It must return JSON whose `issuer` is what you set in `NOTEFEED_OIDC_ISSUER`, apart from at most one trailing slash.
2. Restart notefeed and open `https://notes.example.com/login`. There is a **Sign in with** button for each provider, named after its `_LABEL` or its host. If one is missing, one of that provider's four variables is empty or unset.
3. Click one and sign in at the provider. You land back on notefeed, signed in.
4. Post a note from the web UI. It shows **by** and your name or address next to the time.
5. Optional: connect an [MCP client](../../integrations/mcp.md). Its authorize page has the same buttons.
