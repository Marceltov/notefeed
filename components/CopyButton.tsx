"use client";

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
      className="shrink-0 text-muted hover:text-ink hover:underline"
    >
      <span aria-live="polite">{label}</span>
    </button>
  );
}
