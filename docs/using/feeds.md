# Feeds

## Feed names

A feed name is 1 to 64 characters of `a`–`z`, `0`–`9`, `-` and `_`. Anything else is rejected with `400`. These names are taken by notefeed itself and are reserved: `r`, `api`, `login`, `logout`, `mcp`, `metrics`, `n`, `_next`, `static`, `health`, `imprint`, `privacy`, plus any names in `NOTEFEED_RESERVED_FEEDS` (see [Configuration](../self-hosting/configuration.md)). Posting to a reserved name answers `400`, except `logout`: that's the web UI's log-out route, which answers with a redirect and stores nothing. A trailing slash is fine: `POST /<feed>/` works like `POST /<feed>`.

!!! warning "The name is the key"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Pick one that's hard to guess, like `homelab-7f3k2q9x4m8wz`, and share the read link instead of the name.

## Feed settings in the web UI

![A feed's settings page: General, Read link, Post from a script and Delete feed](../assets/screenshot-settings-light.png#only-light)
![A feed's settings page: General, Read link, Post from a script and Delete feed](../assets/screenshot-settings-dark.png#only-dark)

The **Settings** button at the top right of the feed page opens `/<feed>/settings`, a page with four sections: **General**, **Read link** (with the `curl` command), **Feed password** and **Delete feed**. It exists once the feed has a note. **General** has a **Title** and a **Description** and a **Save changes** button. The title is shown as a heading at the top of the feed page and in the browser tab, with the description below it; the feed's name stays in the page header. Both also show in the [read-only view](read-links.md#the-read-only-view) and are the RSS feed's title and description, so anyone with the read link sees them. With [sign-in](../self-hosting/sign-in/index.md) on, **General** also has a **Show who posted** checkbox: unchecked, the sender is left out of the read-only view and the RSS feed (the feed page still shows it). It is not shown when sign-in is off. Leave a field empty to clear it. **General** also has the feed's **Read id**, an input with the current one and a **Generate a random one** button: see [Choosing a feed's read id](read-links.md#choosing-a-feeds-read-id) for what a change does. The feed's name never changes.

**Read link** shows the feed's [read link](web-ui.md#the-read-link) with a **Copy** button, so you can hand it to a feed reader or a dashboard; until the feed has its first note it says so instead. **Post from a script** is a `curl` command for this feed, with the headers it needs: `Authorization` on an instance with a password, and `X-Feed-Password` on an unlocked protected feed. **Feed password** only appears on a protected feed you have unlocked (see [A password for a feed](feed-passwords.md#in-the-web-ui)). On a phone, the buttons at the top of the page show only their icons.

The **Title image** control has a **Choose image** button, which posts an image as a note of its own and saves it as the feed's title image at once, a row of the feed's existing images to pick one from, and a **Remove image** button. Any of them saves what is typed in the title and description too. The title image shows in the page header and in the read-only view, and is the RSS feed's channel image. Like the title, it is public to anyone with the read link. If its image note is deleted, the title image goes with it. Choosing and removing an image need JavaScript.

**Delete feed**, the last section, removes the feed with all its notes, its settings, its password and its read link, for good. You confirm by typing the feed's name, exactly. Afterwards you land on the start page, and the name can be used again. A new feed with that name gets a different read link, and the old link stays empty.

Both work without JavaScript: they are plain forms that post to `/<feed>/details` and `/<feed>/delete`, and they only accept requests from the instance's own pages. (Posting, editing and deleting *notes* need JavaScript.) A script uses the [API](#feed-settings-in-the-api) instead. If something is refused (a title that is too long, too many requests), the settings page says why next to these sections and nothing changes. They count toward the same [rate limit](../self-hosting/limits.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can change its settings and delete it: on an open feed that is anyone who knows its name, and on a feed with [its own password](feed-passwords.md#in-the-web-ui) it is anyone who has unlocked it. A locked feed shows only its unlock form, without its title, description or title image. The read-only view has neither section.

## Feed settings in the API

A feed can have a **title** (at most 100 characters) and a **description** (at most 500), both on one line. The title is shown as a heading on the feed page, where the feed's name stays in the page header, and both show in the read-only view and in the RSS feed (see [RSS and dashboards](rss.md#title-and-description)). The feed's name stays as it is: you can't rename a feed. A feed has neither until you set them.

`GET /api/v1/feeds/<feed>` answers with the feed's `name`, `title`, `description`, `show_sender`, `image_url`, `protected` and `read_url`. `read_url` is `null` while the feed has no notes, and for [a feed without a read link](../self-hosting/deleting.md#a-feed-without-a-read-link), and `image_url` is `null` while the feed has no title image (or its file was removed by hand), while the feed has no notes, and for a feed without a read link. `PUT` on the same URL replaces the title and the description, both at once, and answers with the feed; an empty string clears one. Surrounding spaces are trimmed, and control characters, including a line break, and text-direction override characters (U+202A to U+202E, U+2066 to U+2069) are refused.

```sh
curl -X PUT -H "Content-Type: application/json" \
  -d '{"title": "Homelab", "description": "Deploys and alerts"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

`show_sender` (a boolean, on by default) matters only when [sign-in](../self-hosting/sign-in/index.md) is on: set to `false` in the `PUT` body, it leaves the sender out of the public read view, the RSS feed and the public read API. Leaving it out keeps the current value.

The feed's **title image** is one of the feed's [pictures](pictures.md#pictures). Add `"image": "<file>"` to the body, with the `file` of a picture, to show it in the page header, the read-only view and as the RSS channel image. `"image": ""` removes it, and leaving `image` out keeps the one the feed has. A name that is not an image note of this feed is a `400`, and deleting that note takes the title image away. The title image is public, like the title.

`DELETE` removes the feed for good and answers `204` with no body: every note, every image, the title and description, the password and the read link. There is no undo and no trash:

```sh
curl -X DELETE https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

What to know:

- **Who may:** whoever may post to the feed. On an open feed the name is the key, so anyone who knows it can change its title and delete the whole feed, not only add notes. A feed with [its own password](feed-passwords.md#in-the-api) needs `X-Feed-Password` for all three, and an instance with a password needs `Authorization: Bearer` first, as for posting. The [read link](read-links.md) can neither change settings nor delete.
- **The feed must exist.** A feed is created by its first note, and can only get a password then. `GET`, `PUT` and `DELETE` on a feed that doesn't exist answer `404` (`not_found`) and create nothing.
- **The name is free again,** at once. A feed created under it later is a new feed with a new read link; the old read link stays empty for good, and the old feed's password and settings are gone. A post that was already on its way when the feed was deleted creates such a new feed.
- **Settings are public to readers.** Anyone with the read link sees the title and description, through `GET /api/v1/read/<read id>` too, which needs no password. Anyone who has the feed's name and its password reads them with `GET /api/v1/feeds/<feed>`.
- **Limits:** `PUT` and `DELETE` count toward the same per-client [rate limit](../self-hosting/limits.md#rate-limits-and-caps) as posts. The `PUT` body is limited to 8 KB. A refused `PUT` leaves the settings as they were.
- **Errors:** `400` for an invalid or reserved name, or a body that isn't JSON with string `title` and `description` (and `image`, if present), or a title or description that is too long or has control or text-direction override characters, or a malformed or reserved feed's `read_id`; `401` when a password is missing or wrong (before it says anything about the feed); `404` when the feed doesn't exist; `409` (`taken`) when the `read_id` belongs to another feed; `429` over the limit.

In the browser the same two things are in the feed page's [Feed settings and Delete feed sections](#feed-settings-in-the-web-ui).
