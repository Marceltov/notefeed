import { noteFormRoute } from "@/backend";

// The note's edit and delete forms. Three segments, so it doesn't clash with the note page or /<feed>/access.
export async function POST(req: Request, { params }: RouteContext<"/[feed]/[id]/[action]">) {
  const { feed, id, action } = await params;
  return noteFormRoute(req, feed, id, action);
}
