"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { grantExpired } from "@/lib/people";
import SelectField from "@/components/ui/SelectField";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

const when = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The roles this person holds, and where.
 *
 * A grant may be given an end date — a supervisor covering a holiday — after
 * which it simply stops counting, which is safer than trusting somebody to
 * remember to take it away.
 */
export default function UserRoles({ user, assignments, roles, branches, canAssign }) {
  const router = useRouter();
  const [roleId, setRoleId] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const role = roles.find((row) => row.id === roleId) ?? null;
  const needsBranch = role?.scope === "BRANCH";

  async function add(event) {
    event.preventDefault();
    if (pending) return;
    if (!roleId) return setError("Choose a role to add.");
    if (needsBranch && !branchId) return setError("Branch roles apply at one outlet — choose which.");
    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/users/${user.id}/roles`, {
        roleId,
        branchId: needsBranch ? branchId : null,
        ...(expiresAt ? { expiresAt } : {}),
      });
      toast.success(`${role.name} granted.`);
      setRoleId("");
      setExpiresAt("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That role could not be granted.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(assignment) {
    if (!window.confirm(`Take ${assignment.role.name} away from ${user.name}? They lose everything it allows, immediately.`)) return;
    try {
      await api.delete(`/admin/users/${user.id}/roles/${assignment.id}`);
      toast.success(`${assignment.role.name} removed.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That role could not be removed.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {assignments.length ? (
        <ul className="flex flex-col gap-2">
          {assignments.map((assignment) => {
            const expired = grantExpired(assignment);
            return (
              <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                <p className="text-body-md">
                  <span className="text-label-bold text-on-surface">{assignment.role.name}</span>
                  <span className="text-on-surface-variant">
                    {assignment.branch ? ` at ${assignment.branch.name}` : assignment.role.scope === "GLOBAL" ? " — every branch" : " — no branch named"}
                    {assignment.expiresAt ? ` · ${expired ? "ended" : "until"} ${when(assignment.expiresAt)}` : ""}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  {expired ? <Chip>No longer counts</Chip> : null}
                  {canAssign ? (
                    <button type="button" onClick={() => revoke(assignment)} className="inline-flex items-center gap-1 rounded-field px-3 py-2 text-label-bold text-error hover:bg-surface-container">
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No role yet. This account can sign in but do nothing.</p>
      )}

      {canAssign ? (
        <form onSubmit={add} noValidate className="grid gap-3 rounded-field bg-surface-container-low p-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
          <SelectField
            id="grant-role"
            label="Add a role"
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            options={[{ value: "", label: "Choose a role" }, ...roles.map((row) => ({ value: row.id, label: row.name }))]}
          />
          <SelectField
            id="grant-branch"
            label="At"
            value={needsBranch ? branchId : ""}
            onChange={(event) => setBranchId(event.target.value)}
            disabled={!needsBranch}
            options={
              needsBranch
                ? [{ value: "", label: "Choose a branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]
                : [{ value: "", label: role ? "Every branch" : "—" }]
            }
          />
          <Field id="grant-expires" label="Until" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} hint="Optional." />
          <button type="submit" disabled={pending} className="h-12 rounded-field bg-surface-container-high px-5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {pending ? "Granting…" : "Grant"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
