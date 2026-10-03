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
* The same, without rewriting notes: images found by file name (see ADR 0017).

## Decision Outcome

Chosen option: "The name fixed; the read id changeable, the old one freed, and the image URLs in notes rewritten", amended while building it (issue #89) to "without rewriting notes": notefeed is to hold notes it cannot read (planned encryption), so it must never edit their content. See ADR 0017.

* **The name stays fixed.** Renaming moves the feed's directory, changes its unlock cookie and needs every name rule twice (taken, reserved, retired). The name is chosen when the feed is created, and a feed that should have another name is a new feed.
* **The read id can be chosen when the feed is created and changed in the settings** (`PUT /api/v1/feeds/{feed}`, the MCP tool and the client packages): 3 to 64 characters, `a-z 0-9 - _`, random when left empty. It must be free: not another feed's read id, not a reserved feed's. Only `.readid` and the index change; nothing moves.
* **The old read id is freed, not retired.** No record is kept, so nothing needs clearing by hand. It answers like any unknown read id (an empty feed) until another feed takes it.
* **Image links follow where they can, and notes are never edited.** A note can name an image by file name (`![](<file>)`); it is shown from the feed's current read link, so it follows a change (ADR 0017). The title image is a file name too. A full URL written into a note keeps the old read id and is the user's to change; the settings page and the docs say so.
* Reserved feeds keep read id = name (ADR 0012). A change counts against the post rate limit. `NOTEFEED_ALLOW_CUSTOM_IDS=0` may turn choosing off, leaving only a random id.

Pull request #87 built the variant with both changeable and retired ones; it is closed unmerged.

### Consequences

* Good, because renaming's directory move, cookies and name records are not needed, and the title image and relative image links do not break.
* Bad, because a freed read id can reach another feed: a subscriber to the old link may later read someone else's feed. ADR 0010 avoided that by never reusing ids; here it is accepted, because the owner chose to give the id up and the old link is no longer a capability of this feed. The settings page says so.
* Bad, because an image link written as a full URL breaks when the read id changes; notefeed does not touch note content, so changing it is up to the user.
* Bad, because a short readable read id can be guessed; the settings page warns and says a password protects the feed.
* Bad (ponytail): read id changes are serialised for the whole process, not per feed; fine while they are rare.
