# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one, such as `quiet-otter-x7k2p4m9qd8zr`. Type a name (uppercase letters are lowered and spaces become `-`) and press **Open** to go to `/<name>`. There's no list of feeds: you only reach a feed by knowing its name.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read and post to it. Keep the suggested name or make up something as random.

## A feed page

`/<feed>` shows one feed: a box to write a note, the feed's read link, and its newest 50 notes. A feed with no notes yet shows an empty list and a `curl` command to post the first one; it's saved to disk with its first note.

![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a compose box, the feed's read link, and notes grouped by day](assets/screenshot-dark.png#only-dark)

### Writing a note

Type markdown into the box at the top. While you type, the line under the box shows the file the note will be saved as, for example `20260929T140512Z-backup-finished.md`. See [Titles and filenames](posting.md#titles-and-filenames) for how it's derived.

Post with **Post note**, or press ++ctrl+enter++ (++cmd+enter++ on a Mac). The note appears at the top of the list, briefly highlighted. Posting from the page counts toward the same [rate limit and caps](configuration.md#rate-limits-and-caps) as the API.

Once the feed has notes, **Post from a script** expands to a ready-to-copy `curl` command for this feed.

### The read link

Under the box is the feed's read link, with a copy button, and **Open read-only view**. The **RSS** link at the top is the same read link. Give it to feed readers and to people who should see the notes but not post. See [Read links and RSS](feed.md).

### Reading notes

Notes are listed newest first, grouped by day, with the time on the left. Times use the server's time zone (see [`TZ`](configuration.md)). Click a title to open the note on its own page, `/<feed>/<id>`.

Raw HTML in notes is shown as text, never run.

## The read-only view

`/r/<read id>` shows the same notes without the compose box, and never shows the feed's name. A trailing slash is fine: `/r/<read id>/` answers `200` with the same page, without a redirect. Each note opens at `/r/<read id>/<id>`, which is also the note's link in the RSS feed. It needs no login, even on a locked instance.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the login page and the read-only views asks for it first. After logging in you land on the page you were trying to open. The login lasts a year on that browser. **Log out** at the top ends it in that browser. To log out *every* browser, change `NOTEFEED_PASSWORD` and restart notefeed; scripts use the same password, so update them too.

Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps): after too many, the login page asks you to wait up to a minute.
