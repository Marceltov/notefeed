// The imprint and the privacy page of an instance: Markdown files of the operator's own, named by NOTEFEED_IMPRINT_FILE
// and NOTEFEED_PRIVACY_FILE. notefeed ships neither text. Without a file, or with one that cannot be read, the page does
// not exist and the footer has no link to it. NOTEFEED_NOTICE_FILE is a third file of the same kind: a notice of the
// operator's on the start page, which without a file is as notefeed ships it.
import { readFile, stat } from "node:fs/promises";
import { config } from "./config";

export type LegalPage = "imprint" | "privacy";

// A page of text, not a place to keep files: anything larger is a mistake in the setting.
export const MAX_LEGAL_BYTES = 256 * 1024;

type OperatorFile = LegalPage | "notice";

const SETTINGS: Record<OperatorFile, { name: string; path: () => string }> = {
  imprint: { name: "NOTEFEED_IMPRINT_FILE", path: config.imprintFile },
  privacy: { name: "NOTEFEED_PRIVACY_FILE", path: config.privacyFile },
  notice: { name: "NOTEFEED_NOTICE_FILE", path: config.noticeFile },
};

const fileOf = (file: OperatorFile): string => SETTINGS[file].path();

/** The size of the file; null when the setting is empty or does not name a regular file of a sensible size. */
async function sizeOf(file: OperatorFile): Promise<number | null> {
  const path = fileOf(file);
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
export const readLegalPage = (page: LegalPage): Promise<string | null> => read(page);

/** The notice for the start page, read on every request like a page; null without a file or when it holds no text. */
export async function readNotice(): Promise<string | null> {
  const markdown = await read("notice");
  return markdown === null || markdown.trim() === "" ? null : markdown;
}

async function read(file: OperatorFile): Promise<string | null> {
  if ((await sizeOf(file)) === null) return null;
  try {
    return await readFile(/*turbopackIgnore: true*/ fileOf(file), "utf8");
  } catch {
    return null; // removed since the look, or not readable
  }
}

/** For the startup log: the settings that are set but name nothing readable (the variable's name, never the path). */
export async function unreadableLegalSettings(): Promise<string[]> {
  const out: string[] = [];
  for (const file of Object.keys(SETTINGS) as OperatorFile[])
    if (fileOf(file) !== "" && (await sizeOf(file)) === null) out.push(SETTINGS[file].name);
  return out;
}
