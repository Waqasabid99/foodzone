"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import {
  DIETARY_TAGS,
  PRODUCT_FIELDS,
  SPICE_LEVELS,
  menusForBranch,
  productFormValues,
  productPayload,
} from "@/lib/product-form";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import ImageField from "@/components/ui/ImageField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

/**
 * A product's own fields.
 *
 * On create it also takes the price — one price, or a list of sizes — because a
 * product cannot exist without a sellable variant. On edit, prices live in the
 * sizes editor instead: each size is its own record with its own SKU and order
 * history, and folding them into this form would turn "rename the burger" into
 * a save that also rewrites every price.
 *
 * `options` carries the category, station and tax group choices, loaded by the
 * page. `canUpload` hides the image picker from someone who may not upload.
 */
export default function ProductDetailsForm({ product = null, options, currency, canUpload = false, readOnly = false, kind = "product" }) {
  const router = useRouter();
  const editing = Boolean(product);
  const combo = kind === "combo";
  const base = combo ? "/dashboard/combos" : "/dashboard/products";

  const [form, setForm] = useState(() => productFormValues(product));
  /*
   * Menu placement is kept out of `form` on purpose: `productPayload` turns
   * that object into the product's own body, and a field that is not the
   * product's would have to be stripped back out at every call site.
   */
  const [menuIds, setMenuIds] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const update = (key) => (event) => set(key, event.target.value);
  const error = (key) => fieldErrors[key] ?? null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || readOnly) return;

    // A combo has one price; its choices add to it.
    const { body, errors } = productPayload(combo ? { ...form, pricing: "single" } : form, { original: product });
    if (combo && !editing) body.type = "COMBO";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError("Some fields need attention.");
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      if (editing) {
        await api.patch(`/admin/products/${product.id}`, body);
        toast.success("Product saved.");
        setPending(false);
        router.refresh();
      } else {
        const created = await api.post("/admin/products", body);

        /*
         * Placement happens after the product exists, and one failure does not
         * undo it. The product is saved by this point: throwing here would
         * show a red error over work that succeeded, and whoever saw it would
         * reasonably fill the form in again. So each menu is reported on its
         * own and the person is told exactly which ones did not take.
         */
        const refused = [];
        for (const menu of chosenMenus) {
          try {
            await api.post(`/admin/menus/${menu.value}/items`, { productId: created.id });
          } catch (failure) {
            refused.push(`${menu.branchName} — ${menu.label}: ${failure?.message ?? "could not be added"}`);
          }
        }

        const placed = chosenMenus.length - refused.length;
        toast.success(
          placed
            ? `${created.name} created and added to ${placed} ${placed === 1 ? "menu" : "menus"}.`
            : `${created.name} created as a draft.`,
        );
        for (const problem of refused) toast.error(problem);

        router.push(`${base}/${created.id}`);
        router.refresh();
      }
    } catch (failure) {
      const { fieldErrors: fields, formError: message } = toFormErrors(failure, { fields: PRODUCT_FIELDS });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  const offeredMenus = menusForBranch(options.menus, form.branchId);
  const chosenMenus = offeredMenus.filter((menu) => menuIds.includes(menu.value));

  const sizes = form.sizes;
  const setSize = (key, patch) =>
    set(
      "sizes",
      sizes.map((size) => (size.key === key ? { ...size, ...patch } : size)),
    );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FormAlert>{formError}</FormAlert>

      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        <Section title="About the product">
          <Field
            id="product-name"
            label="Name"
            required
            autoFocus={!editing}
            placeholder="e.g. Classic Smash Burger"
            value={form.name}
            onChange={update("name")}
            error={error("name")}
          />
          <SelectField
            id="product-category"
            label="Category"
            value={form.categoryId}
            onChange={update("categoryId")}
            error={error("categoryId")}
            options={[{ value: "", label: "Choose a category" }, ...options.categories]}
          />
          {/*
            Only a chain sees this. With one outlet there is one answer, so
            the field is left out entirely rather than shown pre-filled — a
            question with a single possible answer is noise on every product
            anybody ever creates.
          */}
          {options.branches?.length ? (
            <SelectField
              id="product-branch"
              label="Sold at"
              value={form.branchId}
              onChange={update("branchId")}
              error={error("branchId")}
              options={[
                ...(options.canWriteChainWide ? [{ value: "", label: "Every branch" }] : []),
                ...options.branches,
              ]}
              hint={
                form.branchId
                  ? "Only this outlet sells it, and only its managers can see or price it."
                  : "On every branch's catalogue, including any opened later."
              }
            />
          ) : null}
          <Field
            id="product-short"
            label="Short description"
            maxLength={300}
            placeholder="One line for the menu card"
            value={form.shortDescription}
            onChange={update("shortDescription")}
            error={error("shortDescription")}
          />
          <TextAreaField
            id="product-description"
            label="Full description"
            rows={4}
            placeholder="Shown on the product's own page"
            value={form.description}
            onChange={update("description")}
            error={error("description")}
          />
          {canUpload ? (
            <ImageField
              id="product-image"
              label="Main photo"
              ownerType="Product"
              value={form.imageUrl}
              onChange={(url) => set("imageUrl", url)}
              error={error("imageUrl")}
              hint="Shown on menu cards. Add more photos in the gallery once the product is created."
            />
          ) : null}
        </Section>

        {!editing ? (
          <Section
            title={combo ? "Combo price" : "Price"}
            description={
              combo
                ? `In ${currency}. What the combo costs with every slot at its included choice — upgrades add to it.`
                : `In ${currency}. You can add or change sizes later.`
            }
          >
            {combo ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-label-bold text-on-surface">How is it priced?</legend>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "single", label: "One price" },
                    { value: "sizes", label: "Different sizes" },
                  ].map((choice) => (
                    <label
                      key={choice.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-field px-4 py-2.5 text-label-bold ${
                        form.pricing === choice.value
                          ? "bg-secondary-container text-on-secondary-container"
                          : "bg-surface-container-low text-on-surface"
                      }`}
                    >
                      <input
                        type="radio"
                        name="pricing"
                        value={choice.value}
                        checked={form.pricing === choice.value}
                        onChange={() => set("pricing", choice.value)}
                        className="accent-primary"
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {combo || form.pricing === "single" ? (
              <Field
                id="product-price"
                label={`Price (${currency})`}
                inputMode="decimal"
                placeholder="e.g. 850"
                value={form.price}
                onChange={update("price")}
                error={error("price")}
              />
            ) : (
              <fieldset className="flex flex-col gap-3" aria-describedby={error("variants") ? "sizes-error" : undefined}>
                <legend className="sr-only">Sizes</legend>
                {sizes.map((size, index) => (
                  <div key={size.key} className="flex flex-wrap items-end gap-3 rounded-field bg-surface-container-low p-3">
                    <div className="min-w-36 flex-1">
                      <Field
                        id={`size-name-${size.key}`}
                        label={`Size ${index + 1} name`}
                        value={size.name}
                        onChange={(event) => setSize(size.key, { name: event.target.value })}
                      />
                    </div>
                    <div className="min-w-28 flex-1">
                      <Field
                        id={`size-price-${size.key}`}
                        label={`Price (${currency})`}
                        inputMode="decimal"
                        value={size.price}
                        onChange={(event) => setSize(size.key, { price: event.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 pb-3 text-body-md text-on-surface">
                      <input
                        type="radio"
                        name="default-size"
                        checked={form.defaultSize === size.key}
                        onChange={() => set("defaultSize", size.key)}
                        className="accent-primary"
                      />
                      Default
                    </label>
                    {sizes.length > 2 ? (
                      <button
                        type="button"
                        aria-label={`Remove size ${index + 1}`}
                        onClick={() => {
                          const rest = sizes.filter((row) => row.key !== size.key);
                          setForm((current) => ({
                            ...current,
                            sizes: rest,
                            defaultSize: current.defaultSize === size.key ? rest[0].key : current.defaultSize,
                          }));
                        }}
                        className="mb-1.5 inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => set("sizes", [...sizes, { key: `s${Date.now()}`, name: "", price: "" }])}
                  className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add a size
                </button>
                {error("variants") ? (
                  <p id="sizes-error" role="alert" className="text-label-bold text-error">
                    {error("variants")}
                  </p>
                ) : null}
              </fieldset>
            )}
          </Section>
        ) : null}

        {/*
          Create only. On an existing product this is the Menus page's job,
          where a price override and a section can be set at the same time;
          here the question is just "where does this sell", and sending
          somebody to another screen to answer it is how a product ends up
          saved and sold nowhere.
        */}
        {!editing && options.menus?.length ? (
          <Section
            title="Put it on a menu"
            description="A product is only orderable at a branch whose menu includes it. Every size you priced above is added."
          >
            {offeredMenus.length ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Menus to add this to</legend>
                {offeredMenus.map((menu) => {
                  const checked = menuIds.includes(menu.value);
                  return (
                    <label
                      key={menu.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-field px-4 py-3 text-body-md ${
                        checked ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setMenuIds((current) =>
                            checked ? current.filter((id) => id !== menu.value) : [...current, menu.value],
                          )
                        }
                        className="accent-primary"
                      />
                      <span>
                        <span className="text-label-bold">{menu.branchName}</span> — {menu.label}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <p className="text-body-md text-on-surface-variant">
                That outlet has no menus yet.{" "}
                <Link href="/dashboard/menus" className="text-primary hover:underline">
                  Make one
                </Link>{" "}
                and the product can be added to it.
              </p>
            )}
          </Section>
        ) : null}

        <Section title="Dietary information" description="Shown to customers, so only state what is certain.">
          <fieldset>
            <legend className="mb-2 text-label-bold text-on-surface">Suitable for</legend>
            <div className="flex flex-wrap gap-2">
              {DIETARY_TAGS.map((tag) => {
                const checked = form.dietary.includes(tag.value);
                return (
                  <label
                    key={tag.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-body-md ${
                      checked ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low text-on-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        set(
                          "dietary",
                          checked ? form.dietary.filter((value) => value !== tag.value) : [...form.dietary, tag.value],
                        )
                      }
                      className="accent-primary"
                    />
                    {tag.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="product-spice"
              label="Spice level"
              value={form.spiceLevel}
              onChange={update("spiceLevel")}
              options={SPICE_LEVELS}
              error={error("spiceLevel")}
            />
            <Field
              id="product-calories"
              label="Calories (kcal)"
              inputMode="numeric"
              value={form.calories}
              onChange={update("calories")}
              error={error("calories")}
            />
          </div>

          <Field
            id="product-allergens"
            label="Allergens"
            placeholder="e.g. gluten, dairy, sesame"
            value={form.allergens}
            onChange={update("allergens")}
            error={error("allergens")}
            hint="Separate with commas."
          />
        </Section>

        <Section title="Kitchen" description="Where the ticket goes and how it is taxed.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="product-station"
              label="Prepared at"
              value={form.stationId}
              onChange={update("stationId")}
              error={error("stationId")}
              options={[{ value: "", label: "No particular station" }, ...options.stations]}
              hint={options.stations.length ? null : "No kitchen stations have been set up yet."}
            />
            <Field
              id="product-prep"
              label="Preparation time (minutes)"
              inputMode="numeric"
              value={form.prepTimeMinutes}
              onChange={update("prepTimeMinutes")}
              error={error("prepTimeMinutes")}
              hint="Used to estimate when an order will be ready."
            />
          </div>
          <SelectField
            id="product-tax"
            label="Tax group"
            value={form.taxGroupId}
            onChange={update("taxGroupId")}
            error={error("taxGroupId")}
            options={[{ value: "", label: "No tax group" }, ...options.taxGroups]}
            hint={options.taxGroups.length ? null : "No tax groups have been set up yet."}
          />
        </Section>

        <Section title="On the website">
          <label className="flex cursor-pointer items-start gap-3 rounded-field bg-surface-container-low p-4">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(event) => set("isFeatured", event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>
              <span className="block text-label-bold text-on-surface">Feature on the home page</span>
              <span className="block text-body-md text-on-surface-variant">
                Featured products appear in the home page&rsquo;s highlights once they are published.
              </span>
            </span>
          </label>
          <Field
            id="product-slug"
            label="Web address"
            placeholder={editing ? undefined : "Made from the name if left blank"}
            value={form.slug}
            onChange={update("slug")}
            error={error("slug")}
            hint={editing ? "Changing it breaks links people have saved or shared." : null}
          />
        </Section>
      </fieldset>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <SubmitButton pending={pending} pendingLabel={editing ? "Saving…" : "Creating…"}>
              {editing ? "Save details" : "Create draft"}
            </SubmitButton>
          </div>
          {!editing ? (
            <Link
              href={base}
              className="rounded-field px-5 py-3.5 text-label-bold text-on-surface-variant hover:text-on-surface"
            >
              Cancel
            </Link>
          ) : null}
        </div>
      )}
    </form>
  );
}

export function Section({ title, description = null, children }) {
  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
        {description ? <p className="mt-1 text-body-md text-on-surface-variant">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
