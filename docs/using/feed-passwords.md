# Feed passwords

## In the web UI

On a feed that doesn't exist yet, the box has an optional **Password** field. Fill it in and the first note creates a protected feed. A password is 1 to 256 printable ASCII characters (unaccented letters, digits, symbols and spaces) with no space at the start or end, so that it also works from a script; the browser refuses anything else. The field is only there for a new feed: an existing feed can't get a password afterwards.

A protected feed asks for its password before it shows anything, at `/<feed>`: an **Unlock** form. The browser then stays unlocked (a cookie for that feed, with no end date) until the password changes or you press **Lock**. Wrong passwords count toward the [rate limit](../self-hosting/limits.md#rate-limits-and-caps); opening the page without entering one does not. Once unlocked, a **Feed password** section on the settings page lets you change the password, remove it (the feed stays, open to anyone who knows its name; both need the current password) or **Lock this browser** again. Changing the password signs every other browser out. The ready-to-copy `curl` command on an unlocked feed includes the `X-Feed-Password` header.

The [read-only view](read-links.md#the-read-only-view) and the RSS link stay open. See [A feed with its own password](#in-the-api) for scripts, and [A lost password](#a-lost-password) if the password is lost.

## In the API

A feed can have a password of its own, so that strangers who guess or learn its name can't read or post. It is set only when the feed is created: send it as `X-Feed-Password` with the feed's first note.

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

!!! warning "An empty password creates an open feed"
    An empty `X-Feed-Password` is the same as none, and curl leaves out a header whose value is empty. So with `$FEED_PASSWORD` unset, a plain `"X-Feed-Password: $FEED_PASSWORD"` on the first post creates an open feed without any error, and an open feed can never get a password afterwards. `${FEED_PASSWORD:?}` makes the shell stop with an error instead of sending the request.

The password is 1 to 256 printable ASCII characters: unaccented letters, digits, symbols and spaces, with no space at the start or end. That way the same password arrives unchanged in a header and in the password forms. Anything else (`ä`, an emoji, a tab) is refused with `400`. An empty `X-Feed-Password` is the same as none. A password sent to a feed that already exists and has none is refused with `409` and `feed_exists`: an open feed can't be claimed afterwards. The first post to a name that doesn't exist yet creates a protected feed only if the note itself is valid.

After that, posting to the feed, reading its notes (`GET /api/v1/feeds/<feed>/notes`, and one note by id) and opening `/<feed>` in a browser all need the password. Scripts send it on every request:

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz

curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/notes
```

On an instance with a password, send both: `Authorization: Bearer $NOTEFEED_PASSWORD` for the instance and `X-Feed-Password` for the feed. The [read link](read-links.md) stays open, so feed readers need no change. A password in the body only creates a feed; it never unlocks one, so use the header to post to a protected feed.

To change the password, `PUT /api/v1/feeds/<feed>/password` with the current password in `X-Feed-Password` and the new one in a JSON body. To remove it, `DELETE` the same URL. The feed stays, open to anyone who knows its name. Both answer `204`, and both answer `409` on a feed that has no password: they can't add one.

```sh
curl -X PUT -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: application/json" \
  -d '{"password": "a-new-password"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/password

curl -X DELETE -H "X-Feed-Password: ${FEED_PASSWORD:?}" \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/password
```

Changing the password signs every browser out of the feed. A wrong or missing feed password is `401`; note that this tells a stranger that a protected feed of that name exists, though not what is in it or its read id. Wrong passwords count toward the same per-client limit as the instance password; a request with no feed password at all is refused but not counted. If the password is lost, see [A lost password](#a-lost-password).

## How it is stored

Besides the instance password, a single feed can have its own, set by whoever creates the feed: see [A feed with its own password](#in-the-api). It needs no setting. The two work together: on a locked instance a protected feed needs `Authorization: Bearer <instance password>` and `X-Feed-Password`. The instance password does not open a protected feed. Read links stay open either way.

Each feed's password is stored as a salted scrypt hash in `DATA_DIR/<feed>/.password`. If a password is lost, delete that file: the feed is open from the next request. See [A lost password](#a-lost-password). Wrong feed passwords count toward the same [failed-attempt limit](../self-hosting/limits.md#rate-limits-and-caps) as the instance password. A request that sends no feed password at all is refused without being counted, so strangers who merely open a protected feed can't lock its owner out.

## A lost password

A feed with its own password keeps a salted scrypt hash in `DATA_DIR/<feed>/.password`. The file is read on every request, so deleting it opens the feed at once, with its notes intact, and no restart is needed. The feed's owner can then post to it again, but the password can't be set again: a password is only set when a feed is created.

```sh
rm data/homelab-7f3k2q9x4m8wz/.password
```

To keep a feed protected, copy its notes to a new feed created with a new password. Back up `.password` with the notes: it is part of the feed's folder.
