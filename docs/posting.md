# Posting notes

Send the note's markdown to `POST /api/notes` with the token as a bearer token:

```sh
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" \
  --data-binary @note.md \
  https://notes.example.com/api/notes
```

notefeed stores the body exactly as sent, byte for byte, and answers `201 Created`:

```json
{"id": "20260929T140512Z-backup-finished", "url": "https://notes.example.com/n/20260929T140512Z-backup-finished"}
```

!!! tip "Use `--data-binary`, not `-d`"
    `curl -d` strips newlines from files. `--data-binary` sends the file unchanged.

## Formats

| Content type | Treated as |
|---|---|
| none | raw markdown |
| `text/markdown`, `text/plain` | raw markdown |
| `application/x-www-form-urlencoded` | raw markdown (what `curl --data-binary` sends by default) |
| `application/json` | an object with a string field `markdown` |

Any other content type is rejected with `415`. The body must be UTF-8.

JSON is handy from languages where building a raw body is awkward:

```sh
curl -H "Authorization: Bearer $NOTEFEED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"markdown": "# Deploy done\nversion 1.4.2 on host-2"}' \
  https://notes.example.com/api/notes
```

## Titles and filenames

- **Title:** the first `# ` heading. Without one, it's the first non-empty line, with list and quote markers removed. `#` lines inside fenced code blocks are ignored. Titles are cut to 100 characters.
- **File:** `<DATA_DIR>/<id>.md`, where the id is the UTC time to the second plus a slug of the title, e.g. `20260929T140512Z-backup-finished`. Accented letters become plain ones (`Café` → `cafe`). A title with no usable letters becomes `note`.
- **Collisions:** two notes with the same title in the same second get `-2`, `-3` and so on. An existing note is never overwritten.

## Errors

| Status | When |
|---|---|
| `400` | The note is empty; the JSON is invalid or has no string `markdown`; the body is not UTF-8 |
| `401` | The `Authorization` header is missing or the token is wrong |
| `413` | The body is larger than 100 KB (102400 bytes) |
| `415` | The content type is not one of those above |
| `500` | The note could not be written. No partial file is left behind. |

Error responses are JSON: `{"error": "<short reason>"}`.

## From a script

For Python and Node, the [client libraries](clients.md) do this for you, with a `notefeed` command for shell scripts. With plain curl:

A backup job that reports how it went:

```sh
#!/usr/bin/env bash
set -euo pipefail

if output=$(restic backup /srv 2>&1); then status="finished"; else status="FAILED"; fi

printf '# Backup %s on %s\n\n```\n%s\n```\n' "$status" "$(hostname)" "$(tail -n 5 <<<"$output")" |
  curl -fsS -H "Authorization: Bearer $NOTEFEED_TOKEN" --data-binary @- \
    https://notes.example.com/api/notes > /dev/null
```

The same from Python, with only the standard library:

```python
import json, os, urllib.request

req = urllib.request.Request(
    "https://notes.example.com/api/notes",
    data=json.dumps({"markdown": "# Disk space low\n/srv is 92% full"}).encode(),
    headers={
        "Authorization": f"Bearer {os.environ['NOTEFEED_TOKEN']}",
        "Content-Type": "application/json",
    },
)
print(json.load(urllib.request.urlopen(req))["url"])
```
