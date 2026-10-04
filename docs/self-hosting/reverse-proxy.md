# Reverse proxy

To put notefeed on the internet, run it behind a reverse proxy that handles HTTPS. Decide first whether it's open or locked (see [Concepts](../get-started/concepts.md#open-or-locked)): open, anyone can post to a feed whose name they know; locked with `NOTEFEED_PASSWORD`, only you can post, and read links stay public either way.

On a public instance, always set these:

```yaml
environment:
  PUBLIC_URL: https://notes.example.com   # links don't follow the client's Host header
  NOTEFEED_TRUST_PROXY: "1"               # rate limits per client, not one shared bucket
  # NOTEFEED_PASSWORD: ${NOTEFEED_PASSWORD}
  # NOTEFEED_RESERVED_FEEDS: news,announcements   # operator-only feeds, see Configuration
  # NOTEFEED_RESERVED_PASSWORD: ${NOTEFEED_RESERVED_PASSWORD}
```

## Caddy

```caddy
notes.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy handles HTTPS and forwards the original `Host`, `X-Forwarded-Proto` and `X-Forwarded-Host`. From Caddy 2.5 on, it also overwrites `X-Forwarded-For` with the real client address (older versions append it to whatever the client sent), which is what `NOTEFEED_TRUST_PROXY=1` needs. Because the public address is `https`, the login cookie is marked `Secure`.

Keep port 3000 off the internet so only Caddy can reach it. In `compose.yaml`:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

If Caddy runs in Docker too, drop `ports`, put both containers on one network and proxy to `notefeed:3000`.

## Other proxies

Any proxy works if it:

- forwards the original `Host`, or sets `X-Forwarded-Host`
- sets `X-Forwarded-Proto`
- sets `X-Forwarded-For` to the client's address, or appends it to the header the client sent (nginx's `$proxy_add_x_forwarded_for`, for example). notefeed uses the **last** entry, the one the proxy added, so values a client sends itself don't count.

If you can't control `Host` and `X-Forwarded-Host` (for example with a CDN in front), `PUBLIC_URL` covers the links. If the proxy doesn't set `X-Forwarded-For`, leave `NOTEFEED_TRUST_PROXY` unset and accept the shared rate limit. notefeed then also ignores `X-Forwarded-Proto` and `X-Forwarded-Host`, so set `PUBLIC_URL`.

!!! warning "Don't put forward auth in front"
    A login gate such as Authentik forward auth in front of notefeed would block feed readers and scripts. Use `NOTEFEED_PASSWORD` instead: it locks posting and the web UI and leaves read links open. If you want people to log in through your provider, use [sign-in](sign-in/index.md) rather than a gate: it keeps read links, RSS and scripts working.
