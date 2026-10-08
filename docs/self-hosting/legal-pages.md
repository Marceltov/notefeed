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

## What to write

That is yours to decide, and for a public service worth a lawyer's look. As a start, a privacy page usually says who is responsible and how to reach them, where the instance is hosted and by whom, what is stored (notes, feeds, images; [what the logs hold](logs.md#logs)), for how long, and which rights a person has. If you switch on [sign-in](sign-in/sender.md#privacy-page-and-imprint), say what is stored about the people who sign in.
