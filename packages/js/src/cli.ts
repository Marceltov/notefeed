/** `notefeed post`, `edit`, `delete`, `notes` and `image`: post, change, remove and read notes, and upload images, from the command line. */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Client, ConfigError, NotefeedError } from "./client.js";

type Io = {
  stdin: AsyncIterable<Buffer | string>;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
};

class UsageError extends Error {}

const USAGE = [
  "usage: notefeed post <text | - | --file PATH> [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed edit <id> <text | - | --file PATH> [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed delete <id> [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed image <PATH> [--url URL] [--feed FEED] [--password PASSWORD]",
  "       notefeed notes [--limit N] [--json] [--url URL] [--feed FEED] [--password PASSWORD]",
].join("\n");

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
      const markdown = await read(text, values.file, io);
      const note = await client(values).post(markdown);
      io.stdout.write(`${note.url}\n`);
      return 0;
    }
    if (command === "edit" && text !== undefined && rest.length <= 1) {
      const note = await client(values).edit(text, await read(rest[0], values.file, io));
      io.stdout.write(`${note.url}\n`);
      return 0;
    }
    if (command === "delete" && text !== undefined && !rest.length) {
      await client(values).delete(text);
      return 0;
    }
    if (command === "image" && text !== undefined && !rest.length) {
      let bytes: Buffer;
      try {
        bytes = await readFile(text);
      } catch (e) {
        throw new UsageError(`cannot read ${text}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      }
      io.stdout.write(`${(await client(values).uploadImage(bytes)).markdown}\n`);
      return 0;
    }
    if (command === "notes" && text === undefined) {
      const limit = Number(values.limit ?? 20);
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError("--limit must be a whole number, 1 or more");
      let left = limit;
      for await (const n of client(values).notes({ pageSize: Math.min(limit, 100) })) {
        // To the second, UTC: the same form as the Python CLI, so scripts read either the same way.
        const when = new Date(n.created_at).toISOString().replace(/\.\d+Z$/, "Z");
        // --json: exactly the documented fields, like the Python CLI, even if the server adds more.
        const fields = { id: n.id, title: n.title, markdown: n.markdown, created_at: when, url: n.url };
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

async function read(text: string | undefined, file: string | undefined, io: Io): Promise<string> {
  if (file) {
    try {
      return utf8(await readFile(file), file);
    } catch (e) {
      if (e instanceof UsageError) throw e;
      throw new UsageError(`cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
  }
  if (text === "-") {
    const chunks: Buffer[] = [];
    for await (const c of io.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    return utf8(Buffer.concat(chunks), "stdin");
  }
  if (text === undefined) throw new UsageError('give the note text, "-" for stdin, or --file PATH');
  return text;
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
