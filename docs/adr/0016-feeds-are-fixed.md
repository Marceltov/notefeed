---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# A feed's name and read id are fixed for its lifetime

## Context and Problem Statement

A feed's name and its read id are random by default, and neither can be changed afterwards (ADR 0001, ADR 0010). Issue #75 asked for both to be editable in the settings page and the API, because people want readable links. Should a feed be able to change its name or read id?

## Considered Options

* Fixed: the name and read id never change.
* Changeable, and the old ones are retired (404 for good, recorded in a file in `DATA_DIR`).
* Changeable, and the old ones are freed.
* Changeable, and the old ones stay as aliases.

## Decision Outcome

Chosen option: "Fixed", because every other option costs more than the feature is worth, in a central part of the app.

* Retiring needs a record of retired names and read ids that is read at start-up, answered as 404 in every path (pages, posting, API, MCP, read view, RSS, images), and cleared by hand.
* Freeing the old ones reopens the holes that retiring closes: a script that still posts to the old name silently creates a new feed under it, and a read id can reach another feed (ADR 0010).
* Aliases keep an old capability alive that the owner may have wanted to revoke, and every lookup then has two names for one feed.
* All three change a feed's directory, its `.readid`, its unlock cookie (per name), the URLs of its images (they carry the read id) and the links inside existing notes. Fixed feeds avoid every one of these.

Pull request #87 built the retiring variant; it is closed unmerged.

### Consequences

* Good, because a name, a read id and every URL under them stay valid for as long as the feed exists, and there is no rename code, record or lock to maintain.
* Bad, because someone who wants another name has to create a new feed and move what they need.
* Bad, because the read id is random unless chosen when the feed is created; a readable read link is the follow-up issue.
