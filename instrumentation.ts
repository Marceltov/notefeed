// Runs once when the server starts: the request log (backend/http/requestlog.ts), then the startup line and the configuration
// warnings (backend/startup.ts).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const requestLog = await import("@/backend/http/requestlog");
  requestLog.installRequestLog();
  requestLog.dropClientLeftErrors();
  await (await import("@/backend/startup")).logStartup();
}
