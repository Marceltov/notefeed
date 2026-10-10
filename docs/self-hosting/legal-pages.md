# Imprint and privacy page

notefeed ships no imprint and no privacy page: who runs an instance, and what it does with data, is different for each one. If yours needs them, which a public instance in the EU does, you write them and point notefeed at the files:

```yaml
services:
  notefeed:
    environment:
      NOTEFEED_IMPRINT_FILE: /legal/imprint.md
      NOTEFEED_PRIVACY_FILE: /legal/privacy.md
    volumes:
      - ./legal:/legal:ro
```

| Setting | Page |
|---|---|
| `NOTEFEED_IMPRINT_FILE` | `/imprint`, linked as **Imprint** in the footer |
| `NOTEFEED_PRIVACY_FILE` | `/privacy`, linked as **Data privacy** in the footer |

- **The files are Markdown**, shown the way a note is: headings, lists, tables and links work, and raw HTML is shown as text.
- **Each is optional.** Without a setting, or with one that names no readable file, the page answers `404` and the footer has no link to it. The [start-up log](logs.md#logs) says when a setting is there but its file cannot be read.
- **Both pages are public,** also on an instance with a [password](access.md#the-password): an imprint has to be reachable without logging in.
- **A change shows at once.** The file is read on every request; nothing needs restarting. Keep it small: a file over 256 KiB is not shown.
- **Keep the files in version control** with the rest of your deployment. For a privacy page it matters what it said on which day.

`imprint` and `privacy` are [reserved feed names](../using/feeds.md), with or without the files.

## A notice on the start page

`NOTEFEED_NOTICE_FILE` names a third Markdown file. Its text is shown as a red warning banner on the start page, above the introduction: the place to say that the service is still being built, that a maintenance window is coming, or what you do not promise.

```yaml
services:
  notefeed:
    environment:
      NOTEFEED_NOTICE_FILE: /legal/notice.md
```

- **The same rules as for the two pages:** Markdown shown the way a note is, read on every request, at most 256 KiB, and the start-up log says when the setting is there but its file cannot be read.
- **Only the start page shows it.** Feed pages, read links, RSS and the API do not, and on an instance with a [password](access.md#the-password) it is seen after logging in.
- **To take it down,** remove the setting or empty the file.
- **It is not a contract.** What you promise, or do not, belongs on a page people can link to; the notice can point there.

## What to write

That is yours to decide, and for a public service worth a lawyer's look. As a start, a privacy page usually says who is responsible and how to reach them, where the instance is hosted and by whom, what is stored (notes, feeds, images; [what the logs hold](logs.md#logs)), for how long, [how long backups keep what was deleted](backups.md#how-long-a-backup-keeps-what-was-deleted), and which rights a person has. If you switch on [sign-in](sign-in/sender.md#privacy-page-and-imprint), say what is stored about the people who sign in.

## A report link on every note

A public instance has to give readers a way to report content that should not be there, and the report has to say which note is meant without guessing. `NOTEFEED_REPORT_URL` puts a **Report** link on every note, on the feed page, the note page and the read-only view. It is a URL template; three placeholders are filled in, percent-encoded:

| Placeholder | Value |
|---|---|
| `{read_id}` | The feed's read id: what the read link and the image URLs carry. Never the feed name, which is the key to posting |
| `{note_id}` | The note's id |
| `{file}` | The note's file name, `<id>.md` or the picture's `<id>.png` and so on: what an image URL ends in |

```yaml
services:
  notefeed:
    environment:
      # A form the operator runs:
      NOTEFEED_REPORT_URL: "https://report.example.com/?read_id={read_id}&note_id={note_id}"
      # or plain e-mail:
      # NOTEFEED_REPORT_URL: "mailto:abuse@example.com?subject=Report%20{read_id}/{note_id}"
```

- **Unset, nothing changes:** no link anywhere.
- **notefeed stores no reports.** The link only leads away: to a form you run, or to a mailbox. What you do with a report, and how fast, is yours.
- **The RSS feed carries no report link:** a feed reader shows the item's link, which opens the note in the read-only view, and the link is there.
- **Say so on the privacy page** when the form or the mailbox keeps a reporter's address or message: what is stored, for how long, and why (handling the report), the same way the page explains e-mail. A report is the one thing an anonymous instance may hold that names a person.
- **The feed's read link is the link to the content.** `{read_id}` and `{note_id}` are enough to open `/r/<read id>/<note id>` and to find the feed in the data; an operator's takedown takes a read link or an image URL.
