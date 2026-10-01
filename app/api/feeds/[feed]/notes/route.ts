import { postNoteRoute } from "@/backend";

// Reached through proxy.ts, which rewrites POST /<feed> here.
export async function POST(req: Request, { params }: RouteContext<"/api/feeds/[feed]/notes">) {
  return postNoteRoute(req, (await params).feed);
}
