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
