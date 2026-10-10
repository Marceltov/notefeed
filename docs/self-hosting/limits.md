# Rate limits and caps

Each client may post, edit or delete `NOTEFEED_RATE_LIMIT` notes per minute (60 by default), from the API and the web UI together. Wrong passwords have their own budget of the same size. A feed password check that is still running counts toward it until it turns out right, so a script that sends more than that many requests to protected feeds at the same instant can see a `429` for some of them. Over it, notefeed answers `429` with a `Retry-After` header, for the rest of the minute; the web UI says how many seconds to wait. The counters live in memory and reset on restart.

!!! warning "Behind a reverse proxy, set `NOTEFEED_TRUST_PROXY=1`"
    notefeed can't see a client's IP on its own, so without `NOTEFEED_TRUST_PROXY` **all clients share one rate-limit bucket**. On an exposed instance, one busy script can then slow everyone down, and an attacker's wrong password guesses can lock the owner out of posting and logging in for up to a minute.

    With `NOTEFEED_TRUST_PROXY=1`, the **last** address in `X-Forwarded-For` is the client: the address the proxy in front of notefeed saw. Anything a client puts in the header itself comes before it and is ignored, so a proxy that overwrites the header and one that appends to it both work. Set it only when that proxy sets `X-Forwarded-For` and clients can't reach notefeed directly. Caddy does this by default; see [Reverse proxy](reverse-proxy.md).

On a public open instance, cap how much space strangers can take:

```yaml
environment:
  NOTEFEED_MAX_FEEDS: 100
  NOTEFEED_MAX_NOTES_PER_FEED: 1000
```

Two settings limit images. `NOTEFEED_MAX_IMAGE_BYTES` is the size of one image (5242880, 5 MiB, by default; at most 10 MiB, 10485760, because the request body passes through Next's proxy, which buffers at most 10 MiB and would cut a larger image short); over it, the post answers `413`. `NOTEFEED_MAX_IMAGES_PER_FEED` is how many image notes one feed may hold (`0`, the default, means no limit); over it, posting another image answers `507`. Deleting an image note frees a place. Image posts also count toward `NOTEFEED_RATE_LIMIT`.

```yaml
environment:
  NOTEFEED_MAX_IMAGE_BYTES: 2097152
  NOTEFEED_MAX_IMAGES_PER_FEED: 200
```

## No pictures at all

The caps bound how many pictures a feed takes; `NOTEFEED_IMAGE_UPLOADS=0` takes none. Every picture is then refused with `403` (`images_off`), whichever way it comes: an image note, a picture replaced with `PUT`, a note posted with pictures (nothing of that note is stored), from the API, MCP and the web UI alike. The compose box and the note editor show no **Add image** button and say that images can't be posted; a file dropped or pasted into them is refused with the same words. What is already stored is untouched: pictures keep being served, a title image stays, deleting notes and feeds and the operator's [clean-up](storage.md#cleaning-up-the-image-store) work as before. The hosted service runs with it until pictures become a paid feature.

```yaml
environment:
  NOTEFEED_IMAGE_UPLOADS: 0
```

Over a cap, posting answers `507`. The caps are checked, not locked, so several posts at the same moment can overshoot by a few. Delete notes or feeds to make room (see [Deleting notes and feeds](deleting.md)).
