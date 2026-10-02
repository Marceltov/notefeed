"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  return (
    <button
      type="button"
      onClick={() =>
        // navigator.clipboard only exists in secure contexts (https or localhost).
        (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
          () => setLabel("Copied"),
          () => setLabel("Copy failed"),
        )
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-rule px-2.5 py-1 text-sm text-muted hover:border-carbon hover:text-ink"
    >
      {label === "Copied" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
      <span aria-live="polite">{label}</span>
    </button>
  );
}
