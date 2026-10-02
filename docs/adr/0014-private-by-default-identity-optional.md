---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# Private by default, with optional sign-in that adds a verified sender to notes

## Context and Problem Statement

An instance is open or locked with one shared password (ADR 0001, ADR 0008), and a feed can have its own password. Issue #65 asks for sign-in with OAuth/OIDC instead of only that shared password, which raises the larger question: should notefeed know who people are? The product is a way to pass information as a feed, and payment is planned by licence key. Some people who run it want no personal data at all; others, such as a team, want to know who posted.

## Considered Options

* Always require accounts: every person signs in, feeds have owners.
* Never know who anyone is: access is only by credential, and nothing identifies a sender.
* Private by default, with an opt-in identity mode switched on by environment variables: the self-hoster chooses.

## Decision Outcome

Chosen option: "Private by default, identity optional". The default is the model notefeed already has, and the self-hoster can turn on sign-in through an OpenID Connect provider.

* **Default (identity mode off):** access is by capability: the feed name and password for posting, the read link for reading, the instance password for the operator. Nothing stored identifies a person. A note may carry an optional `name`, a label typed by the sender and unverified; the UI never presents it as an identity.
* **Identity mode (on):** the operator configures an OIDC provider (issuer, client id and secret, and an allow-list of who may sign in). A web session or an MCP client authorised through it posts with a **verified `sender`**, taken from the provider's claims, shown next to the note and kept apart from the unverified `name`. The password keeps working for scripts; a note posted that way has no verified sender.
* **No user records.** notefeed has no accounts table, no profiles and no password for a person. Identity comes from the provider on each sign-in, and the only thing stored is the sender on the notes that person posted. A person is removed by removing them from the provider's allow-list; their old notes keep the sender until deleted.
* **Licences stay by feed.** A licence key belongs to a feed (or an instance), never to a person, with identity mode on or off.
* **Rules for the mode:** it only adds. No feature may require it, and the core must work with it off. The privacy page and imprint say what an instance with it on stores, because a sender name or address is personal data and the operator is its controller. Feed ownership (who may change or delete a feed) is not part of this decision and needs its own ADR before it is built.

### Consequences

* Good, because the self-hoster decides: a no-personal-data instance and a team instance are the same software.
* Good, because the verified sender needs no account system, only the provider's claims and a field on the note.
* Bad, because two modes need two sets of tests and docs, and the privacy statements differ between them.
* Bad, because a stored sender is personal data inside plain note files: deleting a person's data means deleting or editing their notes, and a copy in a backup or an RSS reader is out of notefeed's reach.
* Bad, because without identity mode there is still no audit trail, and a shared password cannot be taken from one person.

* Bad, because a note stored before this change whose text is exactly `---\nsender: "X"\n---` reads as having a sender, with identity mode on or off, since earlier notes can't be told apart from typed ones.

### Resolved questions

* **Storage and claim:** the claim is `name`, falling back to `email`. It is stored as a `sender: "<name>"` frontmatter line in the note's `.md` file, read and written only in `backend/data/notes.ts`.
* **Where it is shown:** everywhere by default (feed page, read view, RSS item, API JSON), with a per-feed "Show who posted" setting (`show_sender`) that hides it from the public read view, RSS and public read API. The sign-in page says the name is shown on the public read link and RSS.
* **Providers:** generic OIDC discovery with the authorization code flow and PKCE first.
