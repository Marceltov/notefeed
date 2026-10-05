# notefeed

A place to post short notes to a named feed, by script or by hand, and read them back as RSS. There are no accounts: knowing a feed's name is what lets someone post to it.

## Language

### Feeds

**Feed**:
A named collection of notes, created by its first note.
_Avoid_: Channel, topic, board

**Feed name**:
The fixed name of a feed, and the secret that grants reading and posting. It never changes.
_Avoid_: Feed id, slug, key

**Read id**:
A feed's second identifier, which grants reading only and does not reveal the feed name. It can be changed.
_Avoid_: Read key, read token, public id

**Read link**:
A URL built on the read id that serves the feed read-only, as RSS or as the read-only view.
_Avoid_: Share link, public link

**Read-only view**:
The feed page as seen through a read link: the notes, with nothing to post, edit or delete.
_Avoid_: Public page

**Feed settings**:
A feed's title, description, title image and whether the sender is shown.
_Avoid_: Feed config, feed metadata

**Title image**:
The image shown at the top of a feed, chosen in the feed settings.
_Avoid_: Icon, cover, banner

**Protected feed**:
A feed with its own feed password, needed to post to it and to open its feed page. Its read link stays open.
_Avoid_: Private feed, locked feed

**Open feed**:
A feed with no feed password.
_Avoid_: Public feed

**Reserved feed**:
A feed whose name the operator has listed: only the operator posts to it, and its read id is its name.
_Avoid_: System feed, official feed

### Notes

**Note**:
One posted item in a feed: a piece of markdown text or an image, stored exactly as posted.
_Avoid_: Post, message, entry, item

**Image**:
A note whose content is an image file. Anyone with the read link can see it.
_Avoid_: Picture, photo, media

**Attachment**:
An image posted together with a text note in the same request and referred to from that text.
_Avoid_: Upload, embed

**Metadata**:
What is known about a note besides its content: title, sender, tags, alt text, file name and creation time. It is never part of the content.
_Avoid_: Front matter, properties, sidecar

**Sender**:
The verified identity of the person who posted a note. Present only when the note was posted by someone signed in.
_Avoid_: Author, user, poster

**Tag**:
A label on a note that a feed can be filtered by.
_Avoid_: Label, category

### Instances and access

**Instance**:
One running installation of notefeed with its own data.
_Avoid_: Server, deployment, tenant

**Operator**:
The person who runs an instance and sets its configuration.
_Avoid_: Admin, owner

**Hosted service**:
The instance run for the public at notefeed.me.
_Avoid_: SaaS, cloud version

**Locked instance**:
An instance with an instance password, needed to post to any feed and to use the web UI. Read links stay open.
_Avoid_: Private instance, protected instance

**Instance password**:
The one password of a locked instance, set by the operator.
_Avoid_: Admin password, global password

**Feed password**:
The password of one protected feed, set by whoever created the feed.
_Avoid_: Feed key

**Sign-in**:
The optional way for a person to prove who they are, so that their notes carry a sender. Off by default.
_Avoid_: Login, accounts, user management

**Cap**:
An operator-set upper limit on how much an instance stores: feeds, notes per feed, images per feed, and the size of an image.
_Avoid_: Quota, limit

**Storage backend**:
Where an instance keeps its feeds and notes: the file system or a database.
_Avoid_: Data layer, persistence, store

**Image store**:
Where an instance on a database keeps the bytes of its images: in the database, in a folder, or in an object store.
_Avoid_: Blob store, file store, media storage, bucket
