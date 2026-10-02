"use client";

import { useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent } from "react";
import { ImagePlus } from "lucide-react";
import { uploadImageFile } from "@/app/_lib/useApiForm";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

// The note textarea of the compose box and the editor, with image upload: the "Add image" button, paste and
// drag-and-drop each upload the files one after another and insert `![](url)` at the cursor. `images` is false
// for a feed without a first note (nothing can be uploaded to it yet). The button only exists once hydrated,
// so without JavaScript only the textarea renders.
export function MarkdownInput({ id, name, label, value, onChange, feed, rows, placeholder, describedBy, className = "", images = true, onBusy }: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  feed: string;
  rows: number;
  placeholder?: string;
  describedBy?: string;
  className?: string;
  images?: boolean;
  onBusy?: (busy: boolean) => void; // an upload is running: the parent holds back posting, so the image is not left out
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);

  function insert(markdown: string) {
    const ta = area.current;
    if (!ta) return;
    const { value: v, selectionStart: s, selectionEnd: e } = ta; // the DOM's value: `value` may be stale after an await
    const before = v.slice(0, s);
    const after = v.slice(e);
    const head = before && !before.endsWith("\n") ? "\n" : "";
    const tail = after && !after.startsWith("\n") ? "\n" : "";
    const cursor = before.length + head.length + markdown.length;
    onChange(before + head + markdown + tail + after);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  async function upload(files: File[]) {
    setError(undefined);
    setUploading(true);
    onBusy?.(true);
    for (const file of files) {
      const result = await uploadImageFile(feed, file);
      if ("error" in result) {
        setError(result.error);
        break;
      }
      insert(`![](${result.url})`);
    }
    setUploading(false);
    onBusy?.(false);
  }

  const imageFiles = (list: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
  const paste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData.files);
    if (!images || !files.length || e.clipboardData.types.includes("text/plain")) return; // copied cells and text carry a picture too: paste the text
    e.preventDefault();
    upload(files);
  };
  const drop = (e: DragEvent) => {
    const files = imageFiles(e.dataTransfer.files);
    if (!images || !files.length) return;
    e.preventDefault();
    upload(files);
  };

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={area}
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !uploading) e.currentTarget.form?.requestSubmit();
        }}
        onPaste={paste}
        onDragOver={(e) => images && e.dataTransfer.types.includes("Files") && e.preventDefault()} // a text control accepts file drops in Chromium only otherwise
        onDrop={drop}
        rows={rows}
        placeholder={placeholder}
        aria-describedby={describedBy}
        className={`block w-full resize-y rounded-sm border border-rule bg-transparent p-3 text-ink focus:border-carbon focus:outline-none ${className}`}
      />
      {hydrated && images && (
        <div className="mt-2 text-sm">
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            aria-label="Image file"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // the same file can be chosen again
              if (files.length) upload(files);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => picker.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-sm border border-rule px-2.5 py-1 font-bold text-carbon hover:border-carbon disabled:opacity-60"
          >
            <ImagePlus aria-hidden className="h-4 w-4" />
            {uploading ? "Uploading…" : "Add image"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}
