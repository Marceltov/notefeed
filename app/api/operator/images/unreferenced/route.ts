import { unreferencedImagesRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's report on, and clean-up of, image objects that no note names; see backend/http/operator.ts.
export const GET = (req: Request) => unreferencedImagesRoute(req);
export const DELETE = (req: Request) => unreferencedImagesRoute(req);
