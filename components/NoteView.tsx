import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML in notes stays escaped: no rehype-raw.
export function NoteView({ markdown }: { markdown: string }) {
  return (
    <div className="md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
