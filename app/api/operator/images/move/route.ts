import { moveImagesRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's move of image bytes into the configured store; see backend/http/operator.ts.
export const POST = (req: Request) => moveImagesRoute(req);
