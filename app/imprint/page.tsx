import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Imprint" };

export const dynamic = "force-dynamic"; // the operator's file is read on every request

export default function Page() {
  return <LegalPage which="imprint" />;
}
