"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { FolderOpen, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { RowButton } from "@/components/dashboard/menus/controls";

/**
 * Groups for the store room — dry goods, dairy, packaging.
 *
 * Separate from the menu's categories on purpose: a customer browses
 * "Burgers", a store keeper counts "Frozen". Deleting one only unfiles its
 * items; nothing about their stock changes.
 */
export default function InventoryCategoriesEditor({ categories, canManage }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const items = (count) => `${count} ${count === 1 ? "item" : "items"}`;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <FormAlert>{message}</FormAlert>

      {categories.length ? (
        <ul className="flex flex-col gap-2">
          {categories.map((category) =>
            editing === category.id ? (
              <li key={category.id}>
                <CategoryForm category={category} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={category.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${category.isActive ? "" : "opacity-75"}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                    {category.name}
                    {category.code ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-on-surface-variant">{category.code}</span> : null}
                    {!category.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {category.itemCount ? (
                      <Link href={`/dashboard/inventory-items?category=${category.id}`} className="text-primary hover:underline">{items(category.itemCount)}</Link>
                    ) : (
                      "No items yet"
                    )}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-1">
                    <RowButton disabled={busy} onClick={() => setEditing(category.id)}>Edit</RowButton>
                    <RowButton
                      disabled={busy}
                      onClick={() => run(() => api.patch(`/admin/inventory-categories/${category.id}`, { isActive: !category.isActive }), category.isActive ? `${category.name} switched off.` : `${category.name} switched on.`)}
                    >
                      {category.isActive ? "Switch off" : "Switch on"}
                    </RowButton>
                    <RowButton
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        const detail = category.itemCount ? ` Its ${items(category.itemCount)} will be left without a category; their stock does not change.` : "";
                        if (!window.confirm(`Delete ${category.name}?${detail}`)) return;
                        run(() => api.delete(`/admin/inventory-categories/${category.id}`), `${category.name} deleted.`);
                      }}
                    >
                      Delete
                    </RowButton>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <FolderOpen aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">No categories yet</p>
          <p className="max-w-md text-body-md text-on-surface-variant">Optional, but they make a long item list and a partial stock count much easier — “count all the dairy”.</p>
        </div>
      )}

      {canManage ? (
        editing === "new" ? (
          <CategoryForm onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a category
          </button>
        )
      ) : null}
    </section>
  );
}

function CategoryForm({ category = null, onDone }) {
  const router = useRouter();
  const creating = !category;
  const [form, setForm] = useState({ name: category?.name ?? "", code: category?.code ?? "" });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const prefix = category?.id ?? "new";

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();
    if (!name) return setErrors({ name: "Enter a name, e.g. Dairy." });
    if (code.length > 20) return setErrors({ code: "Keep it to 20 characters." });
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const body = { name, code: code || null };
      if (creating) await api.post("/admin/inventory-categories", body);
      else await api.patch(`/admin/inventory-categories/${category.id}`, body);
      toast.success(creating ? `${name} added.` : `${name} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name", "code"], conflictField: "name" });
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New category" : `Edit ${category.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`inv-category-name-${prefix}`} label="Name" autoFocus placeholder="e.g. Dairy" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} error={errors.name} />
        <Field id={`inv-category-code-${prefix}`} label="Code" placeholder="Optional" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} error={errors.code} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add category" : "Save category"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
      </div>
    </form>
  );
}
