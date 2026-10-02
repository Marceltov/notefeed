---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# A feed's name is fixed; its read id can be set and changed, and the old one is freed

## Context and Problem Statement

A feed's name and its read id are random by default, and neither could be changed afterwards (ADR 0001, ADR 0010). Issue #75 asked for both to be editable, because people want readable links. What should be changeable?

## Considered Options

* Both fixed.
* Both changeable, the old ones retired (404 for good, recorded in a file in `DATA_DIR`).
* Both changeable, the old ones freed.
* The name fixed; the read id changeable, the old one freed, and the image URLs in notes rewritten.

## Decision Outcome

Chosen option: "The name fixed; the read id changeable, the old one freed, and the image URLs in notes rewritten".

* **The name stays fixed.** Renaming moves the feed's directory, changes its unlock cookie and needs every name rule twice (taken, reserved, retired). The name is chosen when the feed is created, and a feed that should have another name is a new feed.
* **The read id can be chosen when the feed is created and changed in the settings** (`PUT /api/v1/feeds/{feed}`, the MCP tool and the client packages): 3 to 64 characters, `a-z 0-9 - _`, random when left empty. It must be free: not another feed's read id, not a reserved feed's. Only `.readid` and the index change; nothing moves.
* **The old read id is freed, not retired.** No record is kept, so nothing needs clearing by hand. It answers like any unknown read id (an empty feed) until another feed takes it.
* **Image URLs follow.** An image URL contains the read id, so on a change the feed's notes get `/r/<old>/images/` replaced by `/r/<new>/images/`. Notes keep their ids and RSS `guid`s; only the markdown changes. The title image is stored as a file name and needs nothing.
* Reserved feeds keep read id = name (ADR 0012). A change counts against the post rate limit. `NOTEFEED_ALLOW_CUSTOM_IDS=0` may turn choosing off, leaving only a random id.

Pull request #87 built the variant with both changeable and retired ones; it is closed unmerged.

### Consequences

* Good, because renaming's directory move, cookies and name records are not needed, and no image breaks.
* Bad, because a freed read id can reach another feed: a subscriber to the old link may later read someone else's feed. ADR 0010 avoided that by never reusing ids; here it is accepted, because the owner chose to give the id up and the old link is no longer a capability of this feed. The settings page says so.
* Bad, because the rewrite edits the feed's note files, so a copy made before differs from the notes after.
* Bad, because a short readable read id can be guessed; the settings page warns and says a password protects the feed.
* Bad (ponytail): no per-feed lock, so a change and a post at the same moment can leave one note with the old image URL.
