"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { employeeName } from "@/lib/hr";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";

/**
 * Departments: kitchen, front of house, delivery, admin.
 *
 * Company-wide rather than per branch, because they describe the kind of work
 * somebody does and that does not change when they move outlet. A department
 * cannot be retired while active staff are still in it — the alternative is
 * employees filed under something that no longer exists.
 */
export default function DepartmentsEditor({ departments, employees, canManage }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", code: "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [rowError, setRowError] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function create(event) {
    event.preventDefault();
    if (pending) return;

    const local = {};
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    if (name.length < 1) local.name = "Name the department.";
    else if (name.length > 120) local.name = "Keep it under 120 characters.";
    if (code.length < 1) local.code = "A short code, such as KIT.";
    else if (code.length > 20) local.code = "Keep it under 20 characters.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setPending(true);
    setFormError(null);
    try {
      await api.post("/admin/departments", { name, code });
      toast.success(`${name} added.`);
      setForm({ name: "", code: "" });
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  async function patch(department, body, message) {
    if (editingId) return;
    setEditingId(department.id);
    setRowError(null);
    try {
      await api.patch(`/admin/departments/${department.id}`, body);
      toast.success(message);
      router.refresh();
    } catch (failure) {
      setRowError({ id: department.id, message: failure?.message ?? "That did not work." });
    } finally {
      setEditingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {departments.length ? (
        <ul className="flex flex-col gap-3">
          {departments.map((department) => (
            <li key={department.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-label-bold text-on-surface">{department.name}</span>
                    <Chip>{department.code}</Chip>
                    {department.isActive ? null : <Chip tone="bg-surface-container-high text-on-surface-variant">Retired</Chip>}
                  </p>
                  <p className="mt-1 text-body-md text-on-surface-variant">
                    {department.employeeCount === 0
                      ? "Nobody in it yet"
                      : `${department.employeeCount} ${department.employeeCount === 1 ? "person" : "people"}`}
                    {department.head ? ` · headed by ${employeeName(department.head)}` : ""}
                  </p>
                </div>

                {canManage ? (
                  <button
                    type="button"
                    onClick={() =>
                      patch(
                        department,
                        { isActive: !department.isActive },
                        department.isActive ? `${department.name} retired.` : `${department.name} is active again.`,
                      )
                    }
                    disabled={editingId === department.id}
                    className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {editingId === department.id ? "Working…" : department.isActive ? "Retire" : "Bring back"}
                  </button>
                ) : null}
              </div>

              {canManage ? (
                <SelectField
                  id={`dept-head-${department.id}`}
                  label="Head of department"
                  value={department.headEmployeeId ?? ""}
                  onChange={(event) =>
                    patch(department, { headEmployeeId: event.target.value || null }, `${department.name} updated.`)
                  }
                  options={[
                    { value: "", label: "Nobody" },
                    ...employees.map((employee) => ({ value: employee.id, label: `${employeeName(employee)} — ${employee.employeeCode}` })),
                  ]}
                />
              ) : null}

              {rowError?.id === department.id ? (
                <p role="alert" className="rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">
                  {rowError.message}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          No departments yet. They are optional — an employee can sit in none — but they make rosters and reports far
          easier to read.
        </p>
      )}

      {canManage ? (
        <form onSubmit={create} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <p className="text-label-bold text-on-surface">Add a department</p>
          <FormAlert>{formError}</FormAlert>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="dept-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} placeholder="Kitchen" autoComplete="off" />
            <Field id="dept-code" label="Code" value={form.code} onChange={(event) => set({ code: event.target.value.toUpperCase() })} error={errors.code} placeholder="KIT" hint="Short, and used in reports." autoComplete="off" />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Adding…" : "Add department"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
