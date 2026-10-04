# Reserved feeds

For feeds that only the operator posts to but everyone may subscribe to, such as `news` or `announcements`. List the names in `NOTEFEED_RESERVED_FEEDS` and set `NOTEFEED_RESERVED_PASSWORD`:

```yaml
NOTEFEED_RESERVED_FEEDS: news,announcements,updates
NOTEFEED_RESERVED_PASSWORD: a-long-operator-password
```

At start-up (not at the first request) each listed name that doesn't exist yet is created as a [protected feed](../using/feed-passwords.md#in-the-api) with that password. Post to it like any protected feed, with `X-Feed-Password: <the password>` (or `Authorization: Bearer` first, if the instance has a password too). Its read id is its name, with no obfuscation: `/r/news` and `/r/news/feed.xml` are the links to hand out, and they never change, even if the feed is deleted and made again at the next start. A reserved feed deleted while running comes back at the next start.

Nobody can create a listed name by posting: that answers `400` (`reserved_feed`). Without `NOTEFEED_RESERVED_PASSWORD` the names are still blocked, but the feeds don't exist. A feed that already had such a name keeps working as it was.

If a reserved name already exists as an open feed, it is not converted: delete its folder in `DATA_DIR` and restart, so notefeed recreates it protected, and the start-up [log](logs.md#logs) warns about it until then.
