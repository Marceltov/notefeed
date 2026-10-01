#!/usr/bin/env node
import { main } from "./cli.js";

// The reader went away (`notefeed notes | head -1`): stop quietly instead of crashing on EPIPE.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

process.exitCode = await main(process.argv.slice(2));
