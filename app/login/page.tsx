import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { locked } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!locked()) redirect("/"); // an open instance has no password
  return (
    <main className="mt-[18vh]">
      <h1 className="mb-6 text-xl font-bold tracking-tight">notefeed</h1>
      <LoginForm />
    </main>
  );
}
