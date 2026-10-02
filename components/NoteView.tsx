import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in notes stays escaped: no rehype-raw.
export function NoteView({ markdown }: { markdown: string }) {
  return (
    <div className="md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // User-uploaded images from our own route: next/image's optimizer has nothing to add (max-width is in globals.css).
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ src, alt, title }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} title={title} loading="lazy" />,
        }}
      >{markdown}</ReactMarkdown>
    </div>
  );
}
