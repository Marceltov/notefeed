import { feedAccessRoute } from "@/backend";

// The feed password forms (unlock, lock, change, remove). A static segment, so it wins over [id].
export async function POST(req: Request, { params }: RouteContext<"/[feed]/access">) {
  return feedAccessRoute(req, (await params).feed);
}
