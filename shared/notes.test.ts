import { describe, expect, test } from "vitest";
import { bodyAfterTitle, extractTitle, idStamp } from "./notes";

const at = (iso: string) => new Date(iso);

describe("extractTitle", () => {
  test("uses the first heading", () => {
    expect(extractTitle("# Backup finished\nbody")).toBe("Backup finished");
  });
  test("falls back to the first non-empty line without markers", () => {
    expect(extractTitle("\n\n- **hello** world")).toBe("hello world");
    expect(extractTitle("> quoted")).toBe("quoted");
  });
  test("is empty for blank input", () => {
    expect(extractTitle("")).toBe("");
    expect(extractTitle("   \n")).toBe("");
  });
  test("caps at 100 chars", () => {
    expect(extractTitle("x".repeat(150))).toHaveLength(100);
  });
  test("ignores BOM and CRLF", () => {
    expect(extractTitle("﻿# Title\r\nbody")).toBe("Title");
  });
});

test("idStamp formats UTC to the second", () => {
  expect(idStamp(at("2026-09-29T14:05:12.345Z"))).toBe("20260929T140512Z");
});

describe("bodyAfterTitle", () => {
  test("drops the heading used as title", () => {
    expect(bodyAfterTitle("# Backup finished\nnas-01 ok")).toBe("nas-01 ok");
  });
  test("drops the first line when it was the title", () => {
    expect(bodyAfterTitle("\n\nCert renewed\nmore")).toBe("more");
    expect(bodyAfterTitle("Cert renewed")).toBe("");
  });
  test("keeps everything when the title heading is further down", () => {
    expect(bodyAfterTitle("intro\n# Heading\nx")).toBe("intro\n# Heading\nx");
  });
});

describe("extractTitle and bodyAfterTitle skip fenced code", () => {
  const md = "Backup done\n\n```sh\n# run this\n```";
  test("title ignores # inside a fence", () => {
    expect(extractTitle(md)).toBe("Backup done");
    expect(extractTitle("~~~\n# no\n~~~\n# Real")).toBe("Real");
  });
  test("body keeps the fence", () => {
    expect(bodyAfterTitle(md)).toBe("```sh\n# run this\n```");
  });
});
