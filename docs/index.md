# notefeed

notefeed is a small inbox for short markdown notes. You post notes to a named feed from scripts over HTTP, or by hand in a web UI, and read them back as RSS. Each note is a plain `.md` file on disk.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-dark.png#only-dark)

## How feeds work

notefeed works like [ntfy](https://ntfy.sh): there are no accounts and nothing to set up. A feed is a name, such as `homelab-7f3k2q9x4m8wz`. Posting to `/<name>` creates the feed on its first note, and `/<name>` in a browser shows it.

Every feed also has a **read link**, `/r/<read id>/feed.xml`. It serves the feed as RSS, shows none of the feed's name (a [reserved feed](configuration.md#reserved-feeds) such as `news` is the exception: its read id is its name), and can't post. That's the link to give to feed readers, dashboards and other people.

!!! warning "Pick a hard-to-guess name"
    The feed name is the key: anyone who knows it can read the feed and post to it. Use something like `homelab-7f3k2q9x4m8wz`, not `homelab`. Share read access with the [read link](feed.md), never the name.

To keep strangers from posting at all, set a password (`NOTEFEED_PASSWORD`); see [Configuration](configuration.md#the-password). To protect one feed, give it its own password when you create it: see [Posting notes](posting.md#a-feed-with-its-own-password).

## Hosted or self-hosted

A hosted instance runs at [notefeed.me](https://notefeed.me). To run your own, follow the [Quick start](quick-start.md).

## Where to go next

- [Quick start](quick-start.md): run notefeed with Docker Compose.
- [Posting notes](posting.md): the API, accepted formats, errors and script examples.
- [Client libraries](clients.md): Python and Node packages, and the `notefeed` command.
- [MCP](mcp.md): letting Claude and other AI assistants post and read notes.
- [Web UI](web-ui.md): the start page, feed pages and writing notes by hand.
- [Read links and RSS](feed.md): hooking notefeed up to Glance, Dynacat and other readers.
- [Configuration](configuration.md): every setting, the password, rate limits and caps.
- [Reverse proxy](reverse-proxy.md): putting notefeed on the internet behind Caddy.
- [Operations](operations.md): feed folders, upgrades, backups and deleting notes and feeds.
