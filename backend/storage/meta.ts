// A note's metadata as stored by every backend: JSON text. Hand-edited or damaged text reads as less, never as an error.
import type { Meta } from "./types";

const STRINGS = ["title", "sender", "alt", "name", "created"] as const;

// Only the known fields with the right type count; anything unreadable is no metadata.
export function parseMeta(raw: string): Meta {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const meta: Meta = {};
  for (const k of STRINGS) if (typeof o[k] === "string") meta[k] = o[k];
  if (Array.isArray(o.tags)) {
    const tags = o.tags.filter((t): t is string => typeof t === "string");
    if (tags.length) meta.tags = tags;
  }
  return meta;
}

export const hasMeta = (meta: Meta): boolean => Object.values(meta).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));

// A string or list sets a field, null (or an empty value) removes it.
export function applyPatch(current: Meta, patch: { [K in keyof Meta]?: Meta[K] | null }): Meta {
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete merged[k];
    else merged[k] = v;
  }
  return merged as Meta;
}
