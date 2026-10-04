# The sender

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

A feed's **Show who posted** setting (`show_sender` in the [settings API](../../using/feeds.md#feed-settings-in-the-api)) is on by default. Turn it off and the sender is left out of the public read view, the RSS feed and the public read API. The feed page and the API behind your password still show it. The setting applies when a note is shown, not when it is written, so it also covers existing notes, and turning it back on shows them again.

!!! warning "A copy can't be recalled"
    A note already fetched by an RSS reader, cached or archived keeps the sender it had. Turning the setting off hides it from now on, nothing more.

## Scripts and passwords

`NOTEFEED_PASSWORD` keeps working as a bearer token for scripts and the REST API. A note posted with the password has no sender. Sign-in does not give scripts anything: with sign-in alone (no password), the instance is locked to signed-in people, who get browsers and MCP clients, and scripts can't post. Set a password as well if scripts need to.

## MCP

On the OAuth authorize page that MCP clients such as Claude.ai open, there is a **Sign in with** button for each provider next to the password field. A client authorised that way posts with the person's sender. See [MCP](../../integrations/mcp.md).

## Removing a person

Take them off the allow-list (`NOTEFEED_OIDC_ALLOW`, or `NOTEFEED_OIDC_<NAME>_ALLOW` for a named provider) and restart: they can no longer sign in. What they already signed in with runs out within 7 days on every path: browser sessions expire then, and MCP clients authorised through the provider must sign in again after the same 7 days (their last access token works up to an hour longer). Turning sign-in off ends those MCP clients at their next token refresh. To sign everyone out at once, change `NOTEFEED_SECRET`; on an instance that also has a password, changing `NOTEFEED_PASSWORD` works too (see below). Their notes keep the `sender` line until you delete the notes or edit that line out of the note files. There are no user records to delete. Removing a provider's variables stops new sign-ins through it, but sign-ins already made through it stay valid until they expire (up to 7 days, MCP clients until their sign-in limit); change `NOTEFEED_SECRET` to sign everybody out at once.

## Limits

- Removing a provider's variables stops new sign-ins through it, but sign-ins already made through it stay valid until they expire (up to 7 days, MCP clients until their sign-in limit). Change `NOTEFEED_SECRET` to sign everybody out at once.
- The provider must use `https`. Plain `http` is accepted only for a loopback address such as `localhost`, for testing.
- A sign-in lasts 7 days, in the browser and for an MCP client, then the person signs in again.
- Sessions are signed with a key derived from the server secret and the password, so changing `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out.
- Failed sign-ins count toward the [rate limit](../limits.md#rate-limits-and-caps). Without `NOTEFEED_TRUST_PROXY`, all clients share one bucket.
- A note file stored by an older notefeed (it has no header) whose first lines are `---`, then only `key: <JSON>` lines or nothing, then `---` reads as having a header: that part is hidden from the displayed body (the file is untouched), and a `sender: "X"` line in it reads as a note from `X`, with sign-in on or off. A legacy note starting `---` and `---` loses that pair from the displayed body. Notes written since always start with the header, so text typed into a note can never read as a sender or other metadata.

## Privacy page and imprint

A sender name or e-mail address is personal data, and as the operator you are its controller. Before you switch sign-in on, check that your privacy page and imprint say that notes carry the signed-in person's name, e-mail or other identifier, as configured, that it is shown on the public read link and in RSS unless the feed hides it, and how a person can have it removed.
