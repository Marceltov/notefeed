/** `notefeed post ...` — post a note from the command line. */
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

const USAGE = 'usage: notefeed post <text | - | --file PATH> [--url URL] [--token TOKEN]';

/** Returns the exit code: 0 ok, 1 server/network error, 2 usage/config error. */
export async function main(argv: string[], io: Io = process): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: asPositionals(argv),
      allowPositionals: true,
      options: {
        url: { type: "string" },
        token: { type: "string" },
        file: { type: "string" },
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
    if (command !== "post" || rest.length) throw new UsageError(USAGE);
    const markdown = await read(text, values.file, io);
    const note = await new Client({ url: values.url, token: values.token }).post(markdown);
    io.stdout.write(`${note.url}\n`);
    return 0;
  } catch (e) {
    io.stderr.write(`notefeed: ${(e as Error).message.split("\n")[0]}\n`);
    if (e instanceof ConfigError || e instanceof UsageError) return 2;
    if (e instanceof NotefeedError) return 1;
    return 2; // parseArgs rejects unknown options with a TypeError
  }
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
