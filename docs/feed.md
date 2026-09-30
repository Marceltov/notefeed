# Read links and RSS

Every feed has a **read link**:

```
https://notes.example.com/r/<read id>/feed.xml
```

The read id is 22 characters derived from the feed's name, e.g. `q2Zc9kD0bTnVx4LmAe7sWp`. You find the link on the feed page, and in every `POST /<feed>` answer as `read_url`.

A read link:

- serves the feed as RSS 2.0 (`/r/<read id>/feed.xml`) and as a read-only web page (`/r/<read id>`),
- never shows the feed's name, so it can't be turned into write access,
- can't post,
- needs no login, even when the instance has a password.

That makes it the link to give to feed readers, dashboards and other people. Keep the feed name itself to the scripts that post.

!!! note "An unknown read link shows an empty feed"
    A read link that doesn't belong to any feed answers with an empty feed, not an error. That's on purpose: nobody can probe which read links exist, and you can subscribe to a feed's read link before its first note. A read link that isn't 22 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `_` is a `404`.

!!! warning "The secret behind read links"
    Read ids are computed from the feed name and a server secret: `NOTEFEED_SECRET` if set, otherwise a random one that notefeed creates once in `DATA_DIR/.secret`. Changing `NOTEFEED_SECRET`, or deleting `.secret` without setting it, **changes every read link**, and readers must resubscribe. Back up `.secret` with your notes. See [Configuration](configuration.md).

## What's in the feed

The RSS feed holds the newest 50 notes. Its title is `NOTEFEED_TITLE` (`notefeed` by default). Each item has:

- the note's title
- a link to the note's read-only page, `<PUBLIC_URL>/r/<read id>/<id>`
- the time it was posted
- the note's raw markdown as its description

Control characters that XML doesn't allow (such as terminal colour codes from script output) are removed from the feed so one note can't break it. The file on disk keeps them.

!!! note "Links need the right public address"
    Links are built from `PUBLIC_URL`, or from the request when it's unset. If a reader fetches the feed over a LAN address, set `PUBLIC_URL` so links still point at the public site. See [Configuration](configuration.md).

## Glance and Dynacat

Add an `rss` widget to a page, with the feed's read link:

```yaml
- type: rss
  title: Homelab
  limit: 15
  collapse-after: 5
  cache: 5m
  feeds:
    - url: http://192.168.1.10:3000/r/q2Zc9kD0bTnVx4LmAe7sWp/feed.xml
      title: notefeed
```

`cache: 5m` keeps new notes showing up within minutes. The widget shows titles and times; the raw markdown isn't rendered there. For several feeds, list several read links.

## Other readers

Any RSS reader works (Miniflux, FreshRSS, NetNewsWire, and so on). Subscribe to the read link.
