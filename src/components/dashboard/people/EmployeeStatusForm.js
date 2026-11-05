"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { EMPLOYEE_STATES, EXIT_STATES, employeeName } from "@/lib/hr";
import SelectField from "@/components/ui/SelectField";
import Field from "@/components/ui/Field";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Where somebody stands: working, on leave, suspended, or gone.
 *
 * Leaving is a status, never a deletion. An employee who has been rostered,
 * punched or paid is the explanation for work done and money paid, and removing
 * the row orphans all of it.
 */
export default function EmployeeStatusForm({ employee }) {
  const router = useRouter();
  const [status, setStatus] = useState(employee.status);
  const [reason, setReason] = useState("");
  const [exitedAt, setExitedAt] = useState(employee.exitedAt ? String(employee.exitedAt).slice(0, 10) : today());
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const exiting = EXIT_STATES.includes(status);
  const unchanged = status === employee.status;
  const name = employeeName(employee);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || unchanged) return;

    if (exiting && !window.confirm(`Record ${name} as ${EMPLOYEE_STATES[status].label.toLowerCase()}? They stop being rostered from that date.`)) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.put(`/admin/employees/${employee.id}/status`, {
        status,
        reason: reason.trim() || null,
        ...(exiting ? { exitedAt } : {}),
      });
      toast.success(`${name} is now ${EMPLOYEE_STATES[status].label.toLowerCase()}.`);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id="status-value"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={Object.entries(EMPLOYEE_STATES).map(([value, state]) => ({ value, label: state.label }))}
        />
        {exiting ? (
          <Field id="status-exited" label="Last day" type="date" value={exitedAt} onChange={(event) => setExitedAt(event.target.value)} />
        ) : null}
      </div>

      <TextAreaField
        id="status-reason"
        label="Note"
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        hint={exiting ? "Why they left. Kept in the audit trail." : "Optional. Kept in the audit trail."}
      />

      <button
        type="submit"
        disabled={pending || unchanged}
        className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Saving…" : unchanged ? "No change" : "Record it"}
      </button>

      {exiting ? (
        <p className="text-body-md text-on-surface-variant">
          Everything they did — shifts worked, attendance, payslips — is kept. Only new rosters stop.
        </p>
      ) : null}
    </form>
  );
}
