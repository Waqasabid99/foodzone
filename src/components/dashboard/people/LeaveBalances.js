"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";

/**
 * What leave this person has left, and opening the year that decides it.
 *
 * Neither half of this had a screen. The balances existed and were never
 * shown, so the number an approver most needs when somebody asks for a week
 * off — how much they actually have — was only ever in the database. And
 * opening a year had no button, which matters more than it sounds: a balance
 * row has to exist before any of this reads as anything other than zero, and
 * an employee with no balances looks identical to one who has used everything.
 *
 * Opening is idempotent, and re-running it never resets used days — they are
 * what has been taken. So it is safe to press twice, which is the right
 * property for a button somebody will press when they are not sure whether
 * they pressed it in January.
 */
export default function LeaveBalances({ employeeId, balances, year, canOpen }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function open() {
    if (pending) return;
    setPending(true);

    try {
      const opened = await api.post("/admin/leave-balances/open", { employeeId, year });
      toast.success(
        opened?.length
          ? `${year} opened — ${opened.length} ${opened.length === 1 ? "balance" : "balances"}.`
          : `${year} opened.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(error?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  const number = (value) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-4">
      {balances.length ? (
        <ul className="flex flex-col gap-3">
          {balances.map((balance) => (
            <li
              key={balance.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-container-lowest p-5"
            >
              <div className="min-w-0">
                <p className="text-label-bold text-on-surface">{balance.leaveType.name}</p>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {number(balance.entitledDays)} entitled
                  {Number(balance.carriedDays) ? ` · ${number(balance.carriedDays)} carried over` : ""} ·{" "}
                  {number(balance.usedDays)} taken
                  {balance.leaveType.isPaid ? "" : " · unpaid"}
                </p>
              </div>

              {/* The one number anybody opens this for. */}
              <p className="text-right">
                <span className="block font-display text-headline-md tabular-nums text-on-surface">
                  {number(balance.availableDays)}
                </span>
                <span className="block text-label-bold font-normal text-on-surface-variant">days left</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          No balances for {year}. Until the year is opened there is nothing to count against, and a request cannot be
          measured as within somebody&apos;s entitlement or beyond it.
        </p>
      )}

      {canOpen ? (
        <button
          type="button"
          onClick={open}
          disabled={pending}
          className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Opening…" : balances.length ? `Re-open ${year}` : `Open ${year}`}
        </button>
      ) : null}
    </div>
  );
}
