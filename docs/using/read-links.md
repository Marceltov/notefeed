# Read links

Every feed has a **read link**:

```
https://notes.example.com/r/<read id>/feed.xml
```

The read id is 22 random characters by default, e.g. `q2Zc9kD0bTnVx4LmAe7sWp`, or one the feed's owner [chose](#choosing-a-feeds-read-id) (3 to 64 characters of `a-z`, `0-9`, `-` and `_`); the exception is is a [reserved feed](../self-hosting/reserved-feeds.md#reserved-feeds), whose read id is its name (`/r/news`). A feed created since feed deletion was added gets a random read id that notefeed stores in the feed's folder (`.readid`). A feed that existed before keeps the read id computed from its name and the server secret, so no read link has changed. You find the link on the feed page, and in every `POST /<feed>` answer as `read_url`.

A read link:

- serves the feed as RSS 2.0 (`/r/<read id>/feed.xml`) and as a read-only web page (`/r/<read id>`),
- never shows the feed's name, so it can't be turned into write access,
- can't post,
- needs no login, even when the instance has a password, and no password when the feed has its own: protecting a feed with a [password](feed-passwords.md#in-the-api) doesn't close its read link.

That makes it the link to give to feed readers, dashboards and other people. Keep the feed name itself to the scripts that post.

!!! note "An unknown read link shows an empty feed"
    A read link that doesn't belong to any feed answers with an empty feed, not an error. That's on purpose: nobody can probe which read links exist. The web UI shows a feed's read link once the feed has its first note. A read link that is neither 22 characters of `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `_` nor the name of a reserved feed is a `404`.

!!! warning "The secret behind older read links"
    The read ids of feeds created before feed deletion was added are computed from the feed name and a server secret: `NOTEFEED_SECRET` if set, otherwise a random one that notefeed creates once in `DATA_DIR/.secret`. Changing `NOTEFEED_SECRET`, or deleting `.secret` without setting it, **changes the read link of every such feed**, and readers must resubscribe. Feeds created since have a stored read id, and their read links are not affected. The secret is still needed on every instance: it also signs the unlock cookies of protected feeds and the logins of MCP clients. Back up `.secret` with your notes. See [Configuration](../self-hosting/configuration.md).

!!! note "A deleted feed's read link stays dead"
    When a feed is [deleted](feeds.md#feed-settings-in-the-api), its read link answers with an empty feed from then on, and a feed created later under the same name gets a different read link. Someone who still has the old link learns nothing about the new feed, and subscribers of the old feed don't start receiving the new feed's notes.

## The read-only view

`/r/<read id>` shows the same notes without the compose box, under the feed's title and description when it has them, and never shows the feed's name (a reserved feed's read id is its name, by design). A trailing slash is fine: `/r/<read id>/` answers `200` with the same page, without a redirect. Each note opens at `/r/<read id>/<id>`, which is also the note's link in the RSS feed. It needs no login, even on a locked instance. When [sign-in](../self-hosting/sign-in/index.md) is on, it shows who posted each note, unless the feed's **Show who posted** setting is off.

## Choosing a feed's read id

A feed's name never changes, but its [read id](read-links.md) (the part of the read link and the RSS link after `/r/`) can be chosen and changed. It is 22 random characters unless you say otherwise.

- **At creation:** send `X-Read-Id` with the post that creates the feed (or the `read_id` argument of the MCP `post_note` tool): `-H "X-Read-Id: my-blog"`. Left out or empty, it is random. For a feed that already exists it is ignored.
- **Later:** `read_id` in the `PUT /api/v1/feeds/<feed>` body (`{"title": "", "description": "", "read_id": "my-blog"}`), in the **Read id** field on the settings page, in `update_feed`, and in the client packages (`readId` on `post()`, `read_id` in `updateFeed()` settings; `read_id` in Python). An empty value gives a new random one; leaving it out keeps the current one.
- **Rule:** 3 to 64 characters of `a-z`, `0-9`, `-` and `_`. A read id that belongs to another feed, or that is held back for a [reserved feed](../self-hosting/reserved-feeds.md#reserved-feeds), is refused with `409` (`taken`); a malformed one with `400`. A reserved feed keeps its read id (its name). An operator can turn chosen read ids off with `NOTEFEED_ALLOW_CUSTOM_IDS=0` ([configuration](../self-hosting/configuration.md)), which leaves only random ones.

What to know:

- **A short, readable read id can be guessed**, and anyone who guesses it can read the feed. Protect the feed with [a password](feed-passwords.md#in-the-api) if that matters.
- **The old read id is freed.** Nothing is recorded: the old link answers like any unknown read id (an empty feed) until another feed takes that id, so it may later show somebody else's notes. Tell the people who have the old link.
- **Notes are not edited.** Images in a note that are written relative to the feed (`![](<id>.png)`, as a [picture](pictures.md#pictures) post answers) follow the new read id, and so does the title image. A full URL in a note (`![](https://…/r/<old id>/<file>)`) keeps the old read id and stops working: changing those is up to you.
- **Limits:** a change counts toward the same per-client [rate limit](../self-hosting/limits.md#rate-limits-and-caps) as posts.
