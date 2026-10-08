// The imprint and the privacy page of an instance: Markdown files of the operator's own, named by NOTEFEED_IMPRINT_FILE
// and NOTEFEED_PRIVACY_FILE. notefeed ships neither text. Without a file, or with one that cannot be read, the page does
// not exist and the footer has no link to it.
import { readFile, stat } from "node:fs/promises";
import { config } from "./config";

export type LegalPage = "imprint" | "privacy";

// A page of text, not a place to keep files: anything larger is a mistake in the setting.
export const MAX_LEGAL_BYTES = 256 * 1024;

const fileOf = (page: LegalPage): string => (page === "imprint" ? config.imprintFile() : config.privacyFile());

/** The size of the page's file; null when the setting is empty or does not name a regular file of a sensible size. */
async function sizeOf(page: LegalPage): Promise<number | null> {
  const path = fileOf(page);
  if (path === "") return null;
  try {
    const info = await stat(/*turbopackIgnore: true*/ path);
    return info.isFile() && info.size <= MAX_LEGAL_BYTES ? info.size : null;
  } catch {
    return null;
  }
}

/** Whether the page exists on this instance, for the footer's link. */
export const hasLegalPage = async (page: LegalPage): Promise<boolean> => (await sizeOf(page)) !== null;

/** The page's Markdown, read on every request so an edited file shows at once; null when the page does not exist. */
export async function readLegalPage(page: LegalPage): Promise<string | null> {
  if ((await sizeOf(page)) === null) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ fileOf(page), "utf8");
  } catch {
    return null; // removed since the look, or not readable
  }
}

/** For the startup log: the settings that are set but name nothing readable (the variable's name, never the path). */
export async function unreadableLegalSettings(): Promise<string[]> {
  const settings: [LegalPage, string][] = [
    ["imprint", "NOTEFEED_IMPRINT_FILE"],
    ["privacy", "NOTEFEED_PRIVACY_FILE"],
  ];
  const out: string[] = [];
  for (const [page, name] of settings) if (fileOf(page) !== "" && !(await hasLegalPage(page))) out.push(name);
  return out;
}
