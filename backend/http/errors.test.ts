import { expect, test, vi } from "vitest";
import { NotFoundError } from "../errors";
import { logTo } from "../log";
import { errorReply } from "./errors";

test("an unexpected error is a bare 500, logged at error without the feed's name", () => {
  vi.stubEnv("DATA_DIR", "/data");
  const lines: string[] = [];
  const restore = logTo((l) => void lines.push(l));
  const e = Object.assign(new Error("ENOENT: no such file or directory, open '/data/secret-feed/01J0.md'"), { code: "ENOENT", errno: -2, syscall: "open", path: "/data/secret-feed/01J0.md" });
  expect(errorReply(e)).toEqual({ status: 500, body: { error: "internal error" } });
  expect(errorReply(new NotFoundError("no such note")).status).toBe(404);
  restore();
  vi.unstubAllEnvs();
  expect(lines).toHaveLength(1);
  const o = JSON.parse(lines[0]);
  expect(o).toMatchObject({ level: "error", component: "http", msg: "request failed", err: { type: "Error", code: "ENOENT", errno: -2, syscall: "open", message: "ENOENT: no such file or directory, open '/data/<feed>/01J0.md'" } });
  expect(lines[0]).not.toContain("secret-feed");
});
