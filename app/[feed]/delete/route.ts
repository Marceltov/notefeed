import { feedDeleteRoute } from "@/backend";

// The feed's delete form. A static segment, so it wins over [id].
export async function POST(req: Request, { params }: RouteContext<"/[feed]/delete">) {
  return feedDeleteRoute(req, (await params).feed);
}
