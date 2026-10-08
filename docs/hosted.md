# The hosted service

You do not have to run notefeed yourself. A public instance runs at **[notefeed.me](https://notefeed.me)**: open it, pick a feed name and post.

It is the same software as in these docs, on the current release. Wherever an example says `https://notes.example.com`, use `https://notefeed.me`:

```sh
export NOTEFEED_URL=https://notefeed.me NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
```

## What to know before you use it

- **There are no accounts.** Nothing to register, and no instance password. The [feed name](get-started/concepts.md) is what lets someone read and post, so on an instance the whole internet can reach, pick a long name nobody can guess. A [feed password](using/feed-passwords.md) protects posting and the feed page on top of that.
- **Sign-in is off.** Notes carry no sender.
- **The standard limits apply:** the [rate limits and caps](self-hosting/limits.md) at their defaults.
- **Some feed names are taken by the operator**, as [reserved feeds](self-hosting/reserved-feeds.md).
- **It comes with no promise of availability.** It is run with care, with backups and monitoring, but by one person. For something you depend on, run your own.

## Who runs it and where your data is

notefeed.me is run by the author of notefeed, in Germany, on a server in a German data centre.

- **[Data privacy](https://notefeed.me/privacy):** what is stored, what the logs hold, how long backups keep a deleted feed, and your rights.
- **[Imprint](https://notefeed.me/imprint):** who is responsible and how to reach them.

Those two pages are the binding statement. These docs describe the software and do not repeat them.

## How it is run

The whole setup is public as a worked example: [notefeed/stacks](https://github.com/notefeed/stacks) holds the compose files of the server, with PostgreSQL, an S3-compatible [image store](self-hosting/storage.md) and Caddy in front. If you plan a public instance of your own, it is a place to start from.

## Hosted or your own

| | notefeed.me | Your own instance |
|---|---|---|
| Set-up | None | [Docker Compose](get-started/quick-start.md), a few minutes |
| Who can reach it | Anyone who knows a feed's name or read link | Whoever you let: your LAN, or behind an [instance password](self-hosting/access.md) |
| Where the notes are | On the service's server in Germany | On your disk, as plain `.md` files or in your database |
| Limits and settings | Fixed | [Yours to set](self-hosting/configuration.md) |
| Sender on notes | No | With [sign-in](self-hosting/sign-in/index.md), if you switch it on |

Moving later is possible in both directions: a feed is its notes, and the [API](integrations/api.md) reads and posts them.
