---
status: accepted
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Feed settings and feed deletion with the same access as posting, and stored random read ids for new feeds

## Context and Problem Statement

A feed could be created by its first note and then never changed or removed: it had no title, no description, and the only way to get rid of it was to delete its folder on the server. Issue #40 asks for it with only a title, "Edit, delete feeds", and no further detail. The decisions below were made on the owner's behalf while working on it, so each is stated with its reason, to be reviewed and overruled where the owner disagrees. What does "edit" mean for a feed, who may do it, what does deleting remove, and what happens to a feed's read link when the feed is deleted and its name is used again? (Issue #40, building on ADR 0001, ADR 0004, ADR 0005, ADR 0008 and ADR 0009.)

## Decision Drivers

* No accounts: there is nobody to own a feed (ADR 0001).
* One write path for scripts, the web UI, the client packages and MCP (ADR 0005).
* The feed's name is its identity: URLs, the write key and client configuration all use it.
* Deleting a feed must not hand its readers' links to whoever creates the name next.
* No existing read link may change (ADR 0004).
* The web UI must keep working without JavaScript (ADR 0005).
* Plain files, no database, no new dependency (ADR 0001).

## Considered Options

What "edit" means:

* **Settings:** a display title and a description; the name stays.
* **Rename** the feed.

Who may change or delete a feed:

* **Whoever may post to it,** with the same checks as a post.
* **A separate owner key** returned when the feed is created.

What deleting does:

* **A hard delete:** the notes, the settings, the password and the read id are removed, and the name is free again.
* **A trash** that keeps the folder for a while, with an undo.

Read ids:

* **Keep deriving them** from the feed's name and the server secret.
* **A random read id stored per feed,** for feeds created from now on, with derived ids kept for feeds that already exist.
* **A random read id for every feed,** written into each existing feed's folder on upgrade.

## Decision Outcome

Chosen options: settings instead of rename, the same access as posting, a hard delete, and stored random read ids for new feeds with the derived id kept for old ones, because together they add the feature without accounts, a second credential or new storage, and without breaking any read link that exists today.

