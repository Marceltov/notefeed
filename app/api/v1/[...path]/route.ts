import { apiRoute } from "@/backend";

// The REST API: every /api/v1 route is in backend/http/api.ts, which also generates its OpenAPI spec.
// POST /<feed> is rewritten here by proxy.ts.
const handle = async (req: Request, { params }: RouteContext<"/api/v1/[...path]">) => apiRoute(req, (await params).path);

export { handle as GET, handle as POST };
