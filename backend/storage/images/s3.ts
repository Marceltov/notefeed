// Images in an S3-compatible object store, any of them: the endpoint is a setting and there is no provider's SDK. Only put, get and
// delete of one object are used (no conditional writes, no listing), addressed path-style (<endpoint>/<bucket>/<key>), which every
// compatible store answers. Errors name the operation and the status, never the endpoint, the bucket or a key.
import { AwsClient } from "aws4fetch";
import { assertKey, type ImageStore } from "./types";

export type S3Options = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /** How often a request that met a 5xx or a 429 is sent again. */
  retries?: number;
  timeoutMs?: number;
};

export function createS3ImageStore(o: S3Options): ImageStore {
  const client = new AwsClient({ accessKeyId: o.accessKey, secretAccessKey: o.secretKey, service: "s3", region: o.region, retries: o.retries ?? 2, initRetryMs: 100 });
  const base = `${o.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(o.bucket)}`;

  async function send(operation: string, key: string, init: RequestInit): Promise<Response> {
    assertKey(key);
    let res: Response;
    try {
      res = await client.fetch(`${base}/${key}`, { ...init, signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
    } catch (e) {
      // No `cause`: the platform's error names the address.
      throw new Error(`image store: ${operation} failed (${(e as Error)?.name === "TimeoutError" ? "timeout" : "no answer"})`);
    }
    if (res.ok || res.status === 404) return res;
    await res.body?.cancel().catch(() => {});
    throw new Error(`image store: ${operation} failed (${res.status})`);
  }

  return {
    async put(key, bytes) {
      const res = await send("put", key, { method: "PUT", body: bytes as BodyInit, headers: { "content-type": "application/octet-stream" } });
      await res.body?.cancel().catch(() => {});
      if (res.status === 404) throw new Error("image store: put failed (404)"); // no such bucket
    },
    async get(key) {
      const res = await send("get", key, { method: "GET" });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send("delete", key, { method: "DELETE" });
      await res.body?.cancel().catch(() => {});
    },
  };
}
