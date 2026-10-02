# MCP

notefeed has an [MCP](https://modelcontextprotocol.io) endpoint, so AI assistants such as Claude can post notes to a feed and read them back. It lives at `/mcp`, for example `https://notes.example.com/mcp`, and serves any number of feeds: the feed name is a parameter of each tool.

| Tool | What it does |
|---|---|
| `post_note` | Posts a markdown note to a feed. Takes `feed` and `markdown`. |
| `list_notes` | Lists a feed's notes, newest first, without their text. Takes `feed`, optionally `limit` (1–100, default 20) and `before`. |
| `get_note` | Reads one note with its markdown. Takes `feed` and `id`. |
| `edit_note` | Replaces a note's markdown; its id stays. Takes `feed`, `id` and `markdown`, and returns the note. |
| `delete_note` | Permanently deletes a note. Takes `feed` and `id`, and returns `{ "deleted": true }`. It is marked as destructive, so clients can ask you before running it. |
| `get_feed` | Takes `feed`, and returns its title, description, title image URL, whether it is protected, and its read link. |
| `update_feed` | Replaces a feed's title, description and title image. Takes `feed`, `title`, `description` and optionally `image`, and returns the feed. |
| `delete_feed` | Permanently deletes a feed with all its notes, settings, password and read link. Takes `feed`, and returns `{ "deleted": true }`. It is marked as destructive. |
| `upload_image` | Uploads a PNG, JPEG, GIF or WebP image to an existing feed. Takes `feed` and `data` (the image's bytes, base64), and returns `file`, `url` and `markdown` (`![](url)`, to put in a note). The same [rules as the API](posting.md#images): size limit, rate limit, public URL. `update_feed` takes the returned `file` as `image` to make it the feed's title image. |

Posting follows the same rules as the [HTTP API](posting.md): size limit, rate limit, caps, and the first post creates the feed. Editing and deleting follow [Editing and deleting notes](posting.md#editing-and-deleting-notes): the same access as posting, the same rate limit, and a note that does not exist is the error "no such note". Anyone who can post to a feed can use these tools on it, and a deleted note cannot be brought back, so think before giving an assistant a feed it should only add to. Results use the API's field names.

!!! note "Protocol version"
    The endpoint speaks MCP **2026-07-28** and nothing older. A client that only knows older versions can't connect: it gets a `400` naming the supported version. Update the client.

## Claude Code

On an open instance:

```sh
claude mcp add notefeed --transport http https://notes.example.com/mcp
```

On an instance with a [password](configuration.md#the-password), send it as a bearer token, as the API does:

```sh
claude mcp add notefeed --transport http https://notes.example.com/mcp --header "Authorization: Bearer <password>"
```

## Claude.ai and Claude Desktop

Add a custom connector and give it the URL `https://notes.example.com/mcp`. On an open instance that's all. On an instance with a password, the connector opens notefeed's login page: check that it names the client and the host it returns to, enter the instance password and press **Allow**. See [OAuth](configuration.md#oauth) for how that works and how long it lasts. If the instance has [sign-in](identity.md#mcp) switched on, that login page also has a **Sign in with** button for each provider, and no extra setup is needed at the providers: the one redirect URI of [the sign-in setup](identity.md#urls-and-what-the-provider-needs) covers MCP clients too.

OAuth needs the instance's public `https://` address: set `PUBLIC_URL=https://notes.example.com`, or `NOTEFEED_TRUST_PROXY=1` behind a reverse proxy that sets `X-Forwarded-Proto` and `X-Forwarded-Host`.

A client may register only `https://` redirect URIs, or plain `http://` on `localhost` or `127.0.0.1`, and must return to exactly the one it registered, port included. Clients whose callback has its own scheme, such as `cursor://`, can't log in through OAuth: send the password as a `Bearer` header instead, as for [Claude Code](#claude-code).

## Feeds with a password

A feed can have its own password (see [Posting notes](posting.md#a-feed-with-its-own-password)). All nine tools take an optional `password`; an empty one is the same as none. `post_note` with a password to a feed that doesn't exist yet creates it protected; to an existing feed that has none, it answers with the error "feed already exists and has no password". On a protected feed, every tool needs the right `password`, or answers with the error "missing or wrong password". Wrong passwords count toward the [failed-attempt limit](configuration.md#rate-limits-and-caps); a call without a password does not. The password is not remembered between calls, and it is part of the conversation, so tell the assistant only passwords you would give that service. It is in addition to the instance login, which still decides who may use `/mcp` at all.

## Telling the assistant which feed

The assistant needs a feed name. Put it in a project or custom instruction, for example "Post notes to the notefeed feed `homelab-7f3k2q9x4m8wz`."

!!! warning "The feed name works like a password"
    Anyone who knows it can read the feed, post to it, and edit and delete its notes, change its settings, delete the feed, and the assistant sees it. The tool descriptions ask the model not to repeat it, but don't give it a name you wouldn't share with that service. Use a [hard-to-guess name](index.md#how-feeds-work).

Notes the assistant reads are text from your feed: don't point it at a feed that strangers can post to.
