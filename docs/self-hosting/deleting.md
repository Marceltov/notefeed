# Deleting notes and feeds

A feed's owner can delete it from the web UI or the [API](../using/feeds.md#feed-settings-in-the-api). That removes the notes, the images, the settings, the password and the read link, frees the name, and takes the feed out of the `NOTEFEED_MAX_FEEDS` count at once. notefeed first renames the folder to `.deleted-<random>` in `DATA_DIR` and then removes it; if it stops in between, the leftover folder is removed at the next start. A new feed's folder is likewise made as `.<random>.tmp` and renamed into place, and one left by a crash is removed at the next start too.

Reserved feeds ([Reserved feeds](reserved-feeds.md)) are created at every start if they are missing, so one deleted or removed by hand comes back, empty and with the same read link, at the next start. They count toward `NOTEFEED_MAX_FEEDS` like any feed.

You can also delete a note's file, or a feed's whole folder, yourself. It disappears from the web UI and the feed straight away. notefeed still lists a feed you removed by hand, as an empty feed that counts toward `NOTEFEED_MAX_FEEDS`, until someone posts to that name, deletes the feed, or notefeed restarts. A post to that name creates a new feed, with a new read link and no password.

```sh
rm data/homelab-7f3k2q9x4m8wz/20260929T140512Z-backup-finished.md
rm -r data/homelab-7f3k2q9x4m8wz
```

## A feed that is empty and cannot get a password

If a feed's first note fails to save (a full disk, say), notefeed may leave an empty feed folder with its `.readid`. That is an existing, open feed with no notes: it counts toward `NOTEFEED_MAX_FEEDS`, and it cannot be given a password, because a password can only be set when a feed is created. Delete the feed and create it again. The easiest way is **Delete feed** on the feed's page in the web UI; `DELETE /api/v1/feeds/<feed>` or removing the folder do the same.

## A feed without a read link

If notefeed can't read a feed's `.readid` when it starts (wrong permissions, say), it logs that, without the feed's name, and lists the feed without a read link until the next start: the feed page shows none, and `read_url` and `image_url` are `null` in the API. Uploading an image to it is refused with `404`, because an image's URL is built from the read id. Posting and reading by name work as usual. notefeed does not fall back to another read id, because that would change the feed's link. Make the file readable and restart notefeed. The same happens to a feed whose `.readid` and computed read id both belong to other feeds, which takes two hand-made copies.

## Removing a feed as the operator

When content is reported that must go (see [A report link on every note](legal-pages.md#a-report-link-on-every-note)), the operator does not know the feed's name: a report carries a read link or an image URL. With `NOTEFEED_OPERATOR_TOKEN` set, `POST /api/operator/takedown` takes any of them and removes the feed for good:

```sh
curl -X POST -H "Authorization: Bearer $NOTEFEED_OPERATOR_TOKEN" -H "Content-Type: application/json" \
  -d '{"target": "https://notes.example.com/r/homelab-7f3k2q9x4m8wz/20260929T140512Z-3f2b8c1e.png"}' \
  https://notes.example.com/api/operator/takedown
```

```json
{ "removed": true, "already_removed": false, "notes": 12, "images": 3, "blocked": 3, "image_keys": ["…"] }
```

`target` is a read link (`/r/<read id>`, with or without `/feed.xml` or a note's id), an image URL (`/r/<read id>/<file>`) or a bare read id. What happens, in this order:

1. **A tombstone** is written with the feed's name and its read id. From that moment the feed is found by neither: the feed page, the read-only view, the RSS feed and the files answer *removed by the operator* (`410`), the read API (`/api/v1/read/<read id>…`) and posting to the name answer `410` (`removed`), and no feed can ever be created with that name or given that read id.
2. **The notes and the image bytes go**, from the database rows and from the image store alike (on the file system backend, the folder). `image_keys` names the image store objects that went, for the purge of backups.
3. **The hashes of the images** go on the instance's blocklist: the same bytes are refused with `451` (`blocked`) in every feed, as an image note, a replaced picture or a picture sent with a text.

Things to know:

- **Nothing about anyone is written.** The log says that a feed was removed and how much went, never which feed (the name is the write key), and nothing about who reported it.
- **Tombstones and the blocklist are data:** they are in the database (`tombstones`, `blocked_images`) or in `DATA_DIR/.tombstones` and `DATA_DIR/.blocklist` on the file system backend, so a backup restores them with the rest, and a restore from before the takedown brings the feed back: run the takedown again then. The file system backend removes a tombstoned feed's folder again at the next start if a restore brought it back.
- **A removed read id or name cannot be reused,** not even by the operator. A reserved feed that is removed is not made again at the next start.
- **A read id nobody has** answers `404`; one that was removed before answers `200` with `already_removed`.
- **Backups:** the dumps and image copies made before still hold the content. What to do with them after a takedown is the operator's procedure, not notefeed's.
- The [clean-up of the image store](storage.md#cleaning-up-the-image-store) is not affected: the blocklist holds hashes, not objects.
