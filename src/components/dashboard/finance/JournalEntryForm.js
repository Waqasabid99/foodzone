"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";
import { entryBalance, journalPayload, lineProblem, toDateInput } from "@/lib/finance";

const blankLine = () => ({ key: Math.random().toString(36).slice(2), accountId: "", debit: "", credit: "", description: "" });

/**
 * Writing an entry into the ledger by hand.
 *
 * Almost nothing should come through here — the ledger is overwhelmingly
 * written by the system as a consequence of real events, and a manual entry
 * is either a correction or an opening balance. The form says so, because a
 * finance screen that makes hand-posting feel routine ends up with a ledger
 * that cannot be traced back to anything.
 *
 * **The running total is live and the save button is disabled until it
 * balances.** The server refuses an unbalanced entry anyway, but finding that
 * out on submit, after twelve lines, is a far worse way to learn it than
 * watching the difference close as you type. The difference is shown as a
 * figure rather than a red cross: "out by 450" tells you where to look.
 *
 * Debit and credit are separate columns and a line may hold only one. A
 * single signed column would be shorter and is how people get the direction
 * wrong — in double-entry the side *is* the meaning.
 */
export default function JournalEntryForm({ accounts, branches, defaultBranchId = "", canPost }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    entryDate: toDateInput(new Date()),
    memo: "",
    branchId: defaultBranchId,
    lines: [blankLine(), blankLine()],
  }));
  const [postNow, setPostNow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState(false);

  const balance = useMemo(() => entryBalance(form.lines), [form.lines]);
  const filled = form.lines.filter((line) => line.accountId || line.debit || line.credit);
  const problems = filled.map((line) => lineProblem(line));
  const usable = filled.length >= 2 && problems.every((problem) => !problem) && balance.balanced;

  const accountLabel = (account) => `${account.code} — ${account.name}`;

  function setLine(key, patch) {
    setForm((state) => ({
      ...state,
      lines: state.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  }

  // Typing in one column clears the other: a line with both is not a smaller
  // entry, it is an ambiguous one, and the ledger cannot represent it.
  const setSide = (key, side, value) => setLine(key, { [side]: value, [side === "debit" ? "credit" : "debit"]: "" });

  async function submit(event) {
    event.preventDefault();
    setTouched(true);
    if (pending || !usable) return;

    setPending(true);
    setError(null);
    try {
      const payload = journalPayload({ ...form, lines: filled });
      const entry = await api.post("/admin/journal-entries", { ...payload, post: postNow });
      toast.success(postNow ? "Posted." : "Saved as a draft.");
      router.push(`/dashboard/journal/${entry.id}`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FormAlert>{error}</FormAlert>

      <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
        Almost every entry in the ledger is written automatically by whatever caused it — an order, a delivery, a
        payroll run. A hand-written entry is for a correction or an opening balance, and it will show in the journal as
        &ldquo;Manual&rdquo; for ever, so the memo is worth filling in properly.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="entry-date"
          label="Date"
          type="date"
          value={form.entryDate}
          onChange={(event) => setForm((state) => ({ ...state, entryDate: event.target.value }))}
          hint="Which period it lands in. A closed period will refuse it."
          required
        />
        {branches.length ? (
          <SelectField
            id="entry-branch"
            label="Branch"
            value={form.branchId}
            onChange={(event) => setForm((state) => ({ ...state, branchId: event.target.value }))}
            options={[{ value: "", label: "The company as a whole" }, ...branches.map((row) => ({ value: row.id, label: row.name }))]}
            hint="Leave it on the company for anything that is not one outlet's."
          />
        ) : null}
      </div>

      <TextAreaField
        id="entry-memo"
        label="What this is for"
        value={form.memo}
        onChange={(event) => setForm((state) => ({ ...state, memo: event.target.value }))}
        rows={2}
        hint="The sentence somebody reads in a year when they find this entry and wonder."
      />

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-headline-md text-on-surface">Lines</h2>

        <ul className="flex flex-col gap-3">
          {form.lines.map((line, index) => {
            const problem = touched && (line.accountId || line.debit || line.credit) ? lineProblem(line) : null;
            return (
              <li key={line.key} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-label-bold text-on-surface-variant">Line {index + 1}</span>
                  {form.lines.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => setForm((state) => ({ ...state, lines: state.lines.filter((row) => row.key !== line.key) }))}
                      aria-label={`Remove line ${index + 1}`}
                      className="rounded-field p-2 text-on-surface-variant hover:bg-surface-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                </div>

                <SelectField
                  id={`line-account-${line.key}`}
                  label="Account"
                  value={line.accountId}
                  onChange={(event) => setLine(line.key, { accountId: event.target.value })}
                  options={[{ value: "", label: "Choose an account" }, ...accounts.map((account) => ({ value: account.id, label: accountLabel(account) }))]}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id={`line-debit-${line.key}`}
                    label="Debit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.debit}
                    onChange={(event) => setSide(line.key, "debit", event.target.value)}
                    autoComplete="off"
                  />
                  <Field
                    id={`line-credit-${line.key}`}
                    label="Credit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.credit}
                    onChange={(event) => setSide(line.key, "credit", event.target.value)}
                    autoComplete="off"
                  />
                </div>

                <Field
                  id={`line-note-${line.key}`}
                  label="Note"
                  value={line.description}
                  onChange={(event) => setLine(line.key, { description: event.target.value })}
                  autoComplete="off"
                />

                {problem ? (
                  <p role="alert" className="rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">
                    {problem}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => setForm((state) => ({ ...state, lines: [...state.lines, blankLine()] }))}
          className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add a line
        </button>
      </div>

      <div
        aria-live="polite"
        className={`flex flex-col gap-1 rounded-card p-5 ${balance.balanced ? "bg-success-container text-on-success-container" : "bg-surface-container-high text-on-surface"}`}
      >
        <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-md">
          <span>Debits</span>
          <span className="tabular-nums">{formatMoney(balance.debit)}</span>
        </p>
        <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-md">
          <span>Credits</span>
          <span className="tabular-nums">{formatMoney(balance.credit)}</span>
        </p>
        <p className="flex flex-wrap items-baseline justify-between gap-2 text-label-bold">
          {balance.empty ? (
            <span>Nothing entered yet</span>
          ) : balance.balanced ? (
            <span>The two sides agree</span>
          ) : (
            <>
              <span>Out by</span>
              <span className="tabular-nums">{formatMoney(String(balance.difference).replace("-", ""))}</span>
            </>
          )}
        </p>
      </div>

      {canPost ? (
        <label className="flex items-start gap-3 rounded-field bg-surface-container-low px-4 py-3">
          <input
            type="checkbox"
            checked={postNow}
            onChange={(event) => setPostNow(event.target.checked)}
            className="mt-1 size-4 accent-primary"
          />
          <span className="text-body-md text-on-surface">
            Post it straight away
            <span className="block text-on-surface-variant">
              A posted entry is in the books and can only be reversed, never edited. Leaving it as a draft lets someone
              else look first, which is usually the point of writing one by hand.
            </span>
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !usable}
          className="rounded-field bg-primary-container px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Saving…" : postNow ? "Post it" : "Save as a draft"}
        </button>
        {!usable ? (
          <p className="text-body-md text-on-surface-variant">
            {filled.length < 2
              ? "An entry needs at least two lines."
              : problems.some(Boolean)
                ? "One of the lines is not finished."
                : "The debits and credits have to agree before this can be saved."}
          </p>
        ) : null}
      </div>
    </form>
  );
}
