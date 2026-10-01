import { authorizeRoute } from "@/backend";

// The form on /oauth/authorize posts here (a page can't have a route handler next to it).
export const POST = authorizeRoute;
