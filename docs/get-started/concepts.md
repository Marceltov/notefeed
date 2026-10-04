# Concepts

## How feeds work

notefeed works like [ntfy](https://ntfy.sh): there are no accounts and nothing to set up. A feed is a name, such as `homelab-7f3k2q9x4m8wz`. Posting to `/<name>` creates the feed on its first note, and `/<name>` in a browser shows it.

Every feed also has a **read link**, `/r/<read id>/feed.xml`. It serves the feed as RSS, shows none of the feed's name (a [reserved feed](../self-hosting/reserved-feeds.md#reserved-feeds) such as `news` is the exception: its read id is its name), and can't post. That's the link to give to feed readers, dashboards and other people.

!!! warning "Pick a hard-to-guess name"
    The feed name is the key: anyone who knows it can read the feed and post to it. Use something like `homelab-7f3k2q9x4m8wz`, not `homelab`. Share read access with the [read link](../using/read-links.md), never the name.

To keep strangers from posting at all, set a password (`NOTEFEED_PASSWORD`); see [Passwords and access](../self-hosting/access.md#the-password). To protect one feed, give it its own password when you create it: see [Feed passwords](../using/feed-passwords.md#in-the-api).

## Open or locked

Without a password, anyone who can reach notefeed can post to any feed whose name they know, and read it. Feed names are the only secret, so pick hard-to-guess ones. That's fine on a LAN, or on the internet with the caps below.
