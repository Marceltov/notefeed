# Web UI

## The start page

Open notefeed in a browser. The start page asks for a feed name and suggests a random one, such as `quiet-otter-x7k2p4m9qd8zr`. Type a name (uppercase letters are lowered and spaces become `-`) and press **Open** to go to `/<name>`. There's no list of feeds: you only reach a feed by knowing its name.

!!! warning "Pick a hard-to-guess name"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Keep the suggested name or make up something as random.

## A feed page

`/<feed>` shows one feed: a box to write a note, the feed's read link, and its newest 50 notes. A feed with no notes yet shows an empty list and a `curl` command to post the first one; it's saved to disk with its first note, and its read link appears then too.

![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](../assets/screenshot-light.png#only-light)
![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](../assets/screenshot-dark.png#only-dark)

### Writing a note

Type markdown into the box at the top. The note is saved under an id of the time plus a random UUID, never its title: see [Ids and filenames](titles-and-tags.md#ids-and-filenames).

Post with **Post note**, or press ++ctrl+enter++ (++cmd+enter++ on a Mac). The note appears at the top of the list, briefly highlighted. The box posts to the same `POST /<feed>` as scripts, so it counts toward the same [rate limit and caps](../self-hosting/limits.md#rate-limits-and-caps). The web UI needs JavaScript for posting, editing and deleting notes; use the [API](posting.md) or the `notefeed` command without it.

The **Settings** button at the top right opens the feed's [settings page](feeds.md#feed-settings-in-the-web-ui), which also has a ready-to-copy `curl` command for this feed. A feed without notes shows the command right under the box.

### Adding an image

The compose box has an **Add image** button. Choose PNG, JPEG, GIF or WebP files, or paste an image into the box, or drop files on it. Each one waits in the box, with a small preview and a remove button, and `![](name)` goes into the text at the cursor, with the file's own name. Nothing is uploaded yet, so leaving the page uploads nothing. When you **Post note**, the text and the pictures are sent in [one request](pictures.md#posting-a-note-with-its-pictures), and the server swaps the names in your text for the new notes' files. If the text holds only the pictures, no text note is made (the request has no text part), and each picture gets the alt text its reference carries (`![a cat](cat.png)`; the first non-empty one when a picture is referred to twice; a note with text keeps its alt texts in the text). If something is refused (not an image, too large, too many requests), the page says why and keeps your text and your pictures; nothing is half-posted, so posting again never makes a picture twice. The note editor sends its text and pictures the same way, as one `PUT` (it saves a changed title first, so a retry never duplicates pictures), and a feed that does not exist yet takes pictures too: the first post creates it, with its password.

This needs JavaScript. Without it the box is a plain text box: post a picture with the [API](pictures.md#pictures) or `notefeed post --file`, then write `![](file)` yourself. Pictures are posted as they are, so a photo keeps its EXIF data, including where it was taken, and anyone with the read link can download it: remove it with a tool such as `exiftool` first (see [storage](../self-hosting/storage.md#images-and-other-files)).

A **Title** field sits next to the tags: leave it empty and the note is titled by its text. The editor has it too, and for a picture also an alternative text for screen readers.

Images in notes load lazily and are never wider than the note. They are as public as the [read link](#the-read-link): see [Images](pictures.md#pictures).

### The read link

Once the feed has a note, the buttons at the top right link to the read-only view (**Read-only**) and to the feed (**RSS**). The read link itself, with a copy button, is on the settings page under **Read link**. Give it to feed readers and to people who should see the notes but not post. See [Read links](read-links.md).

### Reading notes

Notes are listed newest first, grouped by day, with the time on the left. Times use the server's time zone (see [`TZ`](../self-hosting/configuration.md)). Click a title to open the note on its own page, `/<feed>/<id>`.

Raw HTML in notes is shown as text, never run.

### Tags

A note's [tags](titles-and-tags.md#tags) show next to its title in the list and on its page, in the feed and in the read-only view. Each is a link: it opens the list with only the notes carrying that tag (`?tag=ci`), with a **Show all notes** link above it. The compose box has an optional **Tags** field under the text: type them separated by commas (`ci, deploy`). The browser refuses more than 10, or characters tags can't have, before it sends anything.

### Editing and deleting a note

A note's own page, `/<feed>/<id>`, has an **Edit** control and a **Delete** control. **Edit** shows a box with the note's markdown and a **Title** field; change them and press **Save**. For a picture there is no text, only the title and an alternative text. The note keeps its address, its place in the list and its RSS item identity, and its title follows the new text. **Delete** asks you to confirm before it removes the note; once confirmed it is gone for good, and you land back on the feed, which stays even if it now has no notes.

Both go through the [API](editing.md#editing-and-deleting-notes) (`PUT`, `PATCH` and `DELETE`), so they need JavaScript. If a change is refused (an empty note, one over the size limit, too many requests), the page says why and the note stays as it was. They count toward the same [rate limit](../self-hosting/limits.md#rate-limits-and-caps) as posting.

Anyone who can open the feed can edit and delete its notes. On a feed with [its own password](feed-passwords.md#in-the-web-ui) that means anyone who has unlocked it. The [read-only view](read-links.md#the-read-only-view) has neither control.

## With an instance password

If the instance has a password (`NOTEFEED_PASSWORD`), every page except the login page, the read-only views and the privacy (`/privacy`) and imprint (`/imprint`) pages asks for it first. After logging in you land on the page you were trying to open. The login lasts a year on that browser. **Log out** at the top ends it in that browser. To log out *every* browser, change `NOTEFEED_PASSWORD` and restart notefeed; scripts use the same password, so update them too.

Wrong passwords count toward the [rate limit](../self-hosting/limits.md#rate-limits-and-caps): after too many, the login page asks you to wait up to a minute.

## Install it and share a link

notefeed ships a web manifest and icons, so a browser can install it as an app (**Install** in Chrome and Edge, **Add to Home Screen** on a phone). Pages also carry a share image and description, so a link pasted into WhatsApp, Slack or similar shows a preview with the notefeed wordmark. The image URL in that preview is absolute: set `PUBLIC_URL` on a public instance, or it follows the `Host` header of the request (see [Configuration](../self-hosting/configuration.md)). On a [locked instance](../self-hosting/access.md#the-password) the icons, manifest, share image, privacy page and imprint stay public, but the pages themselves ask for a login, so a preview of a feed link shows only the image and the generic description.
