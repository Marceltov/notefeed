// Images in an S3-compatible object store, any of them: the endpoint is a setting and there is no provider's SDK. Only put, get and
// delete of one object are used (no conditional writes, no listing), addressed path-style (<endpoint>/<bucket>/<key>), which every
// compatible store answers. Errors name the operation and the status, never the endpoint, the bucket or a key.
import { AwsV4Signer } from "aws4fetch";
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
  const base = `${o.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(o.bucket)}`;
  const retries = o.retries ?? 2;

  // Signed here and sent with the URL and the bytes themselves, never as a Request object: a Next server's fetch rebuilds a Request
  // from its body stream, the upload then goes out chunked, without Content-Length, and S3 stores refuse that (411).
  async function once(key: string, method: string, body?: Uint8Array): Promise<Response> {
    const signed = await new AwsV4Signer({
      method,
      url: `${base}/${key}`,
      headers: body ? { "content-type": "application/octet-stream" } : undefined,
      body: body as BodyInit | undefined,
      accessKeyId: o.accessKey,
      secretAccessKey: o.secretKey,
      service: "s3",
      region: o.region,
    }).sign();
    return fetch(signed.url.toString(), { method, headers: signed.headers, body: body as BodyInit | undefined, cache: "no-store", signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
  }

  async function send(operation: string, key: string, method: string, body?: Uint8Array): Promise<Response> {
    assertKey(key);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await once(key, method, body);
      } catch (e) {
        // No `cause`: the platform's error names the address.
        throw new Error(`image store: ${operation} failed (${(e as Error)?.name === "TimeoutError" ? "timeout" : "no answer"})`);
      }
      if (res.ok || res.status === 404) return res;
      await res.body?.cancel().catch(() => {});
      // A busy store (5xx, 429) is asked again, a little later each time; every operation here can be repeated safely.
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        continue;
      }
      throw new Error(`image store: ${operation} failed (${res.status})`);
    }
  }

  return {
    async put(key, bytes) {
      const res = await send("put", key, "PUT", bytes);
      await res.body?.cancel().catch(() => {});
      if (res.status === 404) throw new Error("image store: put failed (404)"); // no such bucket
    },
    async get(key) {
      const res = await send("get", key, "GET");
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await send("delete", key, "DELETE");
      await res.body?.cancel().catch(() => {});
    },
  };
}
