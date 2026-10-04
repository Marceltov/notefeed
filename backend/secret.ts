// The server secret: signs unlock cookies and OAuth tokens, and (on the file system only) is behind the read ids of feeds from
// before random ones. NOTEFEED_SECRET, or on `fs` a generated one kept in DATA_DIR. The database backends have no data folder,
// so they need NOTEFEED_SECRET (config.validateStorage() checks that at start-up).
import { createHmac } from "node:crypto";
import { config } from "./config";
import { processState } from "./state";
import { loadOrCreateSecret, secretPath } from "./storage/fs/secret";

const state = processState("secret", () => ({}) as { secret?: Buffer });

// A short key makes read ids computable offline. Fail loudly instead of regenerating the key,
// which would change every read link.
function strong(key: Buffer, where: string): Buffer {
  if (key.length < 32) throw new Error(`${where} must be at least 32 bytes (e.g. openssl rand -hex 32), got ${key.length}`);
  return key;
}

export function secret(): Buffer {
  if (state.secret) return state.secret;
  const env = config.secret();
  if (env) return (state.secret = strong(Buffer.from(env), "NOTEFEED_SECRET"));
  if (config.storage() !== "fs") throw new Error(`NOTEFEED_STORAGE=${config.storage()} needs NOTEFEED_SECRET`);
  return (state.secret = strong(loadOrCreateSecret(), secretPath()));
}

// Only the file system backend and legacy feeds use this; everything else asks the storage for the read id.
export function derivedReadId(feed: string): string {
  return createHmac("sha256", secret()).update(feed).digest("base64url").slice(0, 22);
}

export const resetSecretForTests = (): void => {
  state.secret = undefined;
};
