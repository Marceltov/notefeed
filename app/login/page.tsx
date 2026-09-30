import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { locked } from "@/lib/auth";
import { safeNext } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (!locked()) redirect(safeNext(next)); // an open instance has no password
  return (
    <main className="mt-[18vh]">
      <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
      <LoginForm next={safeNext(next)} />
    </main>
  );
}
