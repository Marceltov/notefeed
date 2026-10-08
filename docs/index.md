# notefeed

notefeed is a small inbox for short markdown notes. You post notes to a named feed from scripts over HTTP, or by hand in a web UI, and read them back as RSS. Each note is a plain `.md` file on disk, starting with a small `---` header block.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-dark.png#only-dark)

notefeed is private by default and stores nothing about a person. [Sign-in with a verified sender](self-hosting/sign-in/index.md) is opt-in.

## Hosted or self-hosted

The [hosted service](hosted.md) runs at [notefeed.me](https://notefeed.me): nothing to install, open it and post. To run your own, follow the [Quick start](get-started/quick-start.md).

## Where to go next

- **Hosted service:** [what notefeed.me is](hosted.md), who runs it and where your data is.
- **Get started:** [Quick start](get-started/quick-start.md) runs notefeed with Docker Compose; [Concepts](get-started/concepts.md) explains feeds, names and read links.
- **Using notefeed:** the [web UI](using/web-ui.md), [posting notes](using/posting.md), [pictures](using/pictures.md), [feeds](using/feeds.md) and how to [read them back](using/read-links.md) in Glance, Dynacat and other readers.
- **Integrations:** [client libraries](integrations/clients.md) and the [command line](integrations/cli.md), the [REST API](integrations/api.md) and [MCP](integrations/mcp.md) for AI assistants.
- **Self-hosting:** [configuration](self-hosting/configuration.md), [passwords and access](self-hosting/access.md), a [reverse proxy](self-hosting/reverse-proxy.md), [storage](self-hosting/storage.md), [backups](self-hosting/backups.md), [metrics](self-hosting/metrics.md) and [logs](self-hosting/logs.md).
