import { tmpdir } from "node:os";
import { join } from "node:path";

// Where the open e2e server (port 3100) writes its log: playwright.config.ts sends it there, e2e/requestlog.spec.ts reads it.
// In the system's temp folder, one fixed file that every run overwrites.
export const SERVER_LOG = join(tmpdir(), "notefeed-e2e-server-3100.log");
