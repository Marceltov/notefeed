import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { ImageLimitError, UnsupportedTypeError } from "./errors";
import { resetFeedsForTests } from "./feeds";
import { IMAGE_FILE_RE, imageName, loadImage, sniffImage, storeImage } from "./images";
import { createNote } from "./notes";

beforeEach(async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "notefeed-img-"));
  process.env.NOTEFEED_SECRET = "test-secret-".padEnd(32, "x");
  delete process.env.NOTEFEED_MAX_IMAGES_PER_FEED;
  resetFeedsForTests();
});

const bytes = (...b: number[]) => new Uint8Array(b);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const GIF = new TextEncoder().encode("GIF89a\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x10\x00\x00\x00WEBPVP8 ");
const png = (n: number) => bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n);

describe("sniffImage", () => {
  test.each([
    ["png", PNG],
    ["jpg", JPG],
    ["gif", GIF],
    ["webp", WEBP],
  ] as const)("%s by its first bytes", (type, b) => expect(sniffImage(b)).toBe(type));
  test.each([
    ["svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["html", new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
    ["empty", new Uint8Array()],
    ["3 bytes", bytes(0x89, 0x50, 0x4e)],
    ["RIFF but not WebP", new TextEncoder().encode("RIFF\x10\x00\x00\x00WAVEfmt ")],
  ])("%s is not an image", (_n, b) => expect(sniffImage(b)).toBeNull());
});

test("the name is 32 hex of the SHA-256 plus the extension", () => {
  expect(imageName(PNG, "png")).toMatch(IMAGE_FILE_RE);
  expect(imageName(PNG, "png")).toBe(imageName(PNG.slice(), "png"));
  expect(imageName(PNG, "png")).not.toBe(imageName(png(9), "png"));
});

describe("storeImage / loadImage", () => {
  test("same bytes twice: same name, one file", async () => {
    await createNote("pics", "# x");
    const a = await storeImage("pics", PNG);
    const b = await storeImage("pics", PNG);
    expect(a).toBe(b);
    expect((await readdir(join(process.env.DATA_DIR!, "pics"))).filter((f) => IMAGE_FILE_RE.test(f))).toEqual([a]);
    expect((await loadImage("pics", a))!.contentType).toBe("image/png");
    expect(Array.from((await loadImage("pics", a))!.bytes)).toEqual(Array.from(PNG));
  });
  test("an unsupported type is refused and writes nothing", async () => {
    await createNote("pics", "# x");
    await expect(storeImage("pics", new TextEncoder().encode("<html>"))).rejects.toBeInstanceOf(UnsupportedTypeError);
    expect((await readdir(join(process.env.DATA_DIR!, "pics"))).filter((f) => IMAGE_FILE_RE.test(f))).toEqual([]);
  });
  test("per-feed cap: a new image is refused, a repeat is not", async () => {
    process.env.NOTEFEED_MAX_IMAGES_PER_FEED = "2";
    await createNote("pics", "# x");
    await storeImage("pics", png(1));
    await storeImage("pics", png(2));
    await expect(storeImage("pics", png(3))).rejects.toBeInstanceOf(ImageLimitError);
    await expect(storeImage("pics", png(1))).resolves.toMatch(IMAGE_FILE_RE);
  });
  test("a missing feed is not created", async () => {
    await expect(storeImage("ghost", PNG)).rejects.toMatchObject({ code: "not_found" });
    await expect(readdir(join(process.env.DATA_DIR!, "ghost"))).rejects.toThrow();
  });
  test.each(["../x", "../../etc/passwd", ".password", "0".repeat(31) + "A.png", "a".repeat(32) + ".svg", "a".repeat(33) + ".png", "a%2Fb", ""])(
    "loadImage(%j) is null",
    async (name) => {
      await createNote("pics", "# x");
      expect(await loadImage("pics", name)).toBeNull();
    },
  );
  test("a valid name that is missing is null", async () => {
    await createNote("pics", "# x");
    expect(await loadImage("pics", "a".repeat(32) + ".png")).toBeNull();
  });
});

// The names above would also miss on a missing file; here real files sit where a bad name would reach them.
test("loadImage never reads a planted file through a bad name", async () => {
  await createNote("pics", "# x");
  const feed = join(process.env.DATA_DIR!, "pics");
  await writeFile(join(feed, ".password"), "secret");
  const upper = "A".repeat(32) + ".png";
  const long = "a".repeat(33) + ".png";
  const svg = "a".repeat(32) + ".svg";
  for (const f of [upper, long, svg]) await writeFile(join(feed, f), PNG);
  for (const name of ["../.password", upper, long, svg]) expect(await loadImage("pics", name)).toBeNull();
});
