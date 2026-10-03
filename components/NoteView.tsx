import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRelativeLink } from "@/shared/links";

// Raw HTML in notes stays escaped: no rehype-raw.
export function NoteView({ markdown, imageBase }: { markdown: string; imageBase?: string }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title }) => {
            const url = typeof src === "string" && imageBase && isRelativeLink(src) ? imageBase + src : src;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} loading="lazy" />;
          },
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}
