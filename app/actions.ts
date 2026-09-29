"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionOk, sessionValue, tokenMatches } from "@/lib/auth";
import { EmptyNoteError, NoteTooLargeError, createNote } from "@/lib/notes";
import { publicUrl } from "@/lib/url";

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  if (!tokenMatches(String(form.get("token") ?? ""))) return "That token doesn't match NOTEFEED_TOKEN.";
  (await cookies()).set(SESSION_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: publicUrl(await headers()).startsWith("https:"),
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

export async function postNoteAction(_prev: string | null, form: FormData): Promise<string | null> {
  // Server actions are reachable by direct POST, so re-check the session here, not only in proxy.ts.
  if (!sessionOk((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/login");
  let id: string;
  try {
    id = (await createNote(String(form.get("markdown") ?? ""))).id;
  } catch (e) {
    if (e instanceof EmptyNoteError) return "Note is empty";
    if (e instanceof NoteTooLargeError) return "Note exceeds 100 KB";
    throw e;
  }
  redirect(`/?posted=${id}`);
}
