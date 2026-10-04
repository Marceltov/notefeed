# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one, such as `quiet-otter-x7k2p4m9qd8zr`. Type a name (uppercase letters are lowered and spaces become `-`) and press **Open** to go to `/<name>`. There's no list of feeds: you only reach a feed by knowing its name.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Keep the suggested name or make up something as random.

## A feed page

`/<feed>` shows one feed: a box to write a note, the feed's read link, and its newest 50 notes. A feed with no notes yet shows an empty list and a `curl` command to post the first one; it's saved to disk with its first note, and its read link appears then too.

![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-dark.png#only-dark)

### Writing a note

Type markdown into the box at the top. The note is saved under an id of the time plus a random UUID, never its title: see [Titles and filenames](posting.md#titles-and-filenames).

Post with **Post note**, or press ++ctrl+enter++ (++cmd+enter++ on a Mac). The note appears at the top of the list, briefly highlighted. The box posts to the same `POST /<feed>` as scripts, so it counts toward the same [rate limit and caps](configuration.md#rate-limits-and-caps). The web UI needs JavaScript for posting, editing and deleting notes; use the [API](posting.md) or the `notefeed` command without it.

The **Settings** button at the top right opens the feed's [settings page](#feed-settings-and-deleting-a-feed), which also has a ready-to-copy `curl` command for this feed. A feed without notes shows the command right under the box.

### Adding an image

The compose box has an **Add image** button. Choose PNG, JPEG, GIF or WebP files, or paste an image into the box, or drop files on it. Each one waits in the box, with a small preview and a remove button, and `![](name)` goes into the text at the cursor, with the file's own name. Nothing is uploaded yet, so leaving the page uploads nothing. When you **Post note**, the text and the pictures are sent in [one request](posting.md#posting-a-note-with-its-pictures), and the server swaps the names in your text for the new notes' files. If the text holds only the pictures, no text note is made (the request has no text part). If something is refused (not an image, too large, too many requests), the page says why and keeps your text and your pictures; nothing is half-posted, so posting again never makes a picture twice. The note editor sends its text and pictures the same way, as one `PUT` (it saves a changed title first, so a retry never duplicates pictures), and a feed that does not exist yet takes pictures too: the first post creates it, with its password.

This needs JavaScript. Without it the box is a plain text box: post a picture with the [API](posting.md#pictures) or `notefeed post --file`, then write `![](file)` yourself. Pictures are posted as they are, so a photo keeps its EXIF data, including where it was taken, and anyone with the read link can download it: remove it with a tool such as `exiftool` first (see [operations](operations.md)).

A **Title** field sits next to the tags: leave it empty and the note is titled by its text. The editor has it too, and for a picture also an alternative text for screen readers.

Images in notes load lazily and are never wider than the note. They are as public as the [read link](#the-read-link): see [Images](posting.md#pictures).

### The read link

Once the feed has a note, the buttons at the top right link to the read-only view (**Read-only**) and to the feed (**RSS**). The read link itself, with a copy button, is on the settings page under **Read link**. Give it to feed readers and to people who should see the notes but not post. See [Read links and RSS](feed.md).

### Reading notes

Notes are listed newest first, grouped by day, with the time on the left. Times use the server's time zone (see [`TZ`](configuration.md)). Click a title to open the note on its own page, `/<feed>/<id>`.

Raw HTML in notes is shown as text, never run.

### Tags

A note's [tags](posting.md#tags) show next to its title in the list and on its page, in the feed and in the read-only view. Each is a link: it opens the list with only the notes carrying that tag (`?tag=ci`), with a **Show all notes** link above it. The compose box has an optional **Tags** field under the text: type them separated by commas (`ci, deploy`). The browser refuses more than 10, or characters tags can't have, before it sends anything.

### Editing and deleting a note

A note's own page, `/<feed>/<id>`, has an **Edit** control and a **Delete** control. **Edit** shows a box with the note's markdown and a **Title** field; change them and press **Save**. For a picture there is no text, only the title and an alternative text. The note keeps its address, its place in the list and its RSS item identity, and its title follows the new text. **Delete** asks you to confirm before it removes the note; once confirmed it is gone for good, and you land back on the feed, which stays even if it now has no notes.

Both go through the [API](posting.md#editing-and-deleting-notes) (`PUT`, `PATCH` and `DELETE`), so they need JavaScript. If a change is refused (an empty note, one over the size limit, too many requests), the page says why and the note stays as it was. They count toward the same [rate limit](configuration.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can edit and delete its notes. On a feed with [its own password](#a-password-for-a-feed) that means anyone who has unlocked it. The [read-only view](#the-read-only-view) has neither control.

## Feed settings and deleting a feed

![A feed's settings page: General, Read link, Post from a script and Delete feed](assets/screenshot-settings-light.png#only-light)
![A feed's settings page: General, Read link, Post from a script and Delete feed](assets/screenshot-settings-dark.png#only-dark)

The **Settings** button at the top right of the feed page opens `/<feed>/settings`, a page with four sections: **General**, **Read link** (with the `curl` command), **Feed password** and **Delete feed**. It exists once the feed has a note. **General** has a **Title** and a **Description** and a **Save changes** button. The title is shown as a heading at the top of the feed page and in the browser tab, with the description below it; the feed's name stays in the page header. Both also show in the [read-only view](#the-read-only-view) and are the RSS feed's title and description, so anyone with the read link sees them. With [sign-in](identity.md) on, **General** also has a **Show who posted** checkbox: unchecked, the sender is left out of the read-only view and the RSS feed (the feed page still shows it). It is not shown when sign-in is off. Leave a field empty to clear it. **General** also has the feed's **Read id**, an input with the current one and a **Generate a random one** button: see [Choosing a feed's read id](posting.md#choosing-a-feeds-read-id) for what a change does. The feed's name never changes.

**Read link** shows the feed's [read link](#the-read-link) with a **Copy** button, so you can hand it to a feed reader or a dashboard; until the feed has its first note it says so instead. **Post from a script** is a `curl` command for this feed, with the headers it needs: `Authorization` on an instance with a password, and `X-Feed-Password` on an unlocked protected feed. **Feed password** only appears on a protected feed you have unlocked (see [A password for a feed](#a-password-for-a-feed)). On a phone, the buttons at the top of the page show only their icons.

The **Title image** control has a **Choose image** button, which posts an image as a note of its own and saves it as the feed's title image at once, a row of the feed's existing images to pick one from, and a **Remove image** button. Any of them saves what is typed in the title and description too. The title image shows in the page header and in the read-only view, and is the RSS feed's channel image. Like the title, it is public to anyone with the read link. If its image note is deleted, the title image goes with it. Choosing and removing an image need JavaScript.

**Delete feed**, the last section, removes the feed with all its notes, its settings, its password and its read link, for good. You confirm by typing the feed's name, exactly. Afterwards you land on the start page, and the name can be used again. A new feed with that name gets a different read link, and the old link stays empty.

Both work without JavaScript: they are plain forms that post to `/<feed>/details` and `/<feed>/delete`, and they only accept requests from the instance's own pages. (Posting, editing and deleting *notes* need JavaScript.) A script uses the [API](posting.md#feed-settings-and-deleting-a-feed) instead. If something is refused (a title that is too long, too many requests), the settings page says why next to these sections and nothing changes. They count toward the same [rate limit](configuration.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can change its settings and delete it: on an open feed that is anyone who knows its name, and on a feed with [its own password](#a-password-for-a-feed) it is anyone who has unlocked it. A locked feed shows only its unlock form, without its title, description or title image. The read-only view has neither section.

## A password for a feed

On a feed that doesn't exist yet, the box has an optional **Password** field. Fill it in and the first note creates a protected feed. A password is 1 to 256 printable ASCII characters (unaccented letters, digits, symbols and spaces) with no space at the start or end, so that it also works from a script; the browser refuses anything else. The field is only there for a new feed: an existing feed can't get a password afterwards.

A protected feed asks for its password before it shows anything, at `/<feed>`: an **Unlock** form. The browser then stays unlocked (a cookie for that feed, with no end date) until the password changes or you press **Lock**. Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps); opening the page without entering one does not. Once unlocked, a **Feed password** section on the settings page lets you change the password, remove it (the feed stays, open to anyone who knows its name; both need the current password) or **Lock this browser** again. Changing the password signs every other browser out. The ready-to-copy `curl` command on an unlocked feed includes the `X-Feed-Password` header.

The [read-only view](#the-read-only-view) and the RSS link stay open. See [A feed with its own password](posting.md#a-feed-with-its-own-password) for scripts, and [Operations](operations.md#a-lost-feed-password) if the password is lost.

## The read-only view

`/r/<read id>` shows the same notes without the compose box, under the feed's title and description when it has them, and never shows the feed's name (a reserved feed's read id is its name, by design). A trailing slash is fine: `/r/<read id>/` answers `200` with the same page, without a redirect. Each note opens at `/r/<read id>/<id>`, which is also the note's link in the RSS feed. It needs no login, even on a locked instance. When [sign-in](identity.md) is on, it shows who posted each note, unless the feed's **Show who posted** setting is off.

## With a password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the login page, the read-only views and the privacy (`/privacy`) and imprint (`/imprint`) pages asks for it first. After logging in you land on the page you were trying to open. The login lasts a year on that browser. **Log out** at the top ends it in that browser. To log out *every* browser, change `NOTEFEED_PASSWORD` and restart notefeed; scripts use the same password, so update them too.

Wrong passwords count toward the [rate limit](configuration.md#rate-limits-and-caps): after too many, the login page asks you to wait up to a minute.

## Install it and share a link

notefeed ships a web manifest and icons, so a browser can install it as an app (**Install** in Chrome and Edge, **Add to Home Screen** on a phone). Pages also carry a share image and description, so a link pasted into WhatsApp, Slack or similar shows a preview with the notefeed wordmark. The image URL in that preview is absolute: set `PUBLIC_URL` on a public instance, or it follows the `Host` header of the request (see [Configuration](configuration.md)). On a [locked instance](configuration.md#the-password) the icons, manifest, share image, privacy page and imprint stay public, but the pages themselves ask for a login, so a preview of a feed link shows only the image and the generic description.
