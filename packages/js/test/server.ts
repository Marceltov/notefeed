import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export type Recorded = { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer };

/** A local HTTP server that records requests and answers with queued replies. */
export async function fakeServer() {
  const requests: Recorded[] = [];
  const replies: [number, string, string, Record<string, string>][] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method!, path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      const [status, body, type, headers] = replies.shift() ?? [
        201,
        JSON.stringify({ id: "i", url: "u", feed_url: "f", read_url: "r" }),
        "application/json",
        {},
      ];
      res.writeHead(status, { "Content-Type": type, ...headers }).end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    reply(status: number, body: unknown, type = "application/json", headers: Record<string, string> = {}) {
      replies.push([status, typeof body === "string" ? body : JSON.stringify(body), type, headers]);
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
