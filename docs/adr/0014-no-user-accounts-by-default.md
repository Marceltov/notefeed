---
status: accepted
date: 2026-10-02
decision-makers: Marcel Bruckner
---

# No user accounts by default; access is by capability, and anything with users is opt-in and additive

## Context and Problem Statement

An instance is open or locked with one shared password (ADR 0001, ADR 0008), and a feed can have its own password. Issue #65 asks for sign-in with OAuth/OIDC instead of only that shared password, which raises the larger question: should notefeed have users? The product is a way to pass information as a feed, with no personal data in it. Payment is planned by licence key.

## Considered Options

* Add user accounts: every person signs in, feeds have owners, notes have verified authors.
* No users: access is held by knowing something (a feed name, a feed or instance password, a read link, later a licence key), and nothing stored identifies a person.
* No users by default, with users as an optional mode switched on by an environment variable.

## Decision Outcome

Chosen option: "No users by default". Nothing in the core depends on a user existing, and nothing stored identifies a person.

* **Capabilities, not identities.** Whoever holds the credential for a thing may use it: the feed name and password for posting, the read link for reading, the instance password for the operator, a licence key for a paid feature. A licence is tied to an instance or a feed, never to a person.
* **A note's author is a label.** A note may later carry an optional display name. It is typed by the sender, unverified, and the UI must not present it as an identity.
* **Why:** it keeps management simple (no accounts to create, reset or remove), it keeps the promise that no personal data is stored (nothing to leak, nothing to answer a data request about), and it fits payment by licence key.
* **Allowed without users:** a way in for the operator that uses an identity provider (issue #65) is fine if notefeed stores no user records: the provider's check and an allow-list decide, and the result is one operator session. Tokens that grant posting to one feed, to revoke a single script without rotating a password, are also fine.
* **If users are ever added,** they are an opt-in mode switched on by an environment variable, and they only add. No feature may require the mode, the core keeps working with it off, and the privacy page and imprint say what the mode stores. Feed ownership (who owns a feed, what happens when its owner is removed) has to be decided in its own ADR first.

### Consequences

* Good, because there is no personal data to protect, store or delete, and the model is the one that already exists.
* Bad, because there is no audit trail: notefeed cannot say who posted, edited or deleted a note. A team that needs one cannot use it for that.
* Bad, because a credential cannot be taken from one person: changing a shared password signs out everyone, which per-feed tokens only partly answer.
* Bad, because a verified author name is not possible without users, so the optional name on a note proves nothing.
