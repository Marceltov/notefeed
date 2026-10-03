import { imageRoute } from "@/backend";

export const dynamic = "force-dynamic";

// Reached as /r/<readId>/<file>, see the rewrite in next.config.ts.
export async function GET(_req: Request, { params }: RouteContext<"/r/[readId]/files/[file]">) {
  const { readId, file } = await params;
  return imageRoute(readId, file);
}
