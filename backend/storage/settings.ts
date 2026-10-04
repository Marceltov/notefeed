// A feed's settings as stored by every backend: JSON text, `{ "title", "description", "image" }` plus `"showSender": false` only when
// false (absent reads as true, so a file from before sign-in stays as it was). Absent or unreadable means empty.
import type { Settings } from "./types";

const EMPTY: Settings = { title: "", description: "", image: "", showSender: true };

export function parseSettings(text: string | null): Settings {
  try {
    const j = JSON.parse(text ?? "");
    return { title: typeof j.title === "string" ? j.title : "", description: typeof j.description === "string" ? j.description : "", image: typeof j.image === "string" ? j.image : "", showSender: j.showSender !== false };
  } catch {
    return { ...EMPTY };
  }
}

export function serializeSettings(s: Settings): string {
  const { showSender, ...rest } = s;
  return JSON.stringify(showSender ? rest : s);
}
