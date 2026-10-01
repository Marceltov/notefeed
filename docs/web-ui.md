# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one, such as `quiet-otter-x7k2p4m9qd8zr`. Type a name (uppercase letters are lowered and spaces become `-`) and press **Open** to go to `/<name>`. There's no list of feeds: you only reach a feed by knowing its name.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Keep the suggested name or make up something as random.

## A feed page

`/<feed>` shows one feed: a box to write a note, the feed's read link, and its newest 50 notes. A feed with no notes yet shows an empty list and a `curl` command to post the first one; it's saved to disk with its first note, and its read link appears then too.

![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-dark.png#only-dark)

### Writing a note

Type markdown into the box at the top. While you type, the line under the box shows the file the note will be saved as, for example `20260929T140512Z-backup-finished.md`. See [Titles and filenames](posting.md#titles-and-filenames) for how it's derived.

Post with **Post note**, or press ++ctrl+enter++ (++cmd+enter++ on a Mac). The note appears at the top of the list, briefly highlighted. The box posts to the same `POST /<feed>` as scripts, so it counts toward the same [rate limit and caps](configuration.md#rate-limits-and-caps) and works without JavaScript too.

Once the feed has notes, **Post from a script** expands to a ready-to-copy `curl` command for this feed.

### The read link

Once the feed has a note, its read link is under the box, with a copy button and **Open read-only view**. The **RSS** link at the top is the same read link. Give it to feed readers and to people who should see the notes but not post. See [Read links and RSS](feed.md).

### Reading notes

Notes are listed newest first, grouped by day, with the time on the left. Times use the server's time zone (see [`TZ`](configuration.md)). Click a title to open the note on its own page, `/<feed>/<id>`.

Raw HTML in notes is shown as text, never run.

### Editing and deleting a note

A note's own page, `/<feed>/<id>`, has an **Edit** control and a **Delete** control. **Edit** shows a box with the note's markdown; change it and press **Save**. The note keeps its address, its place in the list and its RSS item identity, and its title follows the new text. **Delete** asks you to confirm before it removes the note; once confirmed it is gone for good, and you land back on the feed, which stays even if it now has no notes.

Both work without JavaScript. They are plain forms that post to `/<feed>/<id>/edit` and `/<feed>/<id>/delete`, and they only accept requests from the instance's own pages: a script uses the [API](posting.md#editing-and-deleting-notes) instead. If a change is refused (an empty note, one over the size limit, too many requests), the page says why and the note stays as it was. They count toward the same [rate limit](configuration.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can edit and delete its notes. On a feed with [its own password](#a-password-for-a-feed) that means anyone who has unlocked it. The [read-only view](#the-read-only-view) has neither control.

## Feed settings and deleting a feed

On the feed page, a **Feed settings** section has a **Title** and a **Description** and a **Save** button. The title is shown at the top of the page in place of the feed's name, and the description below it. Both also show in the [read-only view](#the-read-only-view) and are the RSS feed's title and description, so anyone with the read link sees them. Leave a field empty to clear it. The feed's name never changes.

Below it, **Delete feed** removes the feed with all its notes, its settings, its password and its read link, for good. You confirm by typing the feed's name, exactly. Afterwards you land on the start page, and the name can be used again. A new feed with that name gets a different read link, and the old link stays empty.

Both work without JavaScript: they are plain forms that post to `/<feed>/settings` and `/<feed>/delete`, and they only accept requests from the instance's own pages. A script uses the [API](posting.md#feed-settings-and-deleting-a-feed) instead. If something is refused (a title that is too long, too many requests), the page says why and nothing changes. They count toward the same [rate limit](configuration.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can change its settings and delete it: on an open feed that is anyone who knows its name, and on a feed with [its own password](#a-password-for-a-feed) it is anyone who has unlocked it. A locked feed shows only its unlock form, without its title or description. The read-only view has neither section.

## A password for a feed

On a feed that doesn't exist yet, the box has an optional **Password** field. Fill it in and the first note creates a protected feed. A password is 1 to 256 printable ASCII characters (unaccented letters, digits, symbols and spaces) with no space at the start or end, so that it also works from a script; the browser refuses anything else. The field is only there for a new feed: an existing feed can't get a password afterwards.

A protected feed asks for its password before it shows anything, at `/<feed>`: an **Unlock** form. The browser then stays unlocked (a cookie for that feed, with no end date) until the password changes or you press **Lock**. Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps); opening the page without entering one does not. Once unlocked, a **Feed password** section above the notes lets you change the password, remove it (the feed stays, open to anyone who knows its name; both need the current password) or lock this browser again. Changing the password signs every other browser out. The ready-to-copy `curl` command on an unlocked feed includes the `X-Feed-Password` header.

The [read-only view](#the-read-only-view) and the RSS link stay open. See [A feed with its own password](posting.md#a-feed-with-its-own-password) for scripts, and [Operations](operations.md#a-lost-feed-password) if the password is lost.

## The read-only view

`/r/<read id>` shows the same notes without the compose box, under the feed's title and description when it has them, and never shows the feed's name. A trailing slash is fine: `/r/<read id>/` answers `200` with the same page, without a redirect. Each note opens at `/r/<read id>/<id>`, which is also the note's link in the RSS feed. It needs no login, even on a locked instance.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the login page and the read-only views asks for it first. After logging in you land on the page you were trying to open. The login lasts a year on that browser. **Log out** at the top ends it in that browser. To log out *every* browser, change `NOTEFEED_PASSWORD` and restart notefeed; scripts use the same password, so update them too.

Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps): after too many, the login page asks you to wait up to a minute.
