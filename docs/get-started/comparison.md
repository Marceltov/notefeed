# notefeed and other tools

notefeed borrows its model from [ntfy](https://ntfy.sh) and is often used beside the tools on this page, not instead of them. This page says what each one is for, so you can tell quickly whether notefeed is the right one.

**In one sentence:** a notification tool gets a short message onto a phone *now*; notefeed keeps a note that is still there, readable and editable, when someone opens the dashboard or the feed reader *later*.

The other tools are described as of October 2026 and from their own documentation. They change: check their docs before you decide.

## At a glance

| | notefeed | [ntfy](https://ntfy.sh) | [Gotify](https://gotify.net) | A chat webhook (Slack, Discord, Telegram) | [Memos](https://usememos.com) |
|---|---|---|---|---|---|
| Made for | Notes from scripts, read later as RSS | Push notifications | Push notifications | Messages in a chat channel | Personal notes |
| Posting | `curl` to a feed name, no account | `curl` to a topic name, no account | An application token, made by a user | A webhook URL from the service | A user's access token |
| Reading | RSS, a web page, the API | Phone apps, web app, a stream | Android app, web app, a stream | The chat app | The web app, the API, RSS for public notes |
| Reaches a phone at once | No | Yes | Yes (Android) | Yes | No |
| RSS for dashboards and feed readers | Yes, every feed | No | No | No | Public notes of a user |
| Read access without write access | Yes, the read link | With accounts and access rules | Client and application tokens are separate | Channel membership | Per-note visibility |
| A note can be edited afterwards | Yes | No | No | By the sender, depending on the service | Yes |
| How long it stays | Until deleted | A cache of hours by default, for phones that were offline | Until deleted | The service's history | Until deleted |
| Content | Markdown and pictures | Text, optional markdown, attachments, action buttons | Text, optional markdown | The service's own format | Markdown and attachments |
| Where it is stored | `.md` files, SQLite or PostgreSQL | The server's cache | The server's database | The service | The server's database |
| Self-hosted | Yes, or [notefeed.me](../hosted.md) | Yes, or ntfy.sh | Yes, only | No | Yes |

## ntfy

ntfy is what notefeed copied its model from: no accounts, a topic is a name, posting is one `curl` line, and the name is the secret. If you know ntfy, [Concepts](concepts.md) will read as familiar.

The difference is what happens to a message afterwards:

- **ntfy delivers.** A message goes to the phones and browsers subscribed to the topic, with a priority, a sound, action buttons and, if needed, an attachment. The server keeps it for a while so that a phone that was offline still gets it, and then forgets it. There is nothing to edit and no RSS: a subscriber listens to a stream or polls JSON.
- **notefeed keeps.** A note is a markdown document with a title, tags and pictures. It stays until someone deletes it, can be [edited](../using/editing.md), has a page of its own, and every feed is an [RSS feed](../using/rss.md) that a dashboard or a feed reader fetches when it likes. Nothing is pushed anywhere: notefeed has no phone app and sends no notifications.
- **Reading and writing are separate in notefeed.** A feed's name lets you post; its [read link](../using/read-links.md) only reads and does not reveal the name, so it can go into a dashboard's configuration or to other people. An ntfy topic name does both, unless you set up accounts and access rules.

**Use ntfy** when someone must know now: an alert, a failed backup at night, a door bell. **Use notefeed** when the text should be there later: last night's backup report on the dashboard, a changelog, a deploy log, release notes for a team.

**Both together** is the common set-up. A script sends the one-line alert to ntfy and the full report to notefeed, and puts the note's read-only page in the notification as its click target. That page is under the read link, so the feed's name never passes through ntfy:

```sh
page=$(curl -s -H "Content-Type: text/markdown" -H "X-Note-Title: Backup failed" \
  --data-binary @report.md "$NOTEFEED_URL/$NOTEFEED_FEED" \
  | jq -r '(.read_url | sub("/feed.xml$"; "")) + "/" + .id')
curl -H "Title: Backup failed" -H "Click: $page" -d "See the report" "https://ntfy.sh/$NTFY_TOPIC"
```

## Gotify

Gotify is a self-hosted notification server like ntfy, with a different model: an administrator creates users, a user creates an *application* and posts with its token, and messages arrive in the Android app or the web UI over a WebSocket. Messages stay until they are deleted.

Compared to notefeed it is again a notification tool: no RSS, no read-only link to hand out, no editing, and nothing works without an account. Choose it over ntfy if you want accounts and tokens from the start; choose notefeed for the things under [ntfy](#ntfy) above.

## A chat webhook

Posting to a Slack, Discord, Matrix or Telegram channel through a webhook or a bot is the usual way to see script output where people already are. It notifies, it is searchable, and people can answer.

What it does not give you: the messages live in a service you may not run, the format is that service's own, a dashboard cannot read the channel without a bot of its own, and a channel is the wrong place for a page-long report with tables and charts. notefeed takes the report; the chat message can link to it.

## Memos and other note-taking apps

Memos, and larger tools such as Joplin Server or Trilium, are places where *a person* writes notes: accounts, an editor, search, tags, sometimes sharing. Memos has an API and serves a user's public notes as RSS, so it can be scripted into something close to notefeed.

notefeed is the other way round: made for scripts first, with a web UI for the occasional note by hand. There is no account to create and no token to manage, a feed exists once something posts to it, and each feed has its own RSS link. It is not a knowledge base: there is no search, no linking between notes and no folders.

## An RSS file written by the script itself

A script can also write an RSS file and let a web server serve it. That works for one job on one machine. notefeed is what you get when several machines post, when a note needs a page, pictures or a correction afterwards, and when the feed should not be public to everyone who can reach the web server.

## When notefeed is the wrong tool

- **You need to be woken up.** notefeed sends nothing. Use ntfy, Gotify or a chat webhook, alone or beside it.
- **You need long-term logs or metrics.** A feed holds notes for people; a log store or a time-series database holds events for queries.
- **You need to know who wrote something.** Notes carry no sender unless the operator switches on [sign-in](../self-hosting/sign-in/index.md).
- **You want a personal knowledge base.** Use a note-taking app.
