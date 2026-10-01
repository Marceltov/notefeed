"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  AuthError,
  EmptyNoteError,
  FeedLimitError,
  InvalidFeedError,
  NoteLimitError,
  NoteTooLargeError,
  RateLimitedError,
  ReservedFeedError,
  SESSION_COOKIE,
  TooManyAttemptsError,
  clientIp,
  feedPath,
  login,
  postNote,
  publicUrl,
  sessionOk,
} from "@/backend";
import { safeNext } from "@/app/_lib/urls";

// The web UI's wording for what the backend refuses; anything else is a real error and throws.
function message(e: unknown): string {
  if (e instanceof TooManyAttemptsError) return `Too many attempts, try again in ${e.retryAfter} seconds.`;
  if (e instanceof RateLimitedError) return `Too many notes, try again in ${e.retryAfter} seconds.`;
  if (e instanceof AuthError) return "That password doesn't match NOTEFEED_PASSWORD.";
  if (e instanceof InvalidFeedError) return "Invalid feed name.";
  if (e instanceof ReservedFeedError) return "That feed name is reserved.";
  if (e instanceof FeedLimitError) return "This instance has reached its feed limit.";
  if (e instanceof NoteLimitError) return "This feed has reached its note limit.";
  if (e instanceof EmptyNoteError) return "The note is empty.";
  if (e instanceof NoteTooLargeError) return "The note is over 100 KB.";
  throw e;
}

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  const h = await headers();
  let session: string;
  try {
    session = login(String(form.get("password") ?? ""), clientIp(h));
  } catch (e) {
    return message(e);
  }
  (await cookies()).set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: publicUrl(h).startsWith("https:"),
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(safeNext(form.get("next")));
}

// `feed` is bound by the compose box on the client, so it is untrusted like the form.
export async function postNoteAction(feed: string, _prev: string | null, form: FormData): Promise<string | null> {
  // Server actions are reachable by direct POST, so re-check the session here, not only in proxy.ts.
  if (!sessionOk((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");
  let id: string;
  try {
    const note = await postNote(feed, clientIp(await headers()), async () => String(form.get("markdown") ?? ""));
    id = note.id;
  } catch (e) {
    return message(e);
  }
  redirect(`${feedPath(feed)}?posted=${id}`);
}
