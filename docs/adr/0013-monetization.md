---
status: proposed
date: 2026-10-01
decision-makers: Marcel Bruckner
---

# Monetization: feed licenses without accounts

## Context and Problem Statement

notefeed is AGPL software that anyone can self-host, and notefeed.me is the hosted instance. The hosted instance costs money to run and should be able to earn some. Issue #42 names two directions: user accounts with purchases (feeds, messages, password protection), or a license that is entered in the UI and kept in a cookie. What should be sold, to whom is a purchase attached, and how much of it does notefeed itself have to build?

This ADR is a proposal. It recommends a direction and lists the questions only the owner can answer. Nothing is implemented yet.

## Decision Drivers

* The product's point is that there is no sign-up: a feed is a name, and posting is one `curl` line (ADR 0001). Paying should not undo that for people who don't pay, and should undo as little as possible for people who do.
* No user management if it can be avoided: accounts mean login, password reset, e-mail delivery, account deletion and personal data to protect.
* A purchase must work for scripts and other devices, not only in the browser where it was made.
* One developer runs this. Sales tax and VAT across countries, invoices and refunds should be someone else's job.
* Self-hosters must not be affected: an instance without any licensing configuration behaves as today, with everything available.
* Whatever is built should be small and removable if it turns out nobody pays.

## What could be sold

The features that cost the operator something or that matter most to someone who relies on a feed:

* **Protection:** a per-feed password (ADR 0008).
* **Capacity:** more notes per feed than the free cap (`NOTEFEED_MAX_NOTES_PER_FEED`), a higher rate limit, longer retention.
* **Images:** uploads at all, or more storage (issue #12).
* **Names:** a reserved, short or branded name (issue #41 gives the operator the mechanism to hold names back).

The free tier stays what notefeed.me is today: open feeds, by name, with caps.

## Considered Options

* **A. Accounts.** People sign up, log in and buy feeds, capacity or protection; purchases belong to the account.
* **B. License in a cookie.** A bought license key is entered in the web UI and stored in the browser; it travels with requests.
* **C. Feed licenses.** A bought license key is attached to a feed on the server. The feed is then a paid feed, for every script, device and browser that uses it.
* **D. Managed private instances.** Sell a whole locked instance per customer (`team.notefeed.me` with its own `NOTEFEED_PASSWORD`) instead of features on the shared one.
* **E. Donations only.** Sponsorship links, no paid features.

## Decision Outcome

Proposed option: **"C. Feed licenses"**, bought through a merchant of record that also issues and validates the license keys. D can be offered next to it at any time, because it needs no code.

How it would work:

* **Buying:** a checkout page at a payment provider that acts as merchant of record (it is the seller, so it handles VAT, invoices and refunds) and that issues a license key per purchase. Lemon Squeezy and Polar are examples of providers that offer both; their current terms and fees need checking before choosing.
* **Activating:** the owner enters the key in the feed's settings (or sends it with one API call). The server asks the provider whether the key is valid and how many activations it has left, and stores the result in the feed's directory (`.license`: key id, plan, valid-until, last check). A key covers a fixed number of feeds; the provider counts the activations.
* **Using:** nothing changes for requests. Scripts keep posting to the feed's name; the server looks at the feed's license to decide what the feed may do. No cookie, no extra header.
* **Staying valid:** the server re-checks a license with the provider now and then (for example once a day) and keeps working from its stored copy if the provider can't be reached. A subscription that ends is seen at the next check.
* **When a license ends:** the feed keeps its notes and stays readable. It keeps its password (taking protection away would expose a feed without the owner doing anything) but refuses new posts above the free caps until it is renewed. This is a product decision; see the open questions.
* **In the code:** one small module in the backend answers "what may this feed do?" (`entitlements(feed)`: may it have a password, its note cap, its image allowance). The existing checks ask it instead of reading the instance-wide settings directly. With no licensing configured it answers "everything the instance allows", so self-hosted instances are unchanged.

### Consequences

* Good, because there are still no accounts: the thing that is paid for is the feed, which is already the unit everything else hangs on.
* Good, because a license works for `curl`, the clients and MCP without any change on their side.
* Good, because tax, invoices, refunds and the customer's billing page are the provider's.
* Good, because the part notefeed builds is small: one activation call, one stored file per paid feed, one entitlement function.
* Bad, because notefeed.me then depends on the provider's API for activation and re-checks. The stored copy and a grace period cover outages.
* Bad, because a lost license key or a lost feed password is a support request: there is no account to recover through. The provider's order e-mail is the proof of purchase.
* Bad, because whoever knows a feed's name and password can see that it is licensed, and the key's holder can move the license only if activations can be released (a provider feature to check).
* Bad, because AGPL means anyone can run their own instance with every feature for free. That is intended; what is sold is the hosted service.

### Confirmation

Not applicable until this is accepted and built. A first implementation should be testable against a fake provider endpoint, with the real one behind configuration.

## Pros and Cons of the Options

### A. Accounts

* Good, because it is what people expect, with a place to see purchases and recover access.
* Good, because one purchase can cover many feeds and be managed in one place.
* Bad, because it is the largest build by far: sign-up, login, sessions, password reset, e-mail, account deletion, and the personal data that comes with them.
* Bad, because it changes what notefeed is. A feed would belong to an account, and the "no sign-up" property goes for paying users.
* Bad, because the owner has said user management should be avoided (stated while designing per-feed passwords, issue #8).

### B. License in a cookie

* Good, because nothing is stored on the server per purchase.
* Bad, because it only works in the browser that holds the cookie. Scripts, the clients and MCP would each need the key configured and sent on every request.
* Bad, because the entitlement belongs to whoever presents the key at that moment, so a paid feature such as a password or a higher cap would have to be re-proved on every request rather than being a property of the feed.
* Bad, because a cleared browser loses the purchase until the key is entered again.

### C. Feed licenses

See the decision outcome.

### D. Managed private instances

* Good, because it needs no code: every feature already works on a locked instance.
* Good, because it suits teams, who want everything private anyway.
* Bad, because each customer is a deployment to run, update and back up.
* Bad, because it does nothing for the individual who wants one protected feed on notefeed.me.

### E. Donations only

* Good, because it costs nothing to build and restricts nobody.
* Bad, because it rarely covers hosting, and it gives no lever against heavy free use.

## Open Questions (for the owner)

1. **What is free and what is paid?** In particular: is a per-feed password paid (the issue suggests so), or free with paid capacity on top?
2. **Price and shape:** a yearly subscription per feed, a one-time purchase, or packs of feeds?
3. **Which provider?** It needs to be a merchant of record with license keys and an activation API, at acceptable fees, and to pay out to the owner's country.
4. **What happens when a license ends?** The proposal above (keep notes and password, stop posts above the free caps) or something stricter.
5. **Legal pages:** terms, privacy policy, imprint and a refund policy for notefeed.me.
6. **Abuse:** paid capacity raises the cost of abuse; is a content policy and a way to take a feed down needed first?

## More Information

* Issue #42. Related: ADR 0001 (feeds by name, no accounts), ADR 0008 (per-feed passwords), issues #12 (images) and #41 (reserved names).
* If this is accepted, the first step is the `entitlements(feed)` function with only the instance-wide answer behind it. That changes no behaviour and is where licensing later plugs in.