* **Settings, not rename (a).** A feed gets a `title` (at most 100 characters) and a `description` (at most 500). Both are trimmed, have no control characters and are one line. The name stays what it is: the URL, the write key, and what every script and client has configured. A rename would be "delete the feed and create another under a new name" with extra steps, would break every URL and script that uses the old name, and nobody asked for it. A feed has no settings until someone sets them; the web UI then shows the title as a heading on the feed page and as the browser tab's title, and the description below the heading. The name stays in the page header either way, because it is the key. `PUT` replaces both fields; an empty string clears one. Settings are stored as `DATA_DIR/<feed>/.feed.json`, a plain file that exists once settings have been saved. Clearing both fields writes `{"title":"","description":""}`; a missing or malformed file means both are empty.
* **Who may (b).** Exactly whoever may post to the feed, through the same checks in the same order: the instance password, then the feed's password (ADR 0008), then the per-client rate limit. On an open feed the name is the write key (ADR 0001), so anyone who knows the name of an open feed can now delete the whole feed, notes included, as ADR 0009 already let them delete its notes. This is the decision with the most weight and the one the owner is most likely to want to change. A feed password is the protection, and a feed can only get one when it is created (ADR 0008). A separate owner key would be a second credential to store and hand out, with nowhere in the web UI to keep it, for what is already one secret per feed. The read link stays read-only and can neither change settings nor delete.
* **Hard delete (c).** Deleting removes every note, the settings, the password and the read id, and the name can be used again at once. There is no trash and no undo. A trash would keep a deleted feed's notes on disk after its owner asked for them to go, would need an expiry job and a second state for every feed (live, deleted, expired), and would make the name unavailable or ambiguous while it lasts. The web UI asks for the feed's name to be typed before it deletes. Internally the folder is renamed to `DATA_DIR/.deleted-<random>` first, so the feed disappears in one step, and then removed; a folder left behind by a crash is removed when notefeed starts. The order is: look the feed up in the index, rename its folder away, then drop the index entry, and drop it only if it is still the entry that was looked up, so a feed created under the name in between is left alone. For that moment the index lists a feed whose folder is gone. Readers see an empty feed, a second delete finds no folder and answers `404`, and a post finds no folder, drops the entry and creates a new feed. The same repair runs when someone removes a feed's folder by hand: the next post creates a new feed, and settings, note edits and deletes answer `404`. If the rename fails for any reason other than a missing folder, the delete fails and the index and the folder are as they were. The feed stops counting toward `NOTEFEED_MAX_FEEDS` as soon as the entry is dropped.
* **Stored read ids for new feeds (d).** A read id used to be `HMAC(secret, name)` (ADR 0001, ADR 0004), so it was the same for every feed that ever had that name. With deletion that causes two problems. First, someone who learned a name's read link keeps reading after the feed is deleted and its name is used again, even when the new feed was created protected: they create `alice` open, note its read link, delete it, and can read a protected `alice` that someone else creates later. ADR 0008 already listed this as a known gap and left it to this issue. Second, subscribers of a deleted feed would silently start receiving the notes of whoever creates the name next. So a feed created from now on gets a random read id (22 base64url characters, from 16 random bytes), written to `DATA_DIR/<feed>/.readid`, and a deleted feed's read link stays dead for good: it answers like any unknown read id, an empty feed, and the new feed has a different one. This also closes the gap ADR 0008 left open.
* **Feeds that already exist (e).** A feed folder without a `.readid` is a legacy feed and keeps the id derived from its name, so no read link that exists today changes. It stays derived for as long as the feed lives: nothing is written into existing folders on upgrade, which keeps the upgrade free of writes and a downgrade safe. A legacy feed that is deleted and re-created is a new feed and gets a stored id. This means the warning that changing `NOTEFEED_SECRET` or `.secret` changes read links now applies to legacy feeds only. Every instance still needs the secret: it also signs the unlock cookies of protected feeds (ADR 0008) and the OAuth tokens of MCP clients.
* **A feed appears complete or not at all (f).** A feed is created by its first note. Every feed folder, open or protected, is made the same way: a temporary folder `DATA_DIR/.<random>.tmp` gets the `.readid` (and the password hash, for a protected feed, ADR 0008) and is then renamed to the feed's name. Only after that is the note written. If the id were written after the note, the index could load a folder that has a note but no `.readid`, treat it as a legacy feed, and give it the derived id; a feed whose first note arrives at the same moment as a restart would then get a derived id for good. The rename fails when a non-empty folder with that name exists, so of two first posts at once exactly one creates the feed. The other reads the winner's `.readid` and uses that id, unless the index already has the feed by then. If a write fails, the temporary folder is removed, and one left behind by a crash is removed when notefeed starts. Nothing else creates a feed folder: writing a note, settings or a password into a folder that is gone fails instead of making it again.
* **Duplicate and unreadable ids (g).** If two folders hold the same `.readid`, the first in sorted order keeps it and the other falls back to its derived id, so a read id always maps to one feed. This happens when a folder is copied by hand, because the copy carries `.readid`; the copy should have the file removed, since the folder that sorts first can be the copy. If that derived id belongs to another feed too, the feed has no read link. A `.readid` whose content is not a read id is logged, without the feed's name, and the feed falls back to its derived id, the id it had before the file existed. A `.readid` that cannot be read at all (a permission error, say) is logged the same way, and the feed is listed with no read link until the next start. It does not fall back to the derived id, because an error that may pass would then change the feed's link, and it does not stop the other feeds from loading. A feed without a read link shows none in the web UI, and its `read_url` is `null` in `GET /api/v1/feeds/{feed}`, in the answer to a post and in MCP's `post_note`.
* **Settings are public to readers, and need the password by name (h).** The title and description show on the feed page, in the read-only view, in `GET /api/v1/read/{readId}` and as the RSS channel title and description. They are not secret, and the read link already lets anyone read every note; the feed's name stays hidden. They are read by name (`GET /api/v1/feeds/{feed}`) with the same access as reading the notes, so a protected feed needs its password; a locked feed's page shows only the unlock form, with no title and no description. An unknown read id answers with empty strings, like the note list, so ids can't be probed.
* **Settings only on an existing feed (i).** A feed is created by its first note and can only get a password then (ADR 0008). `GET`, `PUT` and `DELETE` on `/api/v1/feeds/{feed}` answer `404` for a feed that does not exist and never create one. A feed that exists only as an empty folder is fine: see the consequences.
* **API and web UI.** `GET /api/v1/feeds/{feed}` (`getFeed`, `200` with `name`, `title`, `description`, `protected` and `read_url`, which is `null` while the feed has no notes), `PUT` on the same path (`updateFeed`, `200` with the feed) and `DELETE` (`deleteFeed`, `204`), and the public `GET /api/v1/read/{readId}` (`getReadFeed`). `backend/posting.ts` has `updateFeed` and `deleteFeed` next to the other writes, and routes, forms and clients all call them (ADR 0005). Edits and deletes count against the same per-client post limit. The web UI gets a "Feed settings" section and a "Delete feed" section on the feed page. With JavaScript they call the API. Without it they are plain forms to `POST /<feed>/settings` and `POST /<feed>/delete`, which accept only requests from the instance's own pages (the `Origin` check of ADR 0005 and ADR 0008) for the reasons given in ADR 0009.
* **No MCP tools for feeds (j).** Assistants post and read notes, and edit and delete them (ADR 0009). Changing or deleting a whole feed stays with people and scripts: an assistant that can delete a feed can destroy everything a person has posted there with one wrong call. Tools can be added when someone asks.
* **Clients.** Both packages get `feedInfo`, `updateFeed` and `deleteFeed` (`feed_info`, `update_feed`, `delete_feed` in Python). There are no CLI commands for feeds.
* **What this changes in earlier ADRs.** ADR 0001 says the read id is derived from the feed's name and the secret; that now holds only for feeds created before this decision. ADR 0004's index mapped read ids to names by computing the HMAC for every folder; it now maps both ways and is loaded from the `.readid` files, falling back to the derived id. Each of those two ADRs has a one-line note pointing here and is otherwise unchanged.

