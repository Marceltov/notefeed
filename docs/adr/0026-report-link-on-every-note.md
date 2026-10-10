---
status: accepted
date: 2026-10-09
decision-makers: Marcel Bruckner
---

# A report link on every note, from a URL template; notefeed stores no reports

## Context and Problem Statement

A public instance such as the hosted service must let anyone report content that should not be there, fast enough that the operator can act on it (the hosting provider's notice route), and the report has to say which note is meant. notefeed keeps no accounts and stores nothing about anyone (ADR 0014); a report, with its reporter's address and words, would be the first personal data an instance holds. Issue #154, decided in the security review of 2026-10-09, with the operator's takedown (#155) and the hosted service's report form (#156) beside it. Where does the link go, what does it carry, and who stores the report?

## Considered Options

* A **URL template** set by the operator, filled with the note's ids and rendered as a link on every note; the report lands wherever the template points (a form the operator runs, a mailbox). Chosen.
* A **report form in notefeed** that stores reports in the database and shows them to the operator.
* **No link:** an address on the imprint, and readers describe what they saw.

## Decision Outcome

Chosen option: the URL template, because it gives a reader a one-click report that names the note exactly, keeps every report out of notefeed, and leaves the operator free to choose a form, a ticket system or plain mail.

* **A setting, `NOTEFEED_REPORT_URL`.** A URL template with the placeholders `{read_id}`, `{note_id}` and `{file}`, each filled in percent-encoded (`shared/report.ts`). Unset, nothing changes: no link anywhere. A `mailto:` works as well as a form URL.
* **The read id, never the feed name.** The link is on the read-only view, which must not reveal the name (ADR 0001), and the same link on the feed page keeps the two views identical. The read id and the note id open `/r/<read id>/<note id>` and find the feed in the data; the takedown command (#155) takes exactly that.
* **A link on every note,** on the feed page, the note page, the read-only view and its note page, as a small **Report** link beside the tags, with `rel="nofollow noopener"`. An image is a note (ADR 0018), so its link covers the picture; `{file}` carries the file name an image URL ends in.
* **Not in the RSS feed.** RSS 2.0 has no element for it (`<comments>` means something else), and a feed reader opens the item's link, the note in the read-only view, where the link is. Writing it into the description would put it into every reader's rendering of the note itself.
* **notefeed stores nothing.** The report lives where the link leads. The documentation says what the operator should write on the privacy page when the form or the mailbox keeps a reporter's address, and that nothing is hidden automatically on a report: the operator decides.

### Consequences

* Good, because a report names the note exactly, and the operator's tooling can be anything that takes a URL.
* Good, because notefeed's own data stays free of personal data; the report form is the operator's, under the operator's privacy page.
* Bad, because the link is one more thing on every note, also for feeds whose readers would never report anything; an instance that does not want it leaves the setting unset.
* Bad, because a feed reader sees no link until it opens the note.
* Bad, because the template is trusted as given: an operator who writes a template that is not a URL gets a link that does not work, and nothing checks it beyond trimming.
