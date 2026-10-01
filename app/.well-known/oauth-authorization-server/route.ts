import { authServerRoute, metadataPreflight } from "@/backend";

// Depends on the request host and the runtime password: never prerendered.
export const dynamic = "force-dynamic";

export const GET = authServerRoute;
export const OPTIONS = metadataPreflight;
