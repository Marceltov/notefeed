/** `notefeed post`, `edit`, `update`, `delete` and `notes`: post, change, remove and read notes, markdown or any accepted file, from the command line. */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { Client, ConfigError, NotefeedError } from "./client.js";

type Io = {
  stdin: AsyncIterable<Buffer | string>;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
};

class UsageError extends Error {}

const USAGE = [
  "usage: notefeed post <text | - | --file PATH> [--type MEDIA_TYPE] [--title TITLE] [--tag TAG]... [--attach PATH]... [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed edit <id> <text | - | --file PATH> [--type MEDIA_TYPE] [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed update <id> [--title TITLE] [--alt ALT] [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed delete <id> [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed notes [--limit N] [--tag TAG] [--json] [--url URL] [--feed FEED] [--password PASSWORD]",
].join("\n");

// The media type of a file by its extension: the types the server accepts.
const TYPES: Record<string, string> = { ".md": "text/markdown", ".markdown": "text/markdown", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** Returns the exit code: 0 ok, 1 server/network error, 2 usage/config error. */
export async function main(argv: string[], io: Io = process): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: asPositionals(argv),
      allowPositionals: true,
      options: {
        url: { type: "string" },
        feed: { type: "string" },
        password: { type: "string" },
        file: { type: "string" },
        type: { type: "string" },
        title: { type: "string" },
        alt: { type: "string" },
        tag: { type: "string", multiple: true },
        attach: { type: "string", multiple: true },
        limit: { type: "string" },
        json: { type: "boolean" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      io.stdout.write(`${USAGE}\n`);
      return 0;
    }
    if (values.version) {
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      io.stdout.write(`notefeed ${pkg.version}\n`);
      return 0;
    }
    const [command, text, ...rest] = positionals;
    if (command === "post" && !rest.length) {
      const input = await read(text, values.file, values.type, io);
      const attachments = await Promise.all((values.attach ?? []).map(attachment));
      const note = await client(values).post(input.content, { type: input.type, title: values.title, tags: values.tag, name: input.name, attachments });
      io.stdout.write(`${[note.url, ...note.attachments.map((a) => a.url)].join("\n")}\n`);
      return 0;
    }
    if (command === "edit" && text !== undefined && rest.length <= 1) {
      const input = await read(rest[0], values.file, values.type, io);
      const note = await client(values).edit(text, input.content, { type: input.type });
      io.stdout.write(`${note.url}\n`);
      return 0;
    }
    if (command === "update" && text !== undefined && !rest.length) {
      if (values.title === undefined && values.alt === undefined) throw new UsageError("give --title and/or --alt");
      const note = await client(values).update(text, { title: values.title, alt: values.alt });
      io.stdout.write(`${note.url}\n`);
      return 0;
    }
    if (command === "delete" && text !== undefined && !rest.length) {
      await client(values).delete(text);
      return 0;
    }
    if (command === "notes" && text === undefined) {
      const limit = Number(values.limit ?? 20);
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a whole number, 1 or more");
      let left = limit;
      for await (const n of client(values).notes({ pageSize: Math.min(limit, 100), tag: values.tag?.[0] })) {
        // To the second, UTC: the same form as the Python CLI, so scripts read either the same way.
        const when = new Date(n.created_at).toISOString().replace(/\.\d+Z$/, "Z");
        // --json: exactly the documented fields, like the Python CLI, even if the server adds more.
        const fields = { id: n.id, type: n.type, title: n.title, ...(n.content !== undefined && { content: n.content }), file: n.file, file_url: n.file_url, size: n.size, tags: n.tags, created_at: when, url: n.url };
        io.stdout.write(values.json ? `${JSON.stringify(fields)}\n` : `${when}  ${n.title || n.id}  ${n.url}\n`);
        if (--left === 0) break;
      }
      return 0;
    }
    throw new UsageError(USAGE);
  } catch (e) {
    io.stderr.write(`notefeed: ${(e as Error).message.split("\n")[0]}\n`);
    if (e instanceof ConfigError || e instanceof UsageError) return 2;
    if (e instanceof NotefeedError) return 1;
    return 2; // parseArgs rejects unknown options with a TypeError
  }
}

// Flags win over NOTEFEED_URL, NOTEFEED_FEED and NOTEFEED_PASSWORD. NOTEFEED_FEED_PASSWORD has no flag: it would end up in shell history.
function client(values: { url?: string; feed?: string; password?: string }): Client {
  const url = values.url || process.env.NOTEFEED_URL;
  const feed = values.feed || process.env.NOTEFEED_FEED;
  if (!url) throw new UsageError("no URL given; pass --url or set NOTEFEED_URL");
  if (!feed) throw new UsageError("no feed given; pass --feed or set NOTEFEED_FEED");
  return new Client({
    url,
    feed,
    password: values.password || process.env.NOTEFEED_PASSWORD,
    feedPassword: process.env.NOTEFEED_FEED_PASSWORD,
  });
}

// What a post or an edit sends: text on the command line or stdin is markdown; a file is sent as it is, as `--type` or its extension says.
async function read(text: string | undefined, file: string | undefined, type: string | undefined, io: Io): Promise<{ content: string | Uint8Array; type?: string; name?: string }> {
  if (file) {
    const media = type ?? TYPES[extname(file).toLowerCase()];
    if (!media) throw new UsageError(`cannot tell the type of ${file}: pass --type (${Object.values(TYPES).filter((t, i, a) => a.indexOf(t) === i).join(", ")})`);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (e) {
      throw new UsageError(`cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
    return { content: media === "text/markdown" ? utf8(bytes, file) : bytes, type: media, name: basename(file) };
  }
  if (text === "-") {
    const chunks: Buffer[] = [];
    for await (const c of io.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    return { content: utf8(Buffer.concat(chunks), "stdin"), type: type ?? "text/markdown" };
  }
  if (text === undefined) throw new UsageError('give the note text, "-" for stdin, or --file PATH');
  return { content: text, type: type ?? "text/markdown" };
}

// A picture to post first: its name is the file's, its type comes from the extension.
async function attachment(path: string): Promise<{ name: string; content: Uint8Array; type: string }> {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type || type === "text/markdown") throw new UsageError(`cannot attach ${path}: a picture (${Object.keys(TYPES).filter((e) => TYPES[e] !== "text/markdown").join(", ")}) is expected`);
  const name = basename(path);
  if (!/^(?!\.+$)[A-Za-z0-9._-]+$/.test(name)) throw new UsageError(`cannot attach ${path}: its file name "${name}" is what the text refers to it by, so it may only have letters, digits, ., _ and -: rename the file`);
  try {
    return { name, content: await readFile(path), type };
  } catch (e) {
    throw new UsageError(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
}

function utf8(bytes: Uint8Array, source: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new UsageError(`${source} is not UTF-8`);
  }
}

// Note text like "- buy milk" starts with "-" but is not an option; argparse (Python CLI) treats an
// argument with whitespace as positional, so do the same by moving such arguments after "--".
function asPositionals(argv: string[]): string[] {
  if (argv.includes("--")) return argv;
  const text = argv.filter((a) => /^-.*\s/.test(a));
  return [...argv.filter((a) => !/^-.*\s/.test(a)), "--", ...text];
}
