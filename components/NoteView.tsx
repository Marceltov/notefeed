import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRelativeLink } from "@/shared/links";

// Raw HTML in notes stays escaped: no rehype-raw. `resolve` gives a picture's URL for a link the text holds (the compose box's preview
// shows the pictures waiting in it from their files, by the name the text calls them, issue #146); undefined falls through to `imageBase`.
export function NoteView({ markdown, imageBase, resolve }: { markdown: string; imageBase?: string; resolve?: (src: string) => string | undefined }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title }) => {
            const own = typeof src === "string" ? resolve?.(src) : undefined;
            const url = own ?? (typeof src === "string" && imageBase && isRelativeLink(src) ? imageBase + src : src);
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} loading="lazy" />;
          },
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}
