---
status: accepted
date: 2026-10-03
decision-makers: Marcel Bruckner
---

# A note is a file with a metadata sidecar; an image is a note

## Context and Problem Statement

Until now a note was always a markdown file with a small `---` block at the top for its sender and tags, and an image was something a note could contain: a file named by the hash of its bytes, uploaded separately and referred to from the text (ADR 0011, ADR 0017). Issue #91 asks for notes that are any file, starting with images: a photo feed, pictures dropped into the compose box without any text, and, later, notes that notefeed can only store and serve (the planned encryption). A binary file has no place for a front matter block, and putting metadata in the content mixes what a person wrote with what notefeed knows about it. What is a note, where does its metadata live, and what happens to the hash-named images? (Amends ADR 0011 and ADR 0017. Amended by ADR 0019: one API for every type of note, strict about its Content-Type; the picture endpoint is gone.)

## Considered Options

* Keep markdown with front matter, and let an image be a markdown note whose body is the picture's link.
* Keep front matter for markdown and add a sidecar only for other files.
* Store every note as its content file exactly as posted, with the metadata of every kind of note in a sidecar next to it.

## Decision Outcome

Chosen option: the third. One rule for every kind of note, and the content is never touched.

* **Files.** A note is `<DATA_DIR>/<feed>/<id>.<ext>`: `md` for markdown, `png`, `jpg`, `gif` or `webp` for an image. The content is stored byte for byte as posted. Its metadata is in an optional sidecar `.<id>.<ext>.json` (the content file's complete name plus `.json`): `title`, `sender`, `tags`, `alt`, `name` (the original file name) and `created`, all optional. A note with no metadata has no sidecar. A sidecar with no content file is ignored, and an unreadable one counts as no metadata.
* **Writes.** The sidecar is written first and the content is then linked into place without overwriting, so a listed note always has its metadata and a failure leaves no half note. A delete removes the content first, then the sidecar. An edit replaces the content and leaves the sidecar as it is.
* **What is a note.** A non-dot file in the feed folder with one dot, a stem of letters, digits, `-` and `_`, and a known extension. Dot files (`.readid`, `.feed.json`, `.password`, sidecars, temporary files) are never notes and never served. Ids are not enforced: the ones notefeed makes are `<UTC stamp>-<uuid v7>`, which carry the time, but a file placed by hand under another name is a note too. A note is dated by the id's stamp, else by `created` in its sidecar, else by the file's modification time; lists sort newest first, ties by id.
* **Kinds in code.** A note is a `Note` object with a subclass per kind (`MarkdownNote`, `ImageNote`) and one registry line per kind (`backend/note/types.ts`). What differs between kinds (the title, the RSS content, what an edit may change) is on the class; listing, posting and serving look the kind up by extension. Another file type is a subclass and a line in the registry.
* **Posting.** What can be posted is restricted by that registry, for now to markdown and the four image formats, recognized by their bytes (SVG is refused). `POST /<feed>` takes a markdown body as before, and an image body, or a multipart `file` part, as an image note. `POST /api/v1/feeds/{feed}/images` is the same for clients that send the picture itself, so the generated clients, the web UI and the packages can type it. Image notes have their own cap (`NOTEFEED_MAX_IMAGES_PER_FEED`) and size limit (`NOTEFEED_MAX_IMAGE_BYTES`).
* **Serving.** `GET /r/<read id>/<file>` serves every non-dot file of the feed: the type comes from the extension alone, with `nosniff` and a sandbox CSP; images are cached for good, other files are not, and anything that is not an image or markdown is a download. A symbolic link in the folder is not followed.
* **References.** A markdown note refers to an image note by its file name, `![](<id>.<ext>)`, resolved against the current read id as in ADR 0017. The hash-named images are gone. The web UI holds dropped pictures in the browser, refers to each by its local name, and on Post uploads them as notes and swaps the names for the new files.
* **Titles.** Every note may have a `title` in its sidecar, set when posting or editing; without one a markdown note is titled by its text (a note that starts with a picture by the picture's alt text) and an image note has none.
* **Title image.** The feed's `image` setting is still a file name; it must now be the file of an image note of the feed, and goes with that note.
* **RSS.** An image note is an item with an `<enclosure>` and no description.
* **No migration.** There were no users and the data was test data, so notes with a front matter block and hash-named images are not supported.

### Consequences

* Good, because a note's content is always exactly what was posted, which a note notefeed cannot read (encryption) needs, and the API, the files on disk and a copy of the folder all agree.
* Good, because markdown and images are handled by one rule, so the next file type is a class and a registry line rather than a new storage scheme.
* Good, because pictures are posted without any text, can be listed, deleted and chosen as the title image like any note, and arrive in RSS readers as enclosures.
* Bad, because a note is now two files, so a copy or a backup that takes only the content files loses the metadata, and a hand edit of a note's sender or tags is an edit of a JSON file.
* Bad, because the same picture posted twice is two notes and two files, where the hash named it once.
* Bad, because `POST /<feed>` and `POST /api/v1/feeds/{feed}/images` both post a picture; the second exists so generated clients can type the body.
* Bad, because dates for names we did not make are a fallback (sidecar, then modification time), so a file restored from a backup may sort by when it was restored.
