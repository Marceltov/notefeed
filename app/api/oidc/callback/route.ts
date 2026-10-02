import { oidcCallbackRoute } from "@/backend";

// The OIDC provider sends the browser back here (the redirect URI registered with it).
export const GET = oidcCallbackRoute;
