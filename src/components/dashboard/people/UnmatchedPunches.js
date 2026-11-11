"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { employeeName, timeLabel } from "@/lib/hr";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Punches that arrived for a biometric id nobody is enrolled to.
 *
 * Every row here is somebody whose attendance is being recorded and not
 * counted — usually because they were added to the terminal before HR created
 * their record. The punches were kept rather than dropped precisely so this
 * screen can exist: claiming an id links every punch it ever sent, so the
 * history is recovered rather than lost.
 *
 * Claiming also enrols the id on the employee, so tomorrow's punches match on
 * arrival instead of landing back in this queue.
 */
export default function UnmatchedPunches({ groups, employees, canClaim }) {
  const router = useRouter();
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function claim(group) {
    const employeeId = choice[group.biometricId];
    if (!employeeId || busy) return;

    const who = employees.find((employee) => employee.id === employeeId);
    if (
      !window.confirm(
        `Give ${group.count} punch${group.count === 1 ? "" : "es"} from id ${group.biometricId} to ${employeeName(who)}, and enrol that id to them?`,
      )
    ) {
      return;
    }

    setBusy(group.biometricId);
    setError(null);
    try {
      const result = await api.post("/admin/attendance-punches/claim", { biometricId: group.biometricId, employeeId });
      toast.success(`${result.claimed} punches now count for ${employeeName(who)}.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "Those punches could not be claimed.");
    } finally {
      setBusy(null);
    }
  }

  if (!groups.length) {
    return (
      <p className="text-body-md text-on-surface-variant">
        Nothing waiting. Every punch that has arrived belongs to somebody.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <li key={group.biometricId ?? "none"} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
            <div>
              <p className="font-mono text-label-bold text-on-surface">{group.biometricId ?? "No id sent"}</p>
              <p className="mt-1 text-body-md text-on-surface-variant">
                {group.count} punch{group.count === 1 ? "" : "es"} · first {timeLabel(group.firstSeen)} on{" "}
                {new Date(group.firstSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, last{" "}
                {timeLabel(group.lastSeen)} on{" "}
                {new Date(group.lastSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </p>
            </div>

            {group.biometricId && canClaim ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-56 flex-1 flex-col gap-1.5">
                  <label htmlFor={`claim-${group.biometricId}`} className="text-label-bold text-on-surface">
                    Whose are they?
                  </label>
                  <select
                    id={`claim-${group.biometricId}`}
                    value={choice[group.biometricId] ?? ""}
                    onChange={(event) => setChoice({ ...choice, [group.biometricId]: event.target.value })}
                    className="w-full rounded-field border border-outline bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                  >
                    <option value="">Choose someone</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employeeName(employee)} — {employee.employeeCode}
                        {employee.biometricId ? ` (already ${employee.biometricId})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => claim(group)}
                  disabled={busy === group.biometricId || !choice[group.biometricId]}
                  className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {busy === group.biometricId ? "Claiming…" : "Claim them"}
                </button>
              </div>
            ) : group.biometricId ? null : (
              <p className="text-body-md text-on-surface-variant">
                The terminal sent no id with these, so there is nothing to match them on. They stay as a record that
                something punched.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="text-body-md text-on-surface-variant">
        Claiming enrols the id too, so their next punch matches on arrival. The days those punches fall on are rebuilt
        the next time attendance is derived.
      </p>
    </div>
  );
}
