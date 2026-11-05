"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { CATEGORY_FIELDS, categoryFormValues, categoryPayload } from "@/lib/category-form";
import { parentOptions } from "@/lib/category-tree";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import ImageField from "@/components/ui/ImageField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

/**
 * Create or edit a category.
 *
 * `categories` is the whole flat list, used to offer only the parents the
 * server would accept. `canUpload` and `canDelete` come from the page, so a
 * control the viewer cannot use is never drawn.
 */
export default function CategoryForm({
  category = null,
  categories,
  defaultParentId = "",
  canUpload = false,
  canDelete = false,
}) {
  const router = useRouter();
  const editing = Boolean(category);

  const [form, setForm] = useState(() => categoryFormValues(category, { parentId: defaultParentId }));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const parents = useMemo(
    () => [{ value: "", label: "None — a top-level category" }, ...parentOptions(categories, category?.id ?? null)],
    [categories, category],
  );

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    if (!form.name.trim()) {
      setFieldErrors({ name: "Give the category a name" });
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const payload = categoryPayload(form, { original: category });
      if (editing) await api.patch(`/admin/categories/${category.id}`, payload);
      else await api.post("/admin/categories", payload);

      toast.success(editing ? "Category updated." : `${payload.name} created.`);
      router.push("/dashboard/categories");
      router.refresh();
    } catch (failure) {
      const { fieldErrors: fields, formError: message } = toFormErrors(failure, { fields: CATEGORY_FIELDS });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    // A native confirm: it is modal, keyboard-operable and announced, and a
    // delete is refused server-side while anything depends on the category, so
    // the confirmation only has to guard against a slip.
    if (!window.confirm(`Delete "${category.name}"? This cannot be undone.`)) return;

    setDeleting(true);
    setFormError(null);
    try {
      await api.delete(`/admin/categories/${category.id}`);
      toast.success("Category deleted.");
      router.push("/dashboard/categories");
      router.refresh();
    } catch (failure) {
      // The refusal names what is in the way — products, or sub-categories —
      // which is the actionable part, so it is shown as written.
      setFormError(failure?.message ?? "The category could not be deleted.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <FormAlert>{formError}</FormAlert>

        <section className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-5 sm:p-6">
          <Field
            id="category-name"
            label="Name"
            required
            autoFocus={!editing}
            placeholder="e.g. Burgers"
            value={form.name}
            onChange={update("name")}
            error={fieldErrors.name ?? null}
          />

          <SelectField
            id="category-parent"
            label="Inside"
            value={form.parentId}
            onChange={update("parentId")}
            options={parents}
            error={fieldErrors.parentId ?? null}
            hint="Nest a category to group it, e.g. Hot drinks inside Drinks. Up to four levels."
          />

          <TextAreaField
            id="category-description"
            label="Description"
            rows={3}
            placeholder="A line shown under the category heading on the menu"
            value={form.description}
            onChange={update("description")}
            error={fieldErrors.description ?? null}
          />

          {canUpload ? (
            <ImageField
              id="category-image"
              label="Image"
              ownerType="Category"
              value={form.imageUrl}
              onChange={(url) => setForm((current) => ({ ...current, imageUrl: url }))}
              error={fieldErrors.imageUrl ?? null}
              hint="Optional. Resized and compressed before it is uploaded."
            />
          ) : null}

          <Field
            id="category-slug"
            label="Web address"
            placeholder={editing ? undefined : "Made from the name if left blank"}
            value={form.slug}
            onChange={update("slug")}
            error={fieldErrors.slug ?? null}
            hint={
              editing
                ? "Part of the category's link on the website. Changing it breaks links people have saved."
                : "Part of the category's link on the website."
            }
          />

          <label
            htmlFor="category-active"
            className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4"
          >
            <input
              id="category-active"
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>
              <span className="block text-label-bold text-on-surface">Show on the menu</span>
              <span className="block text-body-md text-on-surface-variant">
                Turning this off hides the category and every product in it from the website&rsquo;s menu,
                search and product pages. A product already placed on a branch menu stays on that menu until it
                is removed there.
              </span>
            </span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <SubmitButton pending={pending} pendingLabel={editing ? "Saving…" : "Creating…"}>
              {editing ? "Save changes" : "Create category"}
            </SubmitButton>
          </div>
          <Link
            href="/dashboard/categories"
            className="rounded-field px-5 py-3.5 text-label-bold text-on-surface-variant hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Cancel
          </Link>
        </div>
      </form>

      {editing && canDelete ? (
        <section className="flex flex-col gap-3 rounded-card border border-outline-variant p-5 sm:p-6">
          <h2 className="font-display text-headline-md text-on-surface">Delete this category</h2>
          <p className="text-body-md text-on-surface-variant">
            Only an empty category can be deleted. If it still holds products or sub-categories, move them first
            — or simply hide it from the menu above.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex w-fit items-center gap-2 rounded-field border border-error px-4 py-2.5 text-label-bold text-error hover:bg-error-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {deleting ? "Deleting…" : "Delete category"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
