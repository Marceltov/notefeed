import { loginRoute } from "@/backend";

// Reached through proxy.ts, which rewrites POST /login here (/login itself is the login page).
export const POST = loginRoute;
