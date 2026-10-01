// The API's wire shapes. Named ones (.meta({ id })) become components of the generated OpenAPI
// document; handlers build their bodies as z.infer of these, and the dispatcher checks them.
import * as z from "zod";
import { ERROR_CODES } from "../../shared/errors";
import { PASSWORD_RULE } from "../../shared/password";
import { FEED_RE, READ_ID_RE } from "../feeds";

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
export const FeedSettingsJson = z.object({ title: TITLE, description: DESCRIPTION }).meta({ id: "FeedSettings" });
export const FeedJson = z
  .object({
    name: z.string().describe("The feed's name"),
    title: TITLE,
    description: DESCRIPTION,
    protected: z.boolean().describe("Whether the feed has its own password"),
    read_url: z.url().nullable().describe("The feed's read-only RSS link; null while the feed has no notes"),
  })
  .meta({ id: "Feed" });
export const ReadFeedJson = z.object({ title: TITLE, description: DESCRIPTION }).meta({ id: "ReadFeed" });

export const COMPONENTS = [NoteJson, NoteList, Created, ErrorJson, PostJson, PostForm, PasswordJson, FeedSettingsJson, FeedJson, ReadFeedJson];

export const FeedParam = z.string().regex(FEED_RE).describe("The feed's name. It is the write key: anyone who knows it can post.");
export const ReadIdParam = z.string().regex(READ_ID_RE).describe("The feed's read id, from its read link. Read-only; never reveals the name.");
export const NoteIdParam = z.string().regex(NOTE_ID).describe("The note's id");

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50).describe(`Notes per page, 1–${MAX_LIMIT}`),
  before: z.string().regex(NOTE_ID).optional().describe("Only notes older than this id: the previous page's `next`"),
});
