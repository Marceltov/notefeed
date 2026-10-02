// POST /login (proxy.ts rewrites it to /api/login) and POST /logout: the web UI's plain login and
// logout forms. Both answer with a redirect, for browsers and scripts alike.
import { IDENTITY_COOKIE, SESSION_COOKIE, locked, login } from "../auth";
import { NotefeedError, RateLimitedError } from "../errors";
import { clientIp } from "../limits";
import { publicUrl, safeNext } from "../urls";
import { parseForm, readCapped, seeOther } from "./request";

const YEAR = 60 * 60 * 24 * 365;

export async function loginRoute(req: Request): Promise<Response> {
  const h = req.headers;
  const bytes = await readCapped(req, 4096);
  const form = bytes ? await parseForm(bytes, h).catch(() => null) : null;
  const next = safeNext(form?.get("next"));
  try {
    const session = login(String(form?.get("password") ?? ""), clientIp(h));
    const secure = publicUrl(h).startsWith("https:") ? "; Secure" : "";
    return seeOther(next, { "Set-Cookie": `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secure}` });
  } catch (e) {
    if (!(e instanceof NotefeedError)) throw e;
    const retry = e instanceof RateLimitedError ? `&retry=${e.retryAfter}` : "";
    return seeOther(`/login?error=${e.code}${retry}&next=${encodeURIComponent(next)}`);
  }
}

// Relative Location, so it stays correct behind a reverse proxy.
export function logoutRoute(): Response {
  const clear = (name: string): [string, string] => ["Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`];
  return seeOther(locked() ? "/login" : "/", [clear(SESSION_COOKIE), clear(IDENTITY_COOKIE)]);
}
