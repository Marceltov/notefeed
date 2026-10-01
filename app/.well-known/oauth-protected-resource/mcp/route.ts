import { protectedResourceRoute } from "@/backend";

// Depends on the request host and the runtime password: never prerendered.
export const dynamic = "force-dynamic";

export const GET = protectedResourceRoute;
