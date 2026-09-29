# notefeed — design

Date: 2026-09-29
Status: draft, awaiting review

## Purpose

A small self-hosted app to post short markdown notes — by hand from a web UI, or from scripts over an HTTP API — and read them back as an RSS feed. Each note is stored as a plain `.md` file.

The motivating use: a dashboard (e.g. Glance/Dynacat) can read RSS but has nowhere to *post* to. notefeed is that inbox. No existing tool fits: Memos removed RSS in v0.31.0 and stores notes in SQLite; tools like mdrss are CLIs, not servers.

## Success criteria

- `curl -H "Authorization: Bearer $TOKEN" --data-binary @note.md http://host/api/notes` creates a note.
- A logged-in user can write and submit a note in the web UI.
- The note appears in `/feed.xml`, which a feed reader fetches without credentials.
- Each note exists on disk as `<DATA_DIR>/<id>.md` containing exactly what was posted.
- `docker run` with only `NOTEFEED_TOKEN` set is secure by default: no unauthenticated write or UI access.

## Non-goals (for now)

Editing, deleting (remove the file), tags, search, pagination, multiple users, a private/tokened feed, markdown→HTML in the feed. Each can be added when actually missed.

## Stack

- Next.js (App Router, TypeScript, `output: "standalone"`), Tailwind.
- `react-markdown` + `remark-gfm` to render notes in the UI.
- RSS XML written by hand (no feed library).
- Vitest for tests.
- License: MIT.

Backend stays in Next.js (route handlers + server actions). All disk access goes through one module, `lib/notes.ts`, so a separate backend (e.g. Python) can replace it later without touching the UI.

## Storage — `lib/notes.ts`

```ts
type Note = { id: string; title: string; markdown: string; createdAt: Date };

createNote(markdown: string): Promise<Note>
listNotes(limit?: number): Promise<Note[]>   // newest first
getNote(id: string): Promise<Note | null>
```

- File: `$DATA_DIR/<id>.md`, content byte-for-byte as posted.
- `id` = `YYYYMMDDTHHMMSSZ-<slug>` (UTC), e.g. `20260929T140512Z-backup-finished`. `createdAt` is parsed from the id; no frontmatter, no sidecar files.
- Slug: title lowercased, non-alphanumerics collapsed to `-`, max 50 chars, `note` if empty.
- Title: first `# ` heading, else first non-empty line with leading markdown markers stripped; trimmed to 100 chars.
- Collision (same second, same slug): append `-2`, `-3`, … Never overwrite (create with exclusive flag).
- Atomic write: write to a temp file in `DATA_DIR`, then rename.
- `getNote` validates `id` against `^\d{8}T\d{6}Z-[a-z0-9-]+$` before touching disk; invalid → `null`. This blocks path traversal.
- `listNotes` reads the directory, sorts filenames descending (the id format sorts chronologically), reads only the first `limit` files.

## Auth — `lib/auth.ts`

One shared secret, `NOTEFEED_TOKEN` (required; the app refuses to start without it).

- API: `Authorization: Bearer <token>`, compared in constant time.
- UI: `/login` form takes the token; on success sets an httpOnly, `SameSite=Lax` cookie holding an HMAC of a fixed string keyed by the token (not the raw token). `Secure` when the request is HTTPS. Middleware redirects unauthenticated UI requests to `/login`; it skips `/login`, `/feed.xml`, `/api/*` (bearer-checked in the handler) and `/_next/*` static assets. `/logout` clears the cookie.
- Changing the token invalidates all sessions.
- `/feed.xml` and `/login` are public.

## Routes

| Route | Purpose | Auth |
|---|---|---|
| `GET /` | Compose form (server action) + newest notes, rendered | cookie |
| `GET /n/[id]` | One note, rendered; the RSS item `<link>` | cookie |
| `GET /login`, `POST` via server action | Token login | public |
| `POST /logout` | Clear cookie | cookie |
| `POST /api/notes` | Body `text/markdown`/`text/plain`, or JSON `{"markdown": "..."}` → `201 {"id","url"}` | bearer |
| `GET /feed.xml` | RSS 2.0, newest 50 | public |

## Feed

- RSS 2.0, `<channel>` title from `NOTEFEED_TITLE` (default `notefeed`), link = `PUBLIC_URL`.
- Per item: `<title>` (escaped), `<link>`/`<guid isPermaLink="true">` = `PUBLIC_URL/n/<id>`, `<pubDate>` RFC 822 from `createdAt`, `<description>` = raw markdown in CDATA (`]]>` split safely).
- `Content-Type: application/rss+xml; charset=utf-8`.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `NOTEFEED_TOKEN` | — (required) | Shared secret for API and UI login |
| `DATA_DIR` | `/data` | Where `.md` files live |
| `PUBLIC_URL` | derived from request | Absolute base URL for feed links |
| `NOTEFEED_TITLE` | `notefeed` | Feed/channel title |

## Errors

| Case | Response |
|---|---|
| Missing/wrong bearer token | `401` |
| Empty body (after trim) | `400` |
| Body > 100 KB | `413` |
| Unsupported content type | `415` |
| Unknown or invalid note id | `404` |
| Disk write failure | `500`; no partial file left behind |

## Packaging and CI

- Multi-stage `Dockerfile`: `node:22-alpine` build → standalone runtime, non-root user, `VOLUME /data`, port 3000.
- `.github/workflows/ci.yml`: on push/PR run lint, type-check, `vitest`; on `main` also build and push `ghcr.io/marceltov/notefeed:latest` and `:sha-<short>`.
- `README.md`: what it is, `docker run`/compose example, curl example, env table, and a note that exposing it publicly behind a reverse proxy is fine because auth is built in.

## Testing

Vitest, temp `DATA_DIR` per test:

- `lib/notes`: title extraction (heading, first line, empty), slug/id format, collision suffix, traversal ids rejected, newest-first ordering, file content equals input.
- `lib/auth`: bearer accept/reject, cookie value verifies only for the current token.
- Feed: parses as XML, `]]>` in a note survives, links are absolute.
- `POST /api/notes`: 401 without token, 400 empty, 413 oversize, 201 with token and the file exists.

Manual smoke test before release: `docker run`, curl a note, see it in `/feed.xml`, log in to the UI and post one, see both in a feed reader.

## Out of scope for this repo

Deployment to a specific host (compose file, proxy rules, dashboard widget config) lives in the operator's own infrastructure repo.
