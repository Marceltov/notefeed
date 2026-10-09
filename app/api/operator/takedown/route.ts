import { takedownRoute } from "@/backend";

export const dynamic = "force-dynamic";

// The operator's takedown of a feed by its read link, read id or image URL; see backend/http/operator.ts.
export const POST = (req: Request) => takedownRoute(req);
