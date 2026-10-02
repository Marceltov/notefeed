// Runs once when the server starts: the startup line and the configuration warnings (backend/startup.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("@/backend/startup")).logStartup();
}
