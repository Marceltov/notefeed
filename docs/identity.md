# Sign-in and sender

!!! info "notefeed is private by default" notefeed stores nothing about a person: no accounts, no profiles, no names. Sign-in on this page is **opt-in**, and only the four `NOTEFEED_OIDC_*` environment variables below switch it on. With them unset, nothing described on this page applies to your instance.

With sign-in on, people log in through your own OpenID Connect provider (Authentik, Keycloak and the like) instead of sharing the instance password, and the notes they post carry their name as a **sender**. It only adds to what notefeed does: read links, RSS, feed passwords and licences work as before.

## When you might want it

- A team shares one instance and wants to see who posted what.
- You'd rather give people a login through your provider than hand out the instance password.
- You use [MCP](mcp.md) clients and want each person to authorise with their own account.

If none of these applies, leave it off. A single person, or scripts posting to feeds, need nothing from this page.

## Setup

Set all four variables. The mode is on only when all four are set; with one missing it stays off.

| Variable | Meaning |
|---|---|
| `NOTEFEED_OIDC_ISSUER` | The provider's issuer URL. notefeed finds the rest from `<issuer>/.well-known/openid-configuration`. |
| `NOTEFEED_OIDC_CLIENT_ID` | The client id the provider gave notefeed. |
| `NOTEFEED_OIDC_CLIENT_SECRET` | The client secret the provider gave notefeed. |
| `NOTEFEED_OIDC_ALLOW` | Who may sign in: comma-separated e-mail addresses, `@domain` entries, or `*`. |

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

Other providers work the same way: any that supports OpenID Connect discovery, the authorization code flow and PKCE.

## What is stored

One line per note, and nothing else. A note posted by a signed-in person starts with a block in its `.md` file:

```markdown
---
sender: "Ann Example"
---
The deploy finished.
```

The sender is the provider's `name` claim, or the e-mail address when there is no name. There is no user table, no session list and no record of who signed in. The sign-in itself is a signed cookie in the person's browser.

## Where the sender is shown

The sender shows on the feed page, in the note's read view, in the RSS item (as `<dc:creator>`) and in the API's note JSON as `sender`, which is absent when a note has none. The sign-in page and the compose area tell people: "Your name is shown on your notes, including on the public read link and RSS."

A feed's **Show who posted** setting (`show_sender` in the [settings API](posting.md#feed-settings-and-deleting-a-feed)) is on by default. Turn it off and the sender is left out of the public read view, the RSS feed and the public read API. The feed page and the API behind your password still show it. The setting applies when a note is shown, not when it is written, so it also covers existing notes, and turning it back on shows them again.

!!! warning "A copy can't be recalled" A note already fetched by an RSS reader, cached or archived keeps the sender it had. Turning the setting off hides it from now on, nothing more.

## Scripts and passwords

`NOTEFEED_PASSWORD` keeps working as a bearer token for scripts and the REST API. A note posted with the password has no sender. Sign-in does not give scripts anything: with sign-in alone (no password), the instance is locked to signed-in people, who get browsers and MCP clients, and scripts can't post. Set a password as well if scripts need to.

## MCP

On the OAuth authorize page that MCP clients such as Claude.ai open, there is a **Sign in with** button (named after your provider) next to the password field. A client authorised that way posts with the person's sender. See [MCP](mcp.md).

## Removing a person

Take them off `NOTEFEED_OIDC_ALLOW` and restart: they can no longer sign in. Their existing browser sessions run until they expire, up to 7 days; to end them at once, change `NOTEFEED_PASSWORD` (see below). Their notes keep the `sender` line until you delete the notes or edit that line out of the note files. There are no user records to delete.

## Limits

- The provider must use `https`. Plain `http` is accepted only for a loopback address such as `localhost`, for testing.
- A sign-in lasts 7 days, then the person signs in again.
- Sessions are signed with a key derived from the server secret and the password, so changing `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out.
- Failed sign-ins count toward the [rate limit](configuration.md#rate-limits-and-caps). Without `NOTEFEED_TRUST_PROXY`, all clients share one bucket.
- Enabling sign-in on a data directory whose notes came from people you don't trust: a typed note that is exactly `---`, a `sender: "X"` line and `---` reads as a note from `X`. Notes posted while sign-in was off can't be told apart from typed ones.

## Privacy page and imprint

A sender name or e-mail address is personal data, and as the operator you are its controller. Before you switch sign-in on, check that your privacy page and imprint say that notes carry the signed-in person's name or e-mail, that it is shown on the public read link and in RSS unless the feed hides it, and how a person can have it removed.
