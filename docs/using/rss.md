# RSS and dashboards

## Title and description

A feed can have a title, a description and a title image, which anyone with the read link can see: they are the RSS channel's title and description, and they show above the notes in the read-only view. They are [set with the feed's settings](feeds.md#feed-settings-in-the-api). Don't put anything private in them. The feed's name is never shown. The title image is the RSS channel's `<image>`, with the feed's read-only page as its link; readers that show a channel image use it. It is served under the read link like the notes' images, so it needs no password.

## What's in the feed

The RSS feed holds the newest 50 notes. Its title is the feed's title, or `NOTEFEED_TITLE` (`notefeed` by default) when the feed has none; its description is the feed's description, or the title when there is none. Each item has:

- the note's title
- a link to the note's read-only page, `<PUBLIC_URL>/r/<read id>/<id>`
- the time it was posted
- the note's raw markdown as its description
- the sender, as `<dc:creator>`, only when the note has one (from [sign-in](../self-hosting/sign-in/index.md)) and the feed's **Show who posted** setting is on
- the note's [tags](titles-and-tags.md#tags), one `<category>` each

`/r/<read id>/feed.xml?tag=ci` is the same feed with only the notes tagged `ci`, to subscribe to one kind of note; the read-only page takes the same `?tag=`.

A markdown note's image links, `![](file)` or `![](https://...)`, stay in that raw markdown; a relative one (`![](file)`, the file of an [image note](pictures.md#pictures)) is written out as an absolute URL under the same read id in the feed, because a reader has no base to resolve it against (the stored note is unchanged). A reader that shows the description as text shows the link, not the picture; notefeed does not turn the markdown into HTML for the feed. An [image note](pictures.md#pictures) is an item with an `<enclosure>` (RSS's way to attach a file, as podcasts do) holding the picture's absolute URL, size and type, and no description; many readers show an image enclosure inline, others offer it as an attachment, and some ignore enclosures. An item's title is the note's [title](titles-and-tags.md#titles), else the image note's id.

Control characters that XML doesn't allow (such as terminal colour codes from script output) are removed from the feed so one note can't break it. The file on disk keeps them.

!!! note "Links need the right public address"
    Links are built from `PUBLIC_URL`, or from the request when it's unset. If a reader fetches the feed over a LAN address, set `PUBLIC_URL` so links still point at the public site. See [Configuration](../self-hosting/configuration.md).

## Who posted

When [sign-in](../self-hosting/sign-in/index.md) is on, notes posted by a signed-in person carry a sender. The read-only view and the RSS feed show it unless the feed's **Show who posted** setting is off; notes posted with the password have none. A copy a reader already fetched keeps the sender it had.

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
