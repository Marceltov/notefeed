import { rssRoute } from "@/backend";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: RouteContext<"/r/[readId]/feed.xml">) {
  return rssRoute(req, (await params).readId);
}
