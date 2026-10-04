# Titles and tags

## Titles

Every note can have a title of its own, up to 100 characters on one line. A title holds no control characters (U+0080 to U+009F included), no line or paragraph separator (U+2028, U+2029) and no text-direction override characters (U+202A to U+202E, U+2066 to U+2069), or it is `400`; right-to-left text and its marks are fine. The same goes for a picture's alternative text. What an older version stored, or was edited by hand, is shown with each of those characters replaced by a space (titles, alt texts, senders and a feed's title and description, in the web UI, the API, RSS and MCP). Without one, a markdown note is titled by its first heading or first line, and a note that starts with a picture by that picture's alt text; a picture without one shows as the picture. To set one when you post, send the `X-Note-Title` header; later, `PATCH` it. In the web UI it is the **Title** field of the compose box and of the editor. The title is metadata, not part of the file: replacing the content leaves it, and an empty title removes it so the title follows the text again.

## Tags

A note can carry tags: short labels that say what it is, such as `ci`, `deploy` or `failed`, so readers and tools can tell notes apart and filter them. Set them when you post, in the `X-Note-Tags` header:

```bash
curl -H "Content-Type: text/markdown" -H "X-Note-Tags: ci,deploy" --data-binary '# Deploy finished' "$NOTEFEED_URL/$FEED"
```

- **Where:** the `X-Note-Tags` header, comma-separated. An empty header is no tags.
- **Rules:** at most 10 tags per note, each 1 to 32 characters of lowercase letters, digits, `-`, `_`, `.` and `:` (so `env:prod` works). Capitals are folded to lowercase and duplicates are dropped. Anything else is a `400` (`invalid_body`) that names the tag.
- **Not verified:** tags are free labels set by whoever posts. They are no identity and give no access, and `source:github-actions` is a convention you choose, not something notefeed checks. They are shown on the public read link and in RSS like the note itself, and a feed's **Show who posted** setting does not hide them.
- **Where they show:** the `tags` array of the note in the API (an empty list for a note without any, including every note posted before tags existed), the [web UI](web-ui.md#tags), the [MCP](../integrations/mcp.md) tools, and the RSS item as one `<category>` per tag.
- **Filtering:** `?tag=ci` on the note list (`GET /api/v1/feeds/<feed>/notes`, the read API, the feed page and the read-only page) and on the RSS feed (`/r/<read id>/feed.xml?tag=ci`), so a reader can subscribe to one kind of note. A tag nobody used gives an empty list.
- **Editing:** a `PUT` keeps the note's tags; there is no way to change them after posting.
- **Stored** in the note's metadata file, as `tags: ["ci","deploy"]` (see [Storage](../self-hosting/storage.md#where-notes-live)).

## Ids and filenames

- **Title:** the first `# ` heading. Without one, it's the first non-empty line, with list and quote markers removed. `#` lines inside fenced code blocks are ignored. Titles are cut to 100 characters.
- **File:** `<DATA_DIR>/<feed>/<id>.md` (or `.png`, `.jpg`, `.gif`, `.webp`), exactly the body as posted, with the note's metadata in `.<id>.<extension>.json` next to it. The id is the UTC time to the second plus a random UUID, e.g. `20261002T091400Z-3f2b8c1e-7d4a-4e6b-9a15-c0d2e8f41b73`, so neither the id nor the file name nor the note's URLs carry its title. Notes created before that keep their slugged ids.
- **Collisions:** two notes with the same title in the same second get `-2`, `-3` and so on. An existing note is never overwritten.
