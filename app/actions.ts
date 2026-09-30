"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionOk, sessionValue, passwordMatches } from "@/lib/auth";
import { checkFeed } from "@/lib/feeds";
import { EmptyNoteError, NoteTooLargeError, createNote } from "@/lib/notes";
import { checkLimits } from "@/lib/post";
import { publicUrl } from "@/lib/url";

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  if (!passwordMatches(String(form.get("password") ?? ""))) return "That password doesn't match NOTEFEED_PASSWORD.";
  (await cookies()).set(SESSION_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: publicUrl(await headers()).startsWith("https:"),
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

// `feed` is bound by the compose box on the client, so it is untrusted like the form.
export async function postNoteAction(feed: string, _prev: string | null, form: FormData): Promise<string | null> {
  // Server actions are reachable by direct POST, so re-check the session here, not only in proxy.ts.
  if (!sessionOk((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");
  const bad = checkFeed(feed);
  if (bad) return bad === "reserved" ? "Feed name is reserved" : "Invalid feed name";
  // Same rate limit and caps as POST /<feed>. Messages come from lib/post.ts, lower-case.
  const limited = await checkLimits(feed, await headers());
  if (limited) {
    const { error } = await limited.json();
    return error.charAt(0).toUpperCase() + error.slice(1);
  }
  let id: string;
  try {
    id = (await createNote(feed, String(form.get("markdown") ?? ""))).id;
  } catch (e) {
    if (e instanceof EmptyNoteError) return "Note is empty";
    if (e instanceof NoteTooLargeError) return "Note exceeds 100 KB";
    throw e;
  }
  redirect(`/${feed}?posted=${id}`);
}
