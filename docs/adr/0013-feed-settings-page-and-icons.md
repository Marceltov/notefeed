---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# A settings page for a feed, and lucide-react for icons

## Context and Problem Statement

The feed page had collected four `<details>` blocks under the compose box (settings, delete, password, script) and a read link section, each added by a different feature. They looked alike, the read link's action sat at the end of a sentence, and the header and the **Add image** control were plain text. Where do the feed's settings live, and how are icons drawn? (Issue #62.)

## Considered Options

* Keep the blocks and restyle them.
* Move everything about the feed itself to its own page, `/<feed>/settings`, and keep the feed page for writing and reading.
* Icons as hand-written inline SVGs, or as `lucide-react`.

## Decision Outcome

Chosen: a settings page, and `lucide-react`.

* The feed page keeps the compose box and the notes; its header has icon buttons for the read-only view, RSS and Settings. The settings page has General, Read link (with the `curl` command), Feed password and Delete feed, the last one set apart. It sends a locked feed, or one without notes, back to the feed page.
* The page needs the path `/<feed>/settings`, which a route handler held (the form post for title and description). Next cannot put a page and a route handler on one path, so that form now posts to `/<feed>/details`. The password forms (`/access`) and delete form (`/delete`) are unchanged; their redirects land on the settings page.
* `lucide-react` is imported per icon, so only the used ones are bundled. Hand-drawn SVGs would be one more thing to keep consistent for ten or more shapes.

### Consequences

* Good, because each concern has one clearly named place and the feed page is shorter.
* Bad, because the read link is no longer on the feed page; the header's Read-only and RSS buttons are the shortcuts.
* Bad, because the no-JavaScript forms moved from `/<feed>/settings` to `/<feed>/details`; scripts use the API and are unaffected.
