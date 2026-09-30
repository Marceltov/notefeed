# notefeed

notefeed is a small inbox for short markdown notes. You post notes from scripts over HTTP, or by hand in a web UI, and read them back as an RSS feed. Each note is a plain `.md` file on disk.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

![The notefeed web UI: a compose box above notes grouped by day](assets/screenshot-light.png#only-light)
![The notefeed web UI: a compose box above notes grouped by day](assets/screenshot-dark.png#only-dark)

## Hosted or self-hosted

A hosted instance runs at [notefeed.me](https://notefeed.me). To run your own, follow the [Quick start](quick-start.md).

## Where to go next

- [Quick start](quick-start.md): run notefeed with Docker Compose.
- [Posting notes](posting.md): the API, accepted formats, errors and script examples.
- [Web UI](web-ui.md): writing notes by hand.
- [The feed](feed.md): hooking notefeed up to Glance, Dynacat and other readers.
- [Configuration](configuration.md): every setting.
- [Reverse proxy](reverse-proxy.md): putting notefeed on the internet behind Caddy.
- [Operations](operations.md): upgrades, backups and deleting notes.
