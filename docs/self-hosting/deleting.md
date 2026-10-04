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
