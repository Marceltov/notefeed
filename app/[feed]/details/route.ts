import { feedSettingsRoute } from "@/backend";

// The feed's title and description form. A static segment, so it wins over [id].
export async function POST(req: Request, { params }: RouteContext<"/[feed]/details">) {
  return feedSettingsRoute(req, (await params).feed);
}
