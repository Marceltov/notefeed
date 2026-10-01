import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export type Recorded = { method: string; path: string; headers: IncomingHttpHeaders; body: Buffer };

type Reply = [number, string, string, Record<string, string>];

/** A local HTTP server that records requests and answers with queued replies, or with `route` when set. */
export async function fakeServer() {
  const requests: Recorded[] = [];
  const replies: Reply[] = [];
  let route: ((r: Recorded) => [number, unknown]) | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const recorded = { method: req.method!, path: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      requests.push(recorded);
      const routed = route?.(recorded);
      const [status, body, type, headers] = (routed && ([routed[0], JSON.stringify(routed[1]), "application/json", {}] as Reply)) ?? replies.shift() ?? [
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
    /** Answer every request from its method and path instead of the queue. */
    route(fn: (r: Recorded) => [number, unknown]) {
      route = fn;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
