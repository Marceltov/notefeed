# Reverse proxy

notefeed has its own login, so it's fine to put it on the internet behind a reverse proxy. Only `/feed.xml` and `/login` are public; the web UI needs a login and the API needs the token.

## Caddy

```caddy
notes.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy handles HTTPS and forwards the original `Host`, `X-Forwarded-Proto` and `X-Forwarded-Host`, so links and redirects come out right with no extra settings. Because the public address is `https`, the login cookie is marked `Secure`.

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

If you can't control those headers (for example with a CDN in front), set `PUBLIC_URL`.

!!! warning "Don't put forward auth in front"
    A login gate such as Authentik forward auth in front of notefeed would block feed readers and scripts. notefeed already requires a login for everything except the feed.
