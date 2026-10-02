// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them.
import * as z from "zod";
import { ERROR_CODES } from "../../shared/errors";
import { PASSWORD_RULE } from "../../shared/password";
import { FEED_RE, READ_ID_RE } from "../feeds";
import { IMAGE_FILE_RE } from "../images";

export const NOTE_ID = /^\d{8}T\d{6}Z-[a-z0-9-]+$/;
export const MAX_LIMIT = 100;

export const NoteJson = z
  .object({
    id: z.string().regex(NOTE_ID).describe("UTC time to the second plus a slug of the title"),
    title: z.string().describe("The first heading, or the first non-empty line; may be empty"),
    markdown: z.string().describe("The note, byte-for-byte as posted"),
    created_at: z.iso.datetime().describe("When the note was posted (UTC)"),
    url: z.url().describe("The note's page in the web UI"),
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
    read_url: z.url().describe("The feed's read-only RSS link, safe to share"),
  })
  .meta({ id: "Created" });
export type Created = z.infer<typeof Created>;

export const ErrorJson = z
  .object({
    error: z.string().describe("A short reason, for people"),
    code: z.enum(ERROR_CODES).optional().describe("Stable machine-readable code; absent only on a 500"),
  })
  .meta({ id: "Error" });

const NewPassword = z
  .string()
  .describe(`Protects the feed: ${PASSWORD_RULE}. Only honored on the post that creates the feed; an existing open feed answers 409. Empty is the same as leaving it out.`);
export const PostJson = z.object({ markdown: z.string(), password: NewPassword.optional() }).meta({ id: "PostJson" });
export const PostForm = z.object({ markdown: z.string(), password: NewPassword.optional() }).meta({ id: "PostForm" });
export const PasswordJson = z.object({ password: z.string().describe(`The new password: ${PASSWORD_RULE}`) }).meta({ id: "PasswordJson" });

export const FeedPasswordHeader = z
  .string()
  .describe(
    "The feed's own password, when it has one: to post, list or get, and (as the current password) to change or remove it. " +
      "On the `POST` that creates a feed it sets the feed's password; on a `POST` to an existing feed that has none it answers 409. " +
      "An empty value is the same as no header, so a `POST` with an empty one creates an open feed.",
  );
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
  })
  .meta({ id: "FeedSettings" });
export const FeedJson = z
  .object({
    name: z.string().describe("The feed's name"),
    title: TITLE,
    description: DESCRIPTION,
    protected: z.boolean().describe("Whether the feed has its own password"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link; null while the feed has no notes"),
    image_url: IMAGE_URL,
  })
  .meta({ id: "Feed" });
export const ReadFeedJson = z.object({ title: TITLE, description: DESCRIPTION, image_url: IMAGE_URL }).meta({ id: "ReadFeed" });

export const ImageUploaded = z
  .object({
    file: z.string().regex(IMAGE_FILE_RE).describe("The stored file's name: 32 hex characters of the SHA-256 plus the extension. Pass it as a feed's `image` setting"),
    url: z.url().describe("Where the image is served, absolute, under the feed's read id; public like the read link"),
    markdown: z.string().describe("`![](url)`, to paste into a note"),
  })
  .meta({ id: "ImageUploaded" });
// A raw request body, not JSON.
export const ImageBody = z.string().meta({ format: "binary" }).describe("The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes, not by the Content-Type");

export const COMPONENTS = [NoteJson, NoteList, Created, ImageUploaded, ErrorJson, PostJson, PostForm, PasswordJson, FeedSettingsJson, FeedJson, ReadFeedJson];

export const FeedParam = z.string().regex(FEED_RE).describe("The feed's name. It is the write key: anyone who knows it can post.");
export const ReadIdParam = z.string().regex(READ_ID_RE).describe("The feed's read id, from its read link. Read-only; never reveals the name.");
export const NoteIdParam = z.string().regex(NOTE_ID).describe("The note's id");

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50).describe(`Notes per page, 1–${MAX_LIMIT}`),
  before: z.string().regex(NOTE_ID).optional().describe("Only notes older than this id: the previous page's `next`"),
});
