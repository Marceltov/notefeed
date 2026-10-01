import { dispatch } from "@/backend";

// The REST API: every /api/v1 route is an entry in backend/http/api.ts, which also generates the
// OpenAPI description. POST /<feed> is rewritten here by proxy.ts.
const handle = async (req: Request, { params }: RouteContext<"/api/v1/[...path]">) => dispatch(req, (await params).path);

export { handle as GET, handle as POST };
