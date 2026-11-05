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
 * One-off exceptions on top of the roles: a single extra permission, or one
 * taken away.
 *
 * A refusal always wins over any role that grants the same thing, which is why
 * "not allowed" is the safe way to carve something back from an otherwise
 * correct role. Exceptions are per person and easy to forget, so each one
 * carries a reason and can be given an end date.
 */
export default function UserOverrides({ user, overrides, modules, branches, canAssign }) {
  const router = useRouter();
  const [permissionKey, setPermissionKey] = useState("");
  const [effect, setEffect] = useState("ALLOW");
  const [branchId, setBranchId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function add(event) {
    event.preventDefault();
    if (pending) return;
    if (!permissionKey) return setError("Choose what this exception is about.");
    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/users/${user.id}/permissions`, {
        permissionKey,
        effect,
        branchId: branchId || null,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
      toast.success(effect === "ALLOW" ? "Extra permission granted." : "Permission taken away.");
      setPermissionKey("");
      setReason("");
      setExpiresAt("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That exception could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function remove(override) {
    if (!window.confirm(`Remove this exception? ${user.name} goes back to whatever their roles allow.`)) return;
    try {
      await api.delete(`/admin/users/${user.id}/permissions/${override.id}`);
      toast.success("Exception removed.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be removed.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {overrides.length ? (
        <ul className="flex flex-col gap-2">
          {overrides.map((override) => (
            <li key={override.id} className="flex flex-wrap items-start justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
              <p className="min-w-0 text-body-md">
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone={override.effect === "DENY" ? "bg-error-container text-on-error-container" : "bg-success-container text-on-success-container"}>
                    {override.effect === "DENY" ? "Not allowed" : "Also allowed"}
                  </Chip>
                  <span className="text-label-bold text-on-surface">{override.permission.label ?? override.permission.key}</span>
                  {grantExpired(override) ? <Chip>No longer counts</Chip> : null}
                </span>
                <span className="mt-1 block text-on-surface-variant">
                  {override.branch ? `At ${override.branch.name}` : "Every branch"}
                  {override.expiresAt ? ` · until ${when(override.expiresAt)}` : ""}
                  {override.reason ? ` · “${override.reason}”` : ""}
                </span>
              </p>
              {canAssign ? (
                <button type="button" onClick={() => remove(override)} className="inline-flex items-center gap-1 rounded-field px-3 py-2 text-label-bold text-error hover:bg-surface-container">
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No exceptions — this person has exactly what their roles allow.</p>
      )}

      {canAssign ? (
        <form onSubmit={add} noValidate className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="override-permission" className="text-label-bold text-on-surface">Permission</label>
              <select
                id="override-permission"
                value={permissionKey}
                onChange={(event) => setPermissionKey(event.target.value)}
                className="w-full rounded-field border border-transparent bg-surface-container-lowest px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
              >
                <option value="">Choose a permission</option>
                {modules.map((module) => (
                  <optgroup key={module.module} label={module.label ?? module.module}>
                    {module.permissions.map((permission) => (
                      <option key={permission.key} value={permission.key}>{permission.label ?? permission.key}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <SelectField
              id="override-effect"
              label="Then"
              value={effect}
              onChange={(event) => setEffect(event.target.value)}
              options={[
                { value: "ALLOW", label: "Also allow it" },
                { value: "DENY", label: "Never allow it" },
              ]}
            />
            <SelectField
              id="override-branch"
              label="Where"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              options={[{ value: "", label: "Every branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field id="override-reason" label="Why" value={reason} onChange={(event) => setReason(event.target.value)} hint="So the next person to read this knows." />
            <Field id="override-expires" label="Until" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} hint="Optional." />
            <button type="submit" disabled={pending} className="h-12 rounded-field bg-surface-container-high px-5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {pending ? "Saving…" : "Add exception"}
            </button>
          </div>
          <p className="text-label-bold font-normal text-on-surface-variant">You can only grant what you hold yourself. Taking something away is always allowed.</p>
        </form>
      ) : null}
    </div>
  );
}
