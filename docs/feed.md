# Read links and RSS

Every feed has a **read link**:

```
https://notes.example.com/r/<read id>/feed.xml
```

The read id is 22 characters, e.g. `q2Zc9kD0bTnVx4LmAe7sWp`; the one exception is a [reserved feed](configuration.md#reserved-feeds), whose read id is its name (`/r/news`). A feed created since feed deletion was added gets a random read id that notefeed stores in the feed's folder (`.readid`). A feed that existed before keeps the read id computed from its name and the server secret, so no read link has changed. You find the link on the feed page, and in every `POST /<feed>` answer as `read_url`.

A read link:

- serves the feed as RSS 2.0 (`/r/<read id>/feed.xml`) and as a read-only web page (`/r/<read id>`),
- never shows the feed's name, so it can't be turned into write access,
- can't post,
- needs no login, even when the instance has a password, and no password when the feed has its own: protecting a feed with a [password](posting.md#a-feed-with-its-own-password) doesn't close its read link.

That makes it the link to give to feed readers, dashboards and other people. Keep the feed name itself to the scripts that post.

!!! note "An unknown read link shows an empty feed"
    A read link that doesn't belong to any feed answers with an empty feed, not an error. That's on purpose: nobody can probe which read links exist. The web UI shows a feed's read link once the feed has its first note. A read link that is neither 22 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `_` nor the name of a reserved feed is a `404`.

!!! warning "The secret behind older read links"
    The read ids of feeds created before feed deletion was added are computed from the feed name and a server secret: `NOTEFEED_SECRET` if set, otherwise a random one that notefeed creates once in `DATA_DIR/.secret`. Changing `NOTEFEED_SECRET`, or deleting `.secret` without setting it, **changes the read link of every such feed**, and readers must resubscribe. Feeds created since have a stored read id, and their read links are not affected. The secret is still needed on every instance: it also signs the unlock cookies of protected feeds and the logins of MCP clients. Back up `.secret` with your notes. See [Configuration](configuration.md).

!!! note "A deleted feed's read link stays dead"
    When a feed is [deleted](posting.md#feed-settings-and-deleting-a-feed), its read link answers with an empty feed from then on, and a feed created later under the same name gets a different read link. Someone who still has the old link learns nothing about the new feed, and subscribers of the old feed don't start receiving the new feed's notes.

## Title and description

A feed can have a title, a description and a title image, which anyone with the read link can see: they are the RSS channel's title and description, and they show above the notes in the read-only view. They are [set with the feed's settings](posting.md#feed-settings-and-deleting-a-feed). Don't put anything private in them. The feed's name is never shown. The title image is the RSS channel's `<image>`, with the feed's read-only page as its link; readers that show a channel image use it. It is served under the read link like the notes' images, so it needs no password.

## What's in the feed

The RSS feed holds the newest 50 notes. Its title is the feed's title, or `NOTEFEED_TITLE` (`notefeed` by default) when the feed has none; its description is the feed's description, or the title when there is none. Each item has:

- the note's title
- a link to the note's read-only page, `<PUBLIC_URL>/r/<read id>/<id>`
- the time it was posted
- the note's raw markdown as its description
- the sender, as `<dc:creator>`, only when the note has one (from [sign-in](identity.md)) and the feed's **Show who posted** setting is on

Images in notes are plain markdown image links, `![](https://...)`, in that raw markdown, pointing at absolute URLs under the same read id (see [Images](posting.md#images)). A reader that shows the description as text shows the link, not the picture; notefeed does not turn the markdown into HTML for the feed.

Control characters that XML doesn't allow (such as terminal colour codes from script output) are removed from the feed so one note can't break it. The file on disk keeps them.

!!! note "Links need the right public address"
    Links are built from `PUBLIC_URL`, or from the request when it's unset. If a reader fetches the feed over a LAN address, set `PUBLIC_URL` so links still point at the public site. See [Configuration](configuration.md).

## Who posted

When [sign-in](identity.md) is on, notes posted by a signed-in person carry a sender. The read-only view and the RSS feed show it unless the feed's **Show who posted** setting is off; notes posted with the password have none. A copy a reader already fetched keeps the sender it had.

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
