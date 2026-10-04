# Sign-in and sender

!!! info "notefeed is private by default"
    notefeed stores nothing about a person: no accounts, no profiles, no names. Sign-in is **opt-in**, and only the `NOTEFEED_OIDC_*` environment variables (see [Setup](setup.md)) switch it on. With them unset, nobody can sign in and no new note gets a sender; senders stored while sign-in was on stay on their notes and keep showing.

With sign-in on, people log in through your own OpenID Connect provider (Authentik, Keycloak and the like), or through several providers at once, instead of sharing the instance password, and the notes they post carry their name as a **sender**. It only adds to what notefeed does: read links, RSS, feed passwords and licences work as before.

## When you might want it

- A team shares one instance and wants to see who posted what.
- You'd rather give people a login through your provider than hand out the instance password.
- You use [MCP](../../integrations/mcp.md) clients and want each person to authorise with their own account.

If none of these applies, leave it off. A single person, or scripts posting to feeds, need nothing from sign-in.

Next: [Setup](setup.md), then [Providers](providers.md) for more than one. [The sender](sender.md) covers what is stored about a person, and [Troubleshooting](troubleshooting.md) what to do when a sign-in fails.
