import { AwsClient } from "aws4fetch";
import { afterEach, describe, expect, test } from "vitest";
import { describeImageStore } from "./contract";
import { startFakeS3, type FakeS3 } from "./fake-s3";
import { createS3ImageStore } from "./s3";
import { newKey } from "./types";

const fakes: FakeS3[] = [];
async function fake(buckets = ["images"]) {
  const f = await startFakeS3("access-a", buckets);
  fakes.push(f);
  return f;
}
const storeOn = (f: FakeS3, more: Partial<Parameters<typeof createS3ImageStore>[0]> = {}) =>
  createS3ImageStore({ endpoint: f.endpoint, bucket: "images", region: "us-east-1", accessKey: "access-a", secretKey: "secret-s", retries: 0, ...more });
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

describeImageStore("s3 (in-process stand-in)", async () => storeOn(await fake()));

test("an object is addressed path-style, <endpoint>/<bucket>/<key>, and a trailing slash on the endpoint does not matter", async () => {
  const f = await fake();
  const key = newKey();
  await storeOn(f, { endpoint: `${f.endpoint}/` }).put(key, Buffer.from("x"));
  expect(f.requests).toEqual([`PUT /images/${key}`]);
  expect([...f.objects.keys()]).toEqual([`images/${key}`]);
});

test("a failure names the operation and the status, and nothing of the endpoint, the bucket or the keys", async () => {
  const f = await fake();
  const store = storeOn(f);
  const key = newKey();
  for (const [operation, call] of [
    ["put", () => store.put(key, Buffer.from("x"))],
    ["get", () => store.get(key)],
    ["delete", () => store.delete(key)],
  ] as const) {
    f.failNext(500);
    const err = (await call().catch((e: Error) => e)) as Error;
    expect(err.message).toBe(`image store: ${operation} failed (500)`);
    expect(err.cause).toBeUndefined();
    for (const secret of [f.endpoint, "127.0.0.1", "images", key, "access-a", "secret-s"]) expect(err.message).not.toContain(secret);
  }
});

// A Next server's fetch rebuilds a Request object from its body stream, and the upload then has no Content-Length (issue #130).
test("an upload is given to fetch as a URL and bytes, never as a Request, and says its length", async () => {
  const f = await fake();
  const real = globalThis.fetch;
  const seen: unknown[][] = [];
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => (seen.push(args), real(...args))) as typeof fetch;
  try {
    await storeOn(f).put(newKey(), Buffer.from("x"));
  } finally {
    globalThis.fetch = real;
  }
  expect(seen).toHaveLength(1);
  expect(typeof seen[0][0]).toBe("string");
  expect((seen[0][1] as RequestInit).body).toBeInstanceOf(Uint8Array);
});

test("the stand-in refuses an upload sent as a stream, as S3 stores do", async () => {
  const f = await fake();
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({ accessKeyId: "access-a", secretAccessKey: "secret-s", service: "s3", region: "us-east-1", retries: 0 });
  const stream = new Blob(["x"]).stream();
  const res = await client.fetch(`${f.endpoint}/images/${newKey()}`, { method: "PUT", body: stream, duplex: "half" } as RequestInit);
  expect(res.status).toBe(411);
});

test("a listing longer than one page is followed to its end, and what is not named like a key is left out", async () => {
  const f = await fake();
  const store = storeOn(f, { pageSize: 2 });
  const keys = [newKey(), newKey(), newKey(), newKey(), newKey()];
  for (const key of keys) await store.put(key, Buffer.from("x"));
  f.objects.set("images/someone-elses&file.txt", Buffer.from("not ours"));
  f.requests.length = 0;
  const listed = [];
  for await (const o of store.list()) listed.push(o.key);
  expect(listed.sort()).toEqual([...keys].sort());
  expect(f.requests).toHaveLength(3);
});

test("a listing gives each object's own time of writing", async () => {
  const f = await fake();
  const store = storeOn(f);
  const key = newKey();
  await store.put(key, Buffer.from("x"));
  f.modified.set(`images/${key}`, new Date("2026-01-02T03:04:05.000Z"));
  for await (const o of store.list()) expect(o).toEqual({ key, size: 1, modified: new Date("2026-01-02T03:04:05.000Z") });
});

test("a listing of a bucket that is not there fails, and a failure names no address", async () => {
  const f = await fake([]);
  const all = async (s: ReturnType<typeof storeOn>) => {
    for await (const o of s.list()) void o;
  };
  await expect(all(storeOn(f))).rejects.toThrow("image store: list failed (404)");
  const g = await fake();
  g.failNext(500);
  await expect(all(storeOn(g))).rejects.toThrow("image store: list failed (500)");
});

test("a wrong access key is an error, not a missing object", async () => {
  const f = await fake();
  const store = storeOn(f, { accessKey: "someone-else" });
  await expect(store.get(newKey())).rejects.toThrow("image store: get failed (403)");
});

test("a bucket that does not exist fails the put", async () => {
  const f = await fake([]);
  await expect(storeOn(f).put(newKey(), Buffer.from("x"))).rejects.toThrow("image store: put failed (404)");
});

test("a store that does not answer is an error without the address", async () => {
  const f = await fake();
  const store = storeOn(f);
  await f.close();
  fakes.length = 0;
  const err = (await store.get(newKey()).catch((e: Error) => e)) as Error;
  expect(err.message).toBe("image store: get failed (no answer)");
  expect(err.cause).toBeUndefined();
});

test("a request that meets a 503 is sent again", async () => {
  const f = await fake();
  const store = storeOn(f, { retries: 2 });
  const key = newKey();
  f.failNext(503, 2);
  await store.put(key, Buffer.from("x"));
  expect(f.objects.get(`images/${key}`)?.toString()).toBe("x");
  expect(f.requests).toHaveLength(3);
});

// The same contract against a real S3-compatible store (MinIO in CI), which checks the signature. The bucket is made here.
const endpoint = process.env.NOTEFEED_TEST_S3_ENDPOINT ?? "";
if (!endpoint) console.info("NOTEFEED_TEST_S3_ENDPOINT not set: skipping the image store contract on a real S3-compatible store");
describe.skipIf(!endpoint)("a real S3-compatible store", () => {
  const o = {
    endpoint,
    bucket: process.env.NOTEFEED_TEST_S3_BUCKET || "notefeed-test",
    region: process.env.NOTEFEED_TEST_S3_REGION || "us-east-1",
    accessKey: process.env.NOTEFEED_TEST_S3_ACCESS_KEY ?? "",
    secretKey: process.env.NOTEFEED_TEST_S3_SECRET_KEY ?? "",
  };
  describeImageStore("s3 (real)", async () => {
    const client = new AwsClient({ accessKeyId: o.accessKey, secretAccessKey: o.secretKey, service: "s3", region: o.region });
    const res = await client.fetch(`${o.endpoint.replace(/\/+$/, "")}/${o.bucket}`, { method: "PUT" });
    if (!res.ok && res.status !== 409) throw new Error(`could not make the test bucket (${res.status})`);
    return createS3ImageStore(o);
  });
});
