// A stand-in for an S3-compatible store, for tests: objects in a map, served over HTTP path-style. It checks that a request is
// signed (an AWS4-HMAC-SHA256 Authorization header naming the access key) but not the signature itself; a real store does that in CI.
// Like a real store, it refuses an upload that does not say its length (411): that is what a body sent as a stream looks like.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeS3 = {
  endpoint: string;
  objects: Map<string, Buffer>;
  /** When each object was last written; a test may set one back. */
  modified: Map<string, Date>;
  /** Every request seen, as "METHOD /path". */
  requests: string[];
  /** Answer the next `times` requests with this status. */
  failNext(status: number, times?: number): void;
  close(): Promise<void>;
};

export async function startFakeS3(accessKey: string, buckets: string[] = [], port = 0): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const modified = new Map<string, Date>();
  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const known = new Set(buckets);
  const requests: string[] = [];
  let fail: { status: number; times: number } | undefined;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      requests.push(`${req.method} ${path}`);
      const answer = (status: number, body: Buffer | string = "") => {
        res.writeHead(status, { "content-length": Buffer.byteLength(body) });
        res.end(body);
      };
      if (fail && fail.times > 0) {
        fail.times--;
        return answer(fail.status, "<Error/>");
      }
      const auth = req.headers.authorization ?? "";
      if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKey}/`) || !auth.includes("Signature=")) return answer(403, "<Error><Code>AccessDenied</Code></Error>");
      const [, bucket, ...rest] = path.split("/");
      const key = rest.join("/");
      if (key === "" && req.method === "GET" && url.searchParams.get("list-type") === "2") {
        if (!known.has(bucket)) return answer(404, "<Error><Code>NoSuchBucket</Code></Error>");
        // Pages of `max-keys`, in key order; the continuation token is the last key given.
        const max = Number(url.searchParams.get("max-keys") ?? 1000);
        const after = url.searchParams.get("continuation-token") ?? "";
        const all = [...objects.keys()].filter((id) => id.startsWith(`${bucket}/`)).map((id) => id.slice(bucket.length + 1)).sort().filter((k) => k > after);
        const page = all.slice(0, max);
        const more = all.length > page.length;
        const contents = page.map((k) => `<Contents><Key>${escapeXml(k)}</Key><LastModified>${(modified.get(`${bucket}/${k}`) ?? new Date()).toISOString()}</LastModified><Size>${objects.get(`${bucket}/${k}`)!.byteLength}</Size></Contents>`).join("");
        return answer(200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${escapeXml(bucket)}</Name><IsTruncated>${more}</IsTruncated>${contents}${more ? `<NextContinuationToken>${escapeXml(page.at(-1)!)}</NextContinuationToken>` : ""}</ListBucketResult>`);
      }
      if (key === "") {
        if (req.method !== "PUT") return answer(405);
        if (known.has(bucket)) return answer(409, "<Error><Code>BucketAlreadyOwnedByYou</Code></Error>");
        known.add(bucket);
        return answer(200);
      }
      if (!known.has(bucket)) return answer(404, "<Error><Code>NoSuchBucket</Code></Error>");
      const id = `${bucket}/${key}`;
      if (req.method === "PUT") {
        if (req.headers["content-length"] === undefined) return answer(411, "<Error><Code>MissingContentLength</Code></Error>");
        objects.set(id, Buffer.concat(chunks));
        modified.set(id, new Date());
        return answer(200);
      }
      if (req.method === "GET") return objects.has(id) ? answer(200, objects.get(id)!) : answer(404, "<Error><Code>NoSuchKey</Code></Error>");
      if (req.method === "DELETE") {
        objects.delete(id);
        modified.delete(id);
        return answer(204);
      }
      answer(405);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    objects,
    modified,
    requests,
    failNext: (status, times = 1) => void (fail = { status, times }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
