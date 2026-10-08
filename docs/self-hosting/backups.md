# Backups

Back up the `data` folder, including `.secret` and the dot files inside each feed folder: `.readid`, `.feed.json` and `.password`. There's no database: restoring the files restores the notes, the settings and the passwords. A backup that skips hidden files (a plain `cp *`, or a tool with a default exclude) loses them: a feed without its `.readid` gets the read link computed from its name and `.secret` instead, which is a different link for any feed created since feed deletion was added, and a feed without its `.password` is open. Restoring `.secret` keeps the read links of older feeds the same, and unlocked browsers and MCP clients signed in (unless `NOTEFEED_SECRET` is set, which then decides both). Restart notefeed after restoring: it reads the list of feeds once at startup, so the read links of restored feeds only work after a restart.

```sh
tar czf notefeed-notes.tgz -C data .
```

With a [database](storage.md#databases) instead of files, back up the database: `pg_dump` for PostgreSQL, the file (or `sqlite3 notefeed.db ".backup out.db"`) for SQLite. Keep your `NOTEFEED_SECRET` with the backup: it is not in the database.

With [image bytes outside the database](storage.md#image-bytes-outside-the-database) (`NOTEFEED_IMAGES=fs` or `s3`), back up the images folder or the bucket as well. Take the database backup first and the images second: an image that is in the second but not the first is only an unused file, while a note in the database whose image is missing from the backup shows as broken.

## How long a backup keeps what was deleted

A backup still holds every feed and note that was deleted after it was made. So how long you keep backups is how long deleted notes live on, and the times add up when one backup holds another: database dumps kept 1 day on a server whose disk is backed up for 7 days are 8 days, not 7.

On a public instance, decide that number and say it on your [privacy page](legal-pages.md#what-to-write). Change the two together.
