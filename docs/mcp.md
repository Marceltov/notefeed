# MCP

notefeed has an [MCP](https://modelcontextprotocol.io) endpoint, so AI assistants such as Claude can post notes to a feed and read them back. It lives at `/mcp`, for example `https://notes.example.com/mcp`, and serves any number of feeds: the feed name is a parameter of each tool.

| Tool | What it does |
|---|---|
| `post_note` | Posts a markdown note to a feed. Takes `feed` and `markdown`. |
| `list_notes` | Lists a feed's notes, newest first, without their text. Takes `feed`, optionally `limit` (1–100, default 20) and `before`. |
| `get_note` | Reads one note with its markdown. Takes `feed` and `id`. |

Posting follows the same rules as the [HTTP API](posting.md): size limit, rate limit, caps, and the first post creates the feed. Results use the API's field names.

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

Add a custom connector and give it the URL `https://notes.example.com/mcp`. On an open instance that's all. On an instance with a password, the connector opens notefeed's login page: check that it names the client and the host it returns to, enter the instance password and press **Allow**. See [OAuth](configuration.md#oauth) for how that works and how long it lasts.

OAuth needs the instance's public `https://` address: set `PUBLIC_URL=https://notes.example.com`, or `NOTEFEED_TRUST_PROXY=1` behind a reverse proxy that sets `X-Forwarded-Proto` and `X-Forwarded-Host`.

A client may register only `https://` redirect URIs, or plain `http://` on `localhost` or `127.0.0.1`, and must return to exactly the one it registered, port included. Clients whose callback has its own scheme, such as `cursor://`, can't log in through OAuth: send the password as a `Bearer` header instead, as for [Claude Code](#claude-code).

## Telling the assistant which feed

The assistant needs a feed name. Put it in a project or custom instruction, for example "Post notes to the notefeed feed `homelab-7f3k2q9x4m8wz`."

!!! warning "The feed name works like a password"
    Anyone who knows it can read the feed and post to it, and the assistant sees it. The tool descriptions ask the model not to repeat it, but don't give it a name you wouldn't share with that service. Use a [hard-to-guess name](index.md#how-feeds-work).

Notes the assistant reads are text from your feed: don't point it at a feed that strangers can post to.
