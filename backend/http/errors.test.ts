import { expect, test, vi } from "vitest";
import { NotFoundError } from "../errors";
import { logTo } from "../log";
import { errorReply } from "./errors";

test("an unexpected error is a bare 500, logged at error without the feed's name", () => {
  vi.stubEnv("DATA_DIR", "/data");
  const lines: string[] = [];
  const restore = logTo((l) => void lines.push(l));
  const note = "/data/secret-feed/20261002T091400Z-quarterly-layoffs-plan.md";
  const e = Object.assign(new Error(`EACCES: permission denied, rename '/data/secret-feed/.20261002T091400Z-quarterly-layoffs-plan.md.3f9a1c2b4d5e.tmp' -> '${note}'`), { code: "EACCES", errno: -13, syscall: "rename", path: note });
  expect(errorReply(e)).toEqual({ status: 500, body: { error: "internal error" } });
  expect(errorReply(new NotFoundError("no such note")).status).toBe(404);
  restore();
  vi.unstubAllEnvs();
  expect(lines).toHaveLength(1);
  const o = JSON.parse(lines[0]);
  expect(o).toMatchObject({ level: "error", component: "http", msg: "request failed", err: { type: "Error", code: "EACCES", errno: -13, syscall: "rename", message: "EACCES: permission denied, rename '/data/<path>' -> '/data/<path>'" } });
  expect(lines[0]).not.toMatch(/secret-feed|quarterly-layoffs-plan/);
});
