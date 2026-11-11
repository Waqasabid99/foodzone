"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { clockValue, dayKey, dayLabel, employeeName, isWeekend } from "@/lib/hr";

/**
 * The rota: who works which shift on which day.
 *
 * A grid rather than a list, because the question a manager is actually asking
 * is "is Friday night covered?", and that is a column, not a filter.
 *
 * Two behaviours worth knowing:
 *
 *   * **A day off is a roster row, not an empty cell.** An empty cell means
 *     nobody decided; a day marked off means they were not expected. Derivation
 *     reads the difference, and without it somebody's day off is recorded as an
 *     absence.
 *   * **Rostering is iterative.** A second assignment for the same day is a
 *     correction, not a duplicate, so every cell simply overwrites.
 */
export default function RosterGrid({ employees, shifts, assignments, days, canManage }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Keyed on employee and day so a cell is one lookup rather than a scan.
  const byCell = useMemo(() => {
    const map = new Map();
    for (const row of assignments) map.set(`${row.employeeId}:${dayKey(row.workDate)}`, row);
    return map;
  }, [assignments]);

  const shiftsFor = (branchId) => shifts.filter((shift) => shift.branchId === branchId);

  async function setCell(employee, day, value) {
    if (!canManage || busy) return;
    const key = `${employee.id}:${day}`;
    setBusy(key);
    setError(null);

    try {
      if (value === "") {
        await api.delete("/admin/roster/assignment", { body: { employeeId: employee.id, workDate: day } });
      } else if (value === "OFF") {
        const existing = byCell.get(key);
        // A day off still names a shift, because the column is required and the
        // flag is what derivation reads. Whatever they would otherwise work.
        const fallback = existing?.shiftId ?? shiftsFor(employee.branchId)[0]?.id;
        if (!fallback) throw new Error("This branch has no shift to mark the day against yet.");
        await api.post("/admin/roster", { employeeId: employee.id, shiftId: fallback, from: day, to: day, isWeeklyOff: true });
      } else {
        await api.post("/admin/roster", { employeeId: employee.id, shiftId: value, from: day, to: day, isWeeklyOff: false });
      }
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That day could not be changed.");
    } finally {
      setBusy(null);
    }
  }

  if (!employees.length) {
    return <p className="text-body-md text-on-surface-variant">Nobody to roster here yet.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">{error}</p>
      ) : null}

      {/* Scrolls inside its own box so a seven-day week never pushes the page
          sideways on a phone. `min-w-0` is what makes that work: a flex child
          defaults to min-width:auto, which lets the table shove the scroll
          container wider than the screen instead of scrolling inside it. */}
      <div className="w-full min-w-0 overflow-x-auto rounded-card bg-surface-container-lowest">
        <table className="w-full min-w-3xl border-collapse text-body-md">
          <caption className="sr-only">The rota, one row per person and one column per day</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface-container-lowest px-4 py-3 text-left text-label-bold text-on-surface">
                Who
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={`px-3 py-3 text-left text-label-bold ${isWeekend(day) ? "text-on-surface" : "text-on-surface-variant"}`}
                >
                  {dayLabel(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => {
              const options = shiftsFor(employee.branchId);
              return (
                <tr key={employee.id} className="border-t border-surface-container-high">
                  <th scope="row" className="sticky left-0 z-10 bg-surface-container-lowest px-4 py-2 text-left font-normal">
                    <span className="block text-label-bold text-on-surface">{employeeName(employee)}</span>
                    <span className="block text-on-surface-variant">{employee.employeeCode}</span>
                  </th>

                  {days.map((day) => {
                    const cell = byCell.get(`${employee.id}:${day}`);
                    const value = cell ? (cell.isWeeklyOff ? "OFF" : cell.shiftId) : "";
                    const cellBusy = busy === `${employee.id}:${day}`;

                    if (!canManage) {
                      return (
                        <td key={day} className="px-3 py-2 text-on-surface-variant">
                          {cell ? (cell.isWeeklyOff ? "Off" : (cell.shift?.name ?? "Rostered")) : "—"}
                        </td>
                      );
                    }

                    return (
                      <td key={day} className="px-2 py-2">
                        <label className="sr-only" htmlFor={`cell-${employee.id}-${day}`}>
                          {employeeName(employee)} on {dayLabel(day)}
                        </label>
                        <select
                          id={`cell-${employee.id}-${day}`}
                          value={value}
                          disabled={cellBusy || !options.length}
                          onChange={(event) => setCell(employee, day, event.target.value)}
                          className={`w-full min-w-28 rounded-field border border-outline px-2 py-2 text-body-md focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:opacity-60 ${
                            value === "OFF"
                              ? "bg-surface-container-high text-on-surface-variant"
                              : value
                                ? "bg-secondary-container text-on-secondary-container"
                                : "bg-surface-container-low text-on-surface-variant"
                          }`}
                        >
                          <option value="">Not decided</option>
                          <option value="OFF">Day off</option>
                          {options.map((shift) => (
                            <option key={shift.id} value={shift.id}>
                              {shift.name} · {clockValue(shift.startMinute)}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-body-md text-on-surface-variant">
        &ldquo;Not decided&rdquo; and &ldquo;Day off&rdquo; are different: a day nobody rostered is unknown, a day marked
        off is a day they were not expected — and only the second stops them being marked absent.
      </p>
    </div>
  );
}
