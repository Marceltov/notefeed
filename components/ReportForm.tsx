"use client";

import { useState } from "react";

// The reasons the operator's inbox knows (the `reason` field of the notefeed-report form in noticebox).
export const REASONS = ["Illegal content", "Personal data", "Copyright", "Spam", "Other"] as const;

export type ReportValues = { read_id: string; note_id: string; file: string; reason: string; text: string; email: string };

const field = "w-full rounded-sm border border-rule bg-transparent px-3 py-1.5 focus:border-carbon focus:outline-none";

// The report form (issue #156): it posts straight to the operator's inbox, never to notefeed. With JavaScript the
// post is JSON and the answer is shown here; without, the browser posts the form and the inbox sends it back, to
// `?sent=1` or to this page with `?error=` and what was typed.
export function ReportForm({ endpoint, values, errors: initialErrors }: { endpoint: string; values: ReportValues; errors: string[] }) {
  const [errors, setErrors] = useState(initialErrors);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (sent) return <Sent />;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSending(true);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(data) });
      if (res.status === 201) return setSent(true);
      if (res.status === 400) return setErrors(((await res.json()) as { errors?: string[] }).errors ?? ["The report was not accepted."]);
      if (res.status === 429) return setErrors(["Too many reports from your connection just now. Try again in a few minutes."]);
      setErrors(["The report could not be sent. Try again in a moment."]);
    } catch {
      setErrors(["The report could not be sent. Check your connection and try again."]);
    } finally {
      setSending(false);
    }
  };

  return (
    <form method="post" action={endpoint} onSubmit={submit} className="max-w-prose">
      <input type="hidden" name="read_id" value={values.read_id} />
      <input type="hidden" name="note_id" value={values.note_id} />
      <input type="hidden" name="file" value={values.file} />
      {errors.length > 0 && (
        <ul role="alert" className="mb-4 list-disc pl-5 text-error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <label htmlFor="report-reason" className="mb-1 block text-sm text-muted">
        Reason
      </label>
      <select id="report-reason" name="reason" required defaultValue={values.reason} className={field}>
        <option value="">Choose one</option>
        {REASONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <label htmlFor="report-text" className="mt-4 mb-1 block text-sm text-muted">
        What is wrong
      </label>
      <textarea id="report-text" name="text" required rows={6} maxLength={4000} defaultValue={values.text} className={field} />
      <label htmlFor="report-email" className="mt-4 mb-1 block text-sm text-muted">
        Your email, if you want an answer
      </label>
      <input id="report-email" name="email" type="email" maxLength={254} defaultValue={values.email} autoComplete="email" className={field} />
      <p className="mt-1 text-sm text-muted">Optional. The operator uses it only to answer you, then removes it.</p>
      <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Leave this field empty <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button type="submit" disabled={sending} className="mt-6 rounded-sm bg-carbon px-4 py-1.5 font-bold text-on-carbon disabled:opacity-60">
        Send report
      </button>
    </form>
  );
}

export function Sent() {
  return (
    <p role="status" className="max-w-prose">
      Report sent. The operator has been told and will look at the note.
    </p>
  );
}
