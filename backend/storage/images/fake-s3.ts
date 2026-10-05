// A stand-in for an S3-compatible store, for tests: objects in a map, served over HTTP path-style. It checks that a request is
// signed (an AWS4-HMAC-SHA256 Authorization header naming the access key) but not the signature itself; a real store does that in CI.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeS3 = {
  endpoint: string;
  objects: Map<string, Buffer>;
  /** Every request seen, as "METHOD /path". */
  requests: string[];
  /** Answer the next `times` requests with this status. */
  failNext(status: number, times?: number): void;
  close(): Promise<void>;
};

export async function startFakeS3(accessKey: string, buckets: string[] = []): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const known = new Set(buckets);
  const requests: string[] = [];
  let fail: { status: number; times: number } | undefined;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
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
      if (key === "") {
        if (req.method !== "PUT") return answer(405);
        if (known.has(bucket)) return answer(409, "<Error><Code>BucketAlreadyOwnedByYou</Code></Error>");
        known.add(bucket);
        return answer(200);
      }
      if (!known.has(bucket)) return answer(404, "<Error><Code>NoSuchBucket</Code></Error>");
      const id = `${bucket}/${key}`;
      if (req.method === "PUT") {
        objects.set(id, Buffer.concat(chunks));
        return answer(200);
      }
      if (req.method === "GET") return objects.has(id) ? answer(200, objects.get(id)!) : answer(404, "<Error><Code>NoSuchKey</Code></Error>");
      if (req.method === "DELETE") {
        objects.delete(id);
        return answer(204);
      }
      answer(405);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    objects,
    requests,
    failNext: (status, times = 1) => void (fail = { status, times }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
