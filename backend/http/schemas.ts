// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them.
import * as z from "zod";
import { ERROR_CODES } from "../../shared/errors";
import { PASSWORD_RULE } from "../../shared/password";
import { FEED_RE } from "../feeds";
import { TAG_RE, TAG_RULE } from "../tags";

export const NOTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const MAX_LIMIT = 100;

export const NoteJson = z
  .object({
    id: z.string().regex(NOTE_ID).describe("The note's id: a UTC time to the second plus a random UUID for notes made here; any name without a dot for a file placed by hand"),
    type: z.string().describe("The media type of the note's file: `text/markdown`, `image/png`, `image/jpeg`, `image/gif` or `image/webp`"),
    file: z.string().describe("The note's file name, `<id>.<extension>`"),
    file_url: z.url().nullable().describe("Where the note's file is served, absolute, under the feed's read id (public like the read link); null while the feed has no read link"),
    size: z.number().int().describe("The size of the note's file in bytes"),
    title: z.string().describe("The title set for the note, else the first heading or the first non-empty line of a markdown note, else the picture's alt text; may be empty"),
    content: z.string().optional().describe("The note's text, byte-for-byte as posted: for a text type (markdown) only; absent for a picture"),
    alt: z.string().optional().describe("Alternative text of an image note, when it has one"),
    name: z.string().optional().describe("The file name an image was posted with, when it came with one"),
    created_at: z.iso.datetime().describe("When the note was posted (UTC)"),
    url: z.url().describe("The note's page in the web UI"),
    sender: z.string().nullable().optional().describe("Verified sign-in name of the poster; absent when the note was posted without a sign-in"),
    tags: z.array(z.string()).describe("Labels the poster gave the note (not verified, and shown to readers like the note itself); empty when none"),
  })
  .meta({ id: "Note" });
export type NoteJson = z.infer<typeof NoteJson>;

export const NoteList = z
  .object({
    notes: z.array(NoteJson).describe("Newest first"),
    next: z.string().nullable().describe("Pass as `before` for the next (older) page; null on the last page"),
  })
  .meta({ id: "NoteList" });

export const Created = z
  .object({
    id: z.string().regex(NOTE_ID),
    url: z.url().describe("The note's page in the web UI"),
    feed_url: z.url().describe("The feed's page in the web UI"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link, safe to share; null only if the server can't read the feed's stored read id, or if that id and the derived one both belong to other feeds"),
    file: z.string().describe("The note's file name, `<id>.<extension>`. For an image note, pass it as a feed's `image` setting"),
    file_url: z.url().nullable().describe("Where the note's file is served, absolute, under the feed's read id (public like the read link); null while the feed has no read link"),
  })
  .meta({ id: "Created" });
export type Created = z.infer<typeof Created>;

export const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).optional().describe("Stable machine-readable code; absent only on a 500"),
  })
  .meta({ id: "Error" });

const NoteTitle = z.string().describe("The note's title, at most 100 characters, one line; empty or left out means the title is taken from the text (a markdown note) or there is none (an image)");
const NoteAlt = z.string().describe("Alternative text of an image note, at most 500 characters, one line");
export const MetaJson = z.object({ title: NoteTitle.optional(), alt: NoteAlt.optional() }).meta({ id: "NoteMeta" });
export const PasswordJson = z.object({ password: z.string().describe(`The new password: ${PASSWORD_RULE}`) }).meta({ id: "PasswordJson" });

export const FeedPasswordHeader = z
  .string()
  .describe(
    "The feed's own password, when it has one: to post, list or get, and (as the current password) to change or remove it. " +
      "On the `POST` that creates a feed it sets the feed's password; on a `POST` to an existing feed that has none it answers 409. " +
      "An empty value is the same as no header, so a `POST` with an empty one creates an open feed.",
  );
export const NoteTagsHeader = z
  .string()
  .describe(`Tags for the note, comma-separated (\`ci,deploy\`): ${TAG_RULE}. For a raw markdown body; a JSON or form body's own \`tags\` wins. Empty is none.`);
export const NoteTitleHeader = NoteTitle.describe("The note's title, for a raw body; a JSON or form body's own `title` wins. At most 100 characters, one line.");
export const NoteAltHeader = NoteAlt.describe("For an image body: its alternative text; a form's own `alt` wins.");
export const ReadIdHeader = z.string().describe("The read id the feed gets when this post creates it: 3 to 64 characters (a-z, 0-9, - and _), random when left out or empty, ignored for a feed that exists. A short readable one is guessable: protect the feed with a password if that matters. 409 when it is taken");
export const NoteNameHeader = z.string().describe("For an image body: the picture's original file name, kept with the note (at most 200 characters)");
export const CurrentPasswordHeader = z.string().describe("The feed's current password");

const TITLE = z.string().describe("Display title, at most 100 characters, one line; empty means none (the feed's name is shown)");
const DESCRIPTION = z.string().describe("Description, at most 500 characters, one line; may be empty");
const IMAGE_URL = z.url().nullable().describe("The feed's title image (absolute URL, served under the read id), or null");
export const FeedSettingsJson = z
  .object({
    title: TITLE,
    description: DESCRIPTION,
    image: z
      .string()
      .optional()
      .describe("The file name of an image uploaded to this feed (see uploadImage), shown as the feed's title image; empty removes it, omitted leaves it as it is"),
    show_sender: z.boolean().optional().describe("Whether readers (RSS, the read API and pages) see who posted each note; omitted leaves it as it is, a new feed starts with true"),
    read_id: z
      .string()
      .optional()
      .describe("A new read id (3 to 64 characters: a-z, 0-9, - and _), empty for a random one; omitted leaves it as it is. The old read link stops showing this feed, and may later show another one. Notes are not edited: a relative image link (`![](file)`) follows the new id, a full URL keeps the old one and is yours to change. Reserved feeds keep theirs. 409 when it is taken"),
  })
  .meta({ id: "FeedSettings" });
export const FeedJson = z
  .object({
    name: z.string().describe("The feed's name"),
    title: TITLE,
    description: DESCRIPTION,
    protected: z.boolean().describe("Whether the feed has its own password"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link; null while the feed has no notes, or if the server can't read the feed's stored read id"),
    image_url: IMAGE_URL,
    show_sender: z.boolean().describe("Whether readers see who posted each note"),
  })
  .meta({ id: "Feed" });
export const ReadFeedJson = z.object({ title: TITLE, description: DESCRIPTION, image_url: IMAGE_URL }).meta({ id: "ReadFeed" });

// A raw request body, not JSON.
export const FileBody = z.string().meta({ format: "binary" }).describe("The note, a file: its bytes, of the type `Content-Type` declares");

export const COMPONENTS = [NoteJson, NoteList, Created, ErrorJson, MetaJson, PasswordJson, FeedSettingsJson, FeedJson, ReadFeedJson];

export const FeedParam = z.string().regex(FEED_RE).describe("The feed's name. It is the write key: anyone who knows it can post.");
export const ReadIdParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).describe("The feed's read id, from its read link: 22 random characters, one the feed's owner chose, or the feed's own name for a reserved feed. Read-only; never reveals the name of any other feed.");
export const NoteIdParam = z.string().regex(NOTE_ID).describe("The note's id");

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50).describe(`Notes per page, 1–${MAX_LIMIT}`),
  before: z.string().regex(NOTE_ID).optional().describe("Only notes older than this id: the previous page's `next`"),
  tag: z.string().toLowerCase().pipe(z.string().regex(TAG_RE)).optional().describe("Only notes carrying this tag"),
});
