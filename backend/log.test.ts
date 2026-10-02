import { afterEach, expect, test } from "vitest";
import { createLogger, errorFields, logger, logTo, scrubPaths } from "./log";

const capture = (level = "debug") => {
  const lines: string[] = [];
  const l = createLogger({ write: (s: string) => void lines.push(s) }, level);
  return { l, lines, parsed: () => lines.map((s) => JSON.parse(s)) };
};

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

test("one JSON object per line: level label, ISO time, component, msg, fields", () => {
  const { l, lines, parsed } = capture();
  l.child({ component: "oidc" }).warn({ provider: "default", status: 400 }, "token request rejected");
  expect(lines).toHaveLength(1);
  expect(lines[0].endsWith("\n")).toBe(true);
  const [o] = parsed();
  expect(o).toEqual({ level: "warn", time: expect.any(String), component: "oidc", msg: "token request rejected", provider: "default", status: 400 });
  expect(new Date(o.time).toISOString()).toBe(o.time);
});

test("the level filters", () => {
  const { l, parsed } = capture("warn");
  l.debug("d");
  l.info("i");
  l.warn("w");
  l.error("e");
  expect(parsed().map((o) => o.level)).toEqual(["warn", "error"]);
  const silent = capture("silent");
  silent.l.error("e");
  expect(silent.lines).toEqual([]);
});

test("redaction is a safety net for fields nobody should pass", () => {
  const { l, parsed } = capture();
  l.info({ password: "p", token: "t", code: "c", state: "s", nonce: "n", email: "a@x.com", name: "Ann", client_secret: "cs", nested: { secret: "s", cookie: "c", authorization: "Bearer x", email: "a@x.com", name: "Ann" } }, "x");
  const [o] = parsed();
  const R = "[redacted]";
  expect(o).toMatchObject({ password: R, token: R, code: R, state: R, nonce: R, email: R, name: R, client_secret: R, nested: { secret: R, cookie: R, authorization: R, email: R, name: R } });
  expect(JSON.stringify(o)).not.toMatch(/a@x\.com|Ann|Bearer/);
});

test("string fields are capped at 200 characters and lose control, format and line-separator characters", () => {
  const { l, lines, parsed } = capture();
  l.warn({ provider: 'x"\n\roidc: forged \u2028\u0000\u001b[31m', long: "a".repeat(500), deep: { v: "b".repeat(500) } }, "unknown provider");
  expect(lines).toHaveLength(1);
  expect(lines[0].slice(0, -1)).not.toMatch(/[\n\u2028]/u);
  const [o] = parsed();
  expect(o.provider).toBe('x"oidc: forged [31m');
  expect(o.long).toBe("a".repeat(200));
  expect(o.deep.v).toBe("b".repeat(200));
});

test("a destination that throws never reaches the caller", () => {
  const l = createLogger(
    {
      write: () => {
        throw new Error("log down");
      },
    },
    "debug",
  );
  expect(() => l.error({ err: new Error("x") }, "request failed")).not.toThrow();
});

test("scrubPaths replaces the feed segment after DATA_DIR", () => {
  process.env.DATA_DIR = "/data";
  const m = "ENOENT: no such file or directory, open '/data/my-secret-feed/01J0ABCDEF.md'";
  expect(scrubPaths(m)).toBe("ENOENT: no such file or directory, open '/data/<feed>/01J0ABCDEF.md'");
  expect(scrubPaths("rename '/data/a' -> '/data/.deleted-0123456789ab'")).toBe("rename '/data/<feed>' -> '/data/<feed>'");
  process.env.DATA_DIR = "./some.dir/";
  expect(scrubPaths("open 'some.dir/feed/x.md'")).toBe("open 'some.dir/<feed>/x.md'");
  expect(scrubPaths(`open '${process.cwd()}/some.dir/feed'`)).toBe(`open '${process.cwd()}/some.dir/<feed>'`);
});

test("errorFields keeps type, code, errno and syscall, and scrubs message and stack", () => {
  process.env.DATA_DIR = "/data";
  const e = Object.assign(new Error("ENOENT: no such file or directory, open '/data/my-secret-feed/x.md'"), { code: "ENOENT", errno: -2, syscall: "open", path: "/data/my-secret-feed/x.md" });
  const f = errorFields(e);
  expect(f).toMatchObject({ type: "Error", code: "ENOENT", errno: -2, syscall: "open" });
  expect(JSON.stringify(f)).not.toContain("my-secret-feed");
  expect(f.stack).toContain("/data/<feed>/x.md");
  expect(errorFields("a thrown string with a secret")).toEqual({ type: "string" });
});

test("component loggers write through logTo, with the level it sets; an Error in err is scrubbed", () => {
  process.env.DATA_DIR = "/data";
  const lines: string[] = [];
  const restore = logTo((s) => void lines.push(s), "info");
  const l = logger("feeds");
  l.debug("hidden");
  l.info({ err: Object.assign(new Error("open '/data/feed-name/x'"), { code: "ENOENT" }) }, "shown");
  restore();
  l.error("after restore: not captured");
  expect(lines.map((s) => JSON.parse(s))).toEqual([{ level: "info", time: expect.any(String), component: "feeds", msg: "shown", err: expect.objectContaining({ type: "Error", message: "open '/data/<feed>/x'", code: "ENOENT" }) }]);
});

test("the default test level is silent", () => {
  expect(process.env.NOTEFEED_LOG_LEVEL).toBe("silent");
});
