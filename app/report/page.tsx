import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { reportEndpoint } from "@/backend";
import { Header } from "@/components/Header";
import { ReportForm, Sent, type ReportValues } from "@/components/ReportForm";

export const metadata: Metadata = { title: "Report a note", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic"; // the endpoint is read on every request

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

// The built-in report page (issue #156): the "Report" link on a note opens it with the note's ids in the query, and
// the form posts to the operator's inbox (NOTEFEED_REPORT_ENDPOINT). notefeed stores nothing (ADR 0026). Without an
// endpoint there is no page.
export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const endpoint = reportEndpoint();
  if (!endpoint) notFound();
  const q = await searchParams;
  const values: ReportValues = {
    read_id: one(q.read_id).slice(0, 200),
    note_id: one(q.note_id).slice(0, 200),
    file: one(q.file).slice(0, 200),
    reason: one(q.reason).slice(0, 200),
    text: one(q.text).slice(0, 4000),
    email: one(q.email).slice(0, 254),
  };
  const errors = all(q.error).slice(0, 10).map((e) => e.slice(0, 200));
  const sent = one(q.sent) === "1";
  return (
    <>
      <Header />
      <main>
        <h1 className="text-2xl font-bold tracking-tight">{sent ? "Report sent" : "Report a note"}</h1>
        {sent ? (
          <div className="mt-4">
            <Sent />
          </div>
        ) : (
          <>
            <p className="mt-1 mb-6 max-w-prose text-muted">
              Tell the operator of this instance what is wrong with the note you came from. The report goes to the operator&apos;s inbox, not into notefeed, and the operator decides what happens to the note.
            </p>
            <ReportForm endpoint={endpoint} values={values} errors={errors} />
          </>
        )}
      </main>
    </>
  );
}
