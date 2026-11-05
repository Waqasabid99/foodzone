"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import PermissionMatrix from "@/components/dashboard/admin/PermissionMatrix";
import FormAlert from "@/components/ui/FormAlert";

/**
 * What a role may do.
 *
 * The whole set is sent on save, so a box unticked here is a permission
 * revoked from everyone holding the role — which is why what is about to
 * change is counted before the button rather than explained after it.
 */
export default function RolePermissions({ role, modules, granted, holds, canEdit, isSuperAdmin }) {
  const router = useRouter();
  const initial = useMemo(() => granted.map((permission) => permission.key).sort(), [granted]);
  const [selected, setSelected] = useState(initial);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const added = selected.filter((key) => !initial.includes(key));
  const removed = initial.filter((key) => !selected.includes(key));
  const dirty = added.length + removed.length > 0;

  async function save() {
    if (pending || !dirty) return;
    if (removed.length && !window.confirm(`${removed.length} ${removed.length === 1 ? "permission" : "permissions"} will be taken away from everyone with the ${role.name} role. Save?`)) return;
    setPending(true);
    setError(null);
    try {
      await api.put(`/admin/roles/${role.id}/permissions`, { permissionKeys: selected });
      toast.success("Permissions saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "They could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {dirty ? (
        <p className="text-body-md text-on-surface-variant" aria-live="polite">
          {added.length} to add, {removed.length} to remove.
        </p>
      ) : null}

      <PermissionMatrix modules={modules} selected={selected} onChange={setSelected} canEdit={canEdit} holds={holds} isSuperAdmin={isSuperAdmin} />

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save permissions"}
          </button>
          {dirty ? (
            <button type="button" onClick={() => setSelected(initial)} className="text-label-bold text-on-surface-variant hover:underline">
              Undo changes
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
