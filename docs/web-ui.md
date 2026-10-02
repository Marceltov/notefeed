# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one, such as `quiet-otter-x7k2p4m9qd8zr`. Type a name (uppercase letters are lowered and spaces become `-`) and press **Open** to go to `/<name>`. There's no list of feeds: you only reach a feed by knowing its name.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read and post to it. Keep the suggested name or make up something as random.

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

## A password for a feed

On a feed that doesn't exist yet, the box has an optional **Password** field. Fill it in and the first note creates a protected feed. A password is 1 to 256 printable ASCII characters (unaccented letters, digits, symbols and spaces) with no space at the start or end, so that it also works from a script; the browser refuses anything else. The field is only there for a new feed: an existing feed can't get a password afterwards.

A protected feed asks for its password before it shows anything, at `/<feed>`: an **Unlock** form. The browser then stays unlocked (a cookie for that feed, with no end date) until the password changes or you press **Lock**. Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps); opening the page without entering one does not. Once unlocked, a **Feed password** section above the notes lets you change the password, remove it (the feed stays, open to anyone who knows its name; both need the current password) or lock this browser again. Changing the password signs every other browser out. The ready-to-copy `curl` command on an unlocked feed includes the `X-Feed-Password` header.

The [read-only view](#the-read-only-view) and the RSS link stay open. See [A feed with its own password](posting.md#a-feed-with-its-own-password) for scripts, and [Operations](operations.md#a-lost-feed-password) if the password is lost.

## The read-only view

`/r/<read id>` shows the same notes without the compose box, and never shows the feed's name. A trailing slash is fine: `/r/<read id>/` answers `200` with the same page, without a redirect. Each note opens at `/r/<read id>/<id>`, which is also the note's link in the RSS feed. It needs no login, even on a locked instance.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the login page and the read-only views asks for it first. After logging in you land on the page you were trying to open. The login lasts a year on that browser. **Log out** at the top ends it in that browser. To log out *every* browser, change `NOTEFEED_PASSWORD` and restart notefeed; scripts use the same password, so update them too.

Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps): after too many, the login page asks you to wait up to a minute.
