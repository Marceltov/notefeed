import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// An image link with no scheme and no leading slash names a file of the feed: it is shown from `imageBase`
// (`/r/<current read id>/`), so it keeps working when the read id changes. Absolute links are left as written.
const isRelative = (src: string) => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

// Raw HTML in notes stays escaped: no rehype-raw.
export function NoteView({ markdown, imageBase }: { markdown: string; imageBase?: string }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          img: ({ src, alt, title }) => {
            const url = typeof src === "string" && src && imageBase && isRelative(src) ? imageBase + src : src;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={typeof url === "string" ? url : undefined} alt={alt ?? ""} title={title} loading="lazy" />;
          },
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}