Out of scope: rename, transfer of a feed, a trash or undo, and a feed image (issue #12 adds it to these settings).

### Consequences

* Good, because every entry point shares one access check and one write path, and an instance that never uses settings behaves as before.
* Good, because a deleted feed's read link is dead for good, so neither a former reader nor a new owner's subscribers can be exposed to the other, and a re-created feed can be protected without leaking to an earlier link holder.
* Good, because no read link that exists today changes, and no existing folder is written to on upgrade.
* Bad, because anyone who knows the name of an open feed can delete it with all its notes. A feed password is the protection, and a feed only gets one when it is created. There is no backup and no undo in notefeed.
* Bad, because a mistaken delete cannot be undone.
* Bad, because backups must now include the dot files in each feed folder: `.readid`, `.feed.json` and `.password`. A copy that leaves out `.readid` changes the read link of that feed to the derived one, and a restored feed whose `.readid` is missing is indistinguishable from a legacy feed. Tools that skip hidden files, and `cp *` without `-a`, lose them.
* Bad, because a post that is already in flight when its feed is deleted creates a new feed: the note is written after the old folder is gone, so it ends up in a new feed of the same name, with a new read id, no password and no settings. It can never write into the deleted folder or bring it back. A post whose note is written just before the folder is renamed away is answered `201` and deleted with the feed.
* Bad, because there is no lock per feed. The index and the folders are kept in step by the order of the steps and by repairing on the next write, not by a lock. Two deletes and a creation of the same name within a few milliseconds can leave the name listed without a folder until the next post or delete, either of which puts it right. Worse, the second delete was admitted against the old feed and renames the new feed's folder away, even if the new feed was created protected, so the creating post's note is lost or that post is a `500`; a lock per feed is the fix. A write that waits a long time between its access check and its file (a password change, for example) lands in a feed of the same name that was deleted and created again in between.
* Bad, because a first note that fails after the feed's folder and `.readid` were written (a full disk, say) leaves an empty feed folder. That is an existing, open, empty feed: it counts toward `NOTEFEED_MAX_FEEDS` and cannot be given a password, because a password can only be set when a feed is created. Deleting the feed removes it: in the web UI, where the delete section shows for any feed that exists, through the API, or by removing its folder.
* Bad, because a feed whose `.readid` cannot be read when notefeed starts has no read link until the file is fixed and notefeed restarts.
* Bad, because a feed's title and description are public to anyone with its read link, so nothing private should go in them.
* Bad, because there are now two kinds of feeds: legacy feeds, whose read link still depends on `NOTEFEED_SECRET` and `.secret`, and newer ones, whose read link does not. Deleting `.secret` changes the read links of the first kind and never of the second. It still locks every unlocked browser and signs out every MCP client, because the secret signs those too.

### Confirmation

Vitest covers the following.

* The feed index (`backend/feeds.test.ts`): a new feed gets a stored id that survives a restart and differs from the derived one; a legacy folder keeps its derived id and no file is written to it; both kinds resolve; a `.readid` that is not a read id; a duplicate one; a feed left without a read link stores no id; a `.readid` that cannot be read leaves the other feeds loading and that feed without a read link; the id is on disk before the first note; concurrent first posts agree on one id; a protected feed's stored id; the logs carry no feed names.
* Creation (`backend/data/feeds.write-failure.test.ts`): a failed `.readid` write leaves no folder behind, for open and protected feeds.
* Deletion (`backend/feeds.test.ts`): the folder and its notes, settings and password go, the name can be reused and gets a new read id, the old id answers like an unknown one, and a post in flight ends in a complete new feed.
* The order of deletion and creation, with single file system calls slowed down (`backend/feeds.race.test.ts`): a delete with a slow rename against a post started at the same moment, also right after a restart; a post, a protected creation and a second delete while the folder is gone and the index still lists the feed; a rename that fails for another reason than a missing folder leaves the index and the folder untouched; a creation that lost to another one whose feed is deleted before it reads the winner's `.readid`. Each ends with the index and the disk agreeing and the old read id dead. `backend/http/feeds.test.ts` repeats delete against post, `ensureFeed` and a protected creation with natural timing, through the API.
* A folder removed by hand (`backend/feeds.test.ts`, `backend/http/feeds.test.ts`): a post creates a new feed and answers with its new read link; settings, a note's edit and delete and the feed's delete answer `404`, a password change `409`, and none of them makes the folder again.
* Leftovers (`backend/feeds.test.ts`, `backend/http/feeds.test.ts`): `.deleted-<12 hex>` and `.<12 hex>.tmp` folders are removed when the index loads, and nothing else is, not even a file with such a name.
* A feed without a read link answers `read_url: null` to a post and to `GET /api/v1/feeds/{feed}` (`backend/http/feeds.test.ts`) and in MCP's `post_note` (`backend/mcp.test.ts`), and both client packages accept it.
* A password change that races a delete answers `404` (`backend/feedlock.race.test.ts`).
* The settings' validation and storage, the API operations and their `400`, `401`, `404` and `429` answers on open and protected feeds, that a refused `PUT` never has its body read, the public read endpoint and the RSS channel title and description (`backend/http/feeds.test.ts`).
* The form routes (`backend/http/feedforms.test.ts`): same-origin only, the typed-name confirmation, and the redirects, where a refusal goes back to the feed page with `form=details` so the page shows it next to the settings.
* Both client packages (`packages/js/test`, `packages/python/tests`).

Playwright (`e2e/feeds.spec.ts`) sets a title and description in the browser and sees them on the feed page, in the read-only view and in the RSS; sees a refused title explained in the settings section, with JavaScript and where the plain form's redirect lands; deletes the feed, lands on the start page, and finds the old read link empty.
