// Tags: free labels set by whoever posts a note, not verified. Validated once here, for every way of posting.
import { InvalidBodyError } from "./errors";

export const MAX_TAGS = 10;
export const TAG_RE = /^[a-z0-9_.:-]{1,32}$/;
export const TAG_RULE = `at most ${MAX_TAGS} tags, each 1 to 32 characters of letters, digits, \`-\`, \`_\`, \`.\` and \`:\`; case is folded to lowercase, duplicates are removed`;

// Lowercased, deduplicated, in the order given; a refusal is a 400 naming the problem.
export function checkTags(tags: readonly string[] = []): string[] {
  const out = [...new Set(tags.map((t) => t.toLowerCase()))];
  const bad = out.find((t) => !TAG_RE.test(t));
  if (bad !== undefined) throw new InvalidBodyError(`invalid tag ${JSON.stringify(bad)}: ${TAG_RULE}`);
  if (out.length > MAX_TAGS) throw new InvalidBodyError(`too many tags: ${TAG_RULE}`);
  return out;
}

// The `X-Note-Tags` header: comma-separated; empty (or only commas) is none.
export const tagsFromHeader = (value: string | null): string[] | undefined =>
  value === null ? undefined : value.split(",").map((t) => t.trim()).filter(Boolean);
