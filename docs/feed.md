# The feed

`/feed.xml` is an RSS 2.0 feed of the newest 50 notes. It needs no login, so any feed reader can fetch it.

Each item has:

- the note's title
- a link to the note's page, `<PUBLIC_URL>/n/<id>` (only viewable when logged in)
- the time it was posted
- the note's raw markdown as its description

Control characters that XML doesn't allow (such as terminal colour codes from script output) are removed from the feed so one note can't break it. The file on disk keeps them.

!!! note "Links need the right public address"
    Item links are built from `PUBLIC_URL`, or from the request when it's unset. If a reader fetches the feed over a LAN address, set `PUBLIC_URL` so links still point at the public site. See [Configuration](configuration.md).

## Glance and Dynacat

Add an `rss` widget to a page:

```yaml
- type: rss
  title: Notes
  limit: 15
  collapse-after: 5
  cache: 5m
  feeds:
    - url: http://192.168.1.10:3000/feed.xml
      title: notefeed
```

`cache: 5m` keeps new notes showing up within minutes. The widget shows titles and times; the raw markdown isn't rendered there.

## Other readers

Any RSS reader works (Miniflux, FreshRSS, NetNewsWire, and so on). Subscribe to `https://notes.example.com/feed.xml`.
