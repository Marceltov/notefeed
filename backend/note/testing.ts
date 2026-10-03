// For tests only: a markdown note without touching the disk.
import { ImageNote } from "./image";
import { MarkdownNote } from "./markdown";

export const mdNote = ({ id, markdown, createdAt = new Date(0), sender, tags, title }: { id: string; markdown: string; createdAt?: Date; sender?: string; tags?: string[]; title?: string }): MarkdownNote =>
  new MarkdownNote(
    { id, ext: "md", meta: { ...(sender !== undefined && { sender }), ...(tags?.length && { tags }), ...(title !== undefined && { title }) }, createdAt, size: Buffer.byteLength(markdown) },
    markdown,
  );

export const imgNote = ({ id, ext = "png", size = 12, createdAt = new Date(0), title, sender, tags }: { id: string; ext?: string; size?: number; createdAt?: Date; title?: string; sender?: string; tags?: string[] }): ImageNote =>
  new ImageNote({ id, ext, meta: { ...(sender !== undefined && { sender }), ...(tags?.length && { tags }), ...(title !== undefined && { title }) }, createdAt, size });
