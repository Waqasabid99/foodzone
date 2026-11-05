"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, Plus, Search, Star, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import {
  endOfLocalDay,
  formatZoned,
  groupMenuProducts,
  menuRowState,
  priceOverridePayload,
  productAvailability,
  productOrderAfterMove,
} from "@/lib/menu-schedule";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { IconButton, RowButton } from "@/components/dashboard/menus/controls";

const ROW_NOTES = {
  DRAFT: "Product unpublished — not shown",
  SIZE_OFF: "Size switched off on the product — not shown",
  DELETED: "Product deleted — not shown",
};

/**
 * What a menu sells, arranged the way customers read it.
 *
 * Stored as one row per size; shown as one card per product with its sizes
 * underneath, because that is how both a customer and a manager think about
 * "the pizza". Arranging (sections, order, recommended, removing) acts on the
 * whole product; price and sold-out can also be set per size.
 *
 * Each control is only drawn for someone allowed to use it — a shift lead who
 * may mark things sold out sees that button and nothing that reprices.
 */
export default function MenuItemsEditor({ menuId, items, sections, branch, currency, now, can, categories }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const at = useMemo(() => new Date(now), [now]);

  const groups = useMemo(() => groupMenuProducts(items, sections), [items, sections]);
  const term = filter.trim().toLowerCase();
  const visibleGroups = term
    ? groups.map((group) => ({ ...group, products: group.products.filter((entry) => entry.product.name.toLowerCase().includes(term)) })).filter((group) => group.products.length)
    : groups;
  const productCount = groups.reduce((sum, group) => sum + group.products.length, 0);
  const soldOut = groups.flatMap((group) => group.products).filter((entry) => productAvailability(entry.rows, at).key === "SOLD_OUT").length;

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
      return true;
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (productId, by) => {
    const order = productOrderAfterMove(groups, productId, by);
    if (order) run(() => api.post(`/admin/menus/${menuId}/items/reorder`, { productIds: order }));
  };

  const context = { menuId, branch, currency, at, can, busy, run, sections };

  return (
    <Section
      title="Products"
      description={`${productCount} ${productCount === 1 ? "product" : "products"}${soldOut ? ` · ${soldOut} sold out` : ""}. Prices in ${currency}; a blank menu price uses the product's own.`}
    >
      <div className="flex flex-wrap items-end gap-3">
        {productCount > 5 ? (
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor="menu-product-filter" className="text-label-bold text-on-surface">Find on this menu</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
              <input
                id="menu-product-filter"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Product name"
                className="w-full rounded-field border border-transparent bg-surface-container-low py-2.5 pl-9 pr-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
              />
            </div>
          </div>
        ) : null}
        {can.add && !adding ? (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-field bg-secondary-container px-4 py-2.5 text-label-bold text-on-secondary-container hover:shadow-e1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Plus aria-hidden="true" className="size-4" />
            Add products
          </button>
        ) : null}
      </div>

      {adding ? <AddProducts menuId={menuId} items={items} sections={sections} categories={categories} currency={currency} onClose={() => setAdding(false)} /> : null}

      <FormAlert>{message}</FormAlert>

      {term && !visibleGroups.length ? <p className="text-body-md text-on-surface-variant">Nothing on this menu matches “{filter.trim()}”.</p> : null}
      {!productCount ? (
        <p className="text-body-md text-on-surface-variant">Nothing on this menu yet.{can.add ? " Add products to start." : ""}</p>
      ) : null}

      {visibleGroups.map((group) => (
        <div key={group.section?.id ?? "none"} className="flex flex-col gap-2">
          <h3 className="flex flex-wrap items-baseline gap-2 text-label-bold uppercase tracking-wide text-on-surface-variant">
            {group.section ? group.section.name : "No section"}
            {group.section && !group.section.isActive ? <span className="normal-case tracking-normal">· switched off, hidden from customers</span> : null}
            {!group.section ? <span className="font-normal normal-case tracking-normal">· customers see these under “More”</span> : null}
          </h3>
          {group.products.length ? (
            <ul className="flex flex-col gap-2">
              {group.products.map((entry, index) => (
                <ProductCard
                  key={entry.productId}
                  entry={entry}
                  context={context}
                  canMoveUp={!term && index > 0}
                  canMoveDown={!term && index < group.products.length - 1}
                  onMove={(by) => move(entry.productId, by)}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">Empty. Move products here from their own row.</p>
          )}
        </div>
      ))}
    </Section>
  );
}

function ProductCard({ entry, context, canMoveUp, canMoveDown, onMove }) {
  const { menuId, branch, at, can, busy, run, sections } = context;
  const { product, rows } = entry;
  const availability = productAvailability(rows, at);
  const single = rows.length === 1;
  const href = product.type === "COMBO" ? `/dashboard/combos/${entry.productId}` : `/dashboard/products/${entry.productId}`;
  const base = `/admin/menus/${menuId}/products/${entry.productId}`;

  return (
    <li className="flex flex-col gap-3 rounded-field bg-surface-container-low p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        {can.arrange ? (
          <div className="flex flex-col">
            <IconButton label={`Move ${product.name} up`} icon={ArrowUp} disabled={busy || !canMoveUp} onClick={() => onMove(-1)} />
            <IconButton label={`Move ${product.name} down`} icon={ArrowDown} disabled={busy || !canMoveDown} onClick={() => onMove(1)} />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
            {can.openProducts ? <Link href={href} className="hover:underline">{product.name}</Link> : product.name}
            {entry.isRecommended ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-on-secondary-container">
                <Star aria-hidden="true" className="size-3" />
                Recommended
              </span>
            ) : null}
            <AvailabilityBadge availability={availability} timezone={branch.timezone} />
          </p>
          {product.category ? <p className="text-body-md text-on-surface-variant">{product.category.name}{product.type === "COMBO" ? " · combo" : ""}</p> : null}
        </div>

        {can.toggle && availability.key !== "NOT_OFFERED" ? (
          <SoldOutControl
            label={product.name}
            soldOut={availability.key === "SOLD_OUT"}
            timezone={branch.timezone}
            at={at}
            busy={busy}
            onChange={(body, success) => run(() => api.put(`${base}/availability`, body), success)}
            allSizes={!single}
          />
        ) : null}
      </div>

      <ul className="flex flex-col divide-y divide-outline-variant/60 rounded-field bg-surface-container-lowest">
        {rows.map((row) => (
          <SizeRow key={row.id} row={row} single={single} context={context} />
        ))}
      </ul>

      {can.arrange ? (
        <div className="flex flex-wrap items-center gap-2">
          {sections.length ? (
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <span className="text-label-bold">Section</span>
              <select
                value={entry.sectionId && sections.some((section) => section.id === entry.sectionId) ? entry.sectionId : ""}
                disabled={busy}
                onChange={(event) => {
                  const sectionId = event.target.value || null;
                  const name = sections.find((section) => section.id === sectionId)?.name ?? "No section";
                  run(() => api.patch(base, { sectionId }), `${product.name} moved to ${name}.`);
                }}
                className="rounded-field border border-transparent bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
              >
                <option value="">No section</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>{section.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <RowButton
            disabled={busy}
            aria-pressed={entry.isRecommended}
            onClick={() => run(() => api.patch(base, { isRecommended: !entry.isRecommended }), entry.isRecommended ? `${product.name} is no longer recommended.` : `${product.name} is recommended.`)}
          >
            {entry.isRecommended ? "Unrecommend" : "Recommend"}
          </RowButton>
          <RowButton
            tone="danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Remove "${product.name}" from this menu?${single ? "" : ` All ${rows.length} sizes go with it.`} The product itself is not deleted.`)) return;
              run(() => api.delete(base), `${product.name} removed from the menu.`);
            }}
          >
            Remove
          </RowButton>
        </div>
      ) : null}
    </li>
  );
}

function SizeRow({ row, single, context }) {
  const { menuId, branch, currency, at, can, busy, run } = context;
  const state = menuRowState(row, at);
  const basePrice = Number(row.variant.price);
  const override = row.priceOverride != null ? Number(row.priceOverride) : null;
  const sizeName = single && row.variant.name === "Regular" ? "Price" : row.variant.name;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      <div className="min-w-28 flex-1">
        <p className="text-label-bold text-on-surface">{sizeName}</p>
        {ROW_NOTES[state.key] ? <p className="text-label-bold font-normal text-error">{ROW_NOTES[state.key]}</p> : null}
        {!single && state.key === "SOLD_OUT" ? (
          <p className="text-body-md text-on-surface-variant">{soldOutText(state.until, branch.timezone)}</p>
        ) : null}
      </div>

      {can.price ? (
        <PriceControl key={`${row.id}:${override}`} row={row} basePrice={basePrice} override={override} currency={currency} label={single ? row.product.name : `${row.product.name}, ${row.variant.name}`} context={context} />
      ) : (
        <p className="text-body-md tabular-nums text-on-surface">
          {formatMoney(override ?? basePrice, currency)}
          {override != null ? <span className="text-on-surface-variant"> (product: {formatMoney(basePrice, currency)})</span> : null}
        </p>
      )}

      {can.toggle && !single && (state.key === "AVAILABLE" || state.key === "SOLD_OUT") ? (
        <SoldOutControl
          label={`${row.product.name}, ${row.variant.name}`}
          soldOut={state.key === "SOLD_OUT"}
          timezone={branch.timezone}
          at={at}
          busy={busy}
          compact
          onChange={(body, success) => run(() => api.put(`/admin/menus/${menuId}/items/${row.id}/availability`, body), success)}
        />
      ) : null}
    </li>
  );
}

function PriceControl({ row, basePrice, override, currency, label, context }) {
  const { menuId, busy, run } = context;
  const [value, setValue] = useState(override != null ? String(override) : "");
  const [error, setError] = useState(null);
  const parsed = priceOverridePayload(value);
  const dirty = !parsed.error && parsed.value !== override;
  const inputId = `price-${row.id}`;

  async function save(next) {
    setError(null);
    const ok = await run(
      () => api.patch(`/admin/menus/${menuId}/items/${row.id}`, { priceOverride: next }),
      next == null ? `${label} uses the product price again.` : `${label} is ${formatMoney(next, currency)} on this menu.`,
    );
    if (!ok) setValue(override != null ? String(override) : "");
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.error) return setError(parsed.error);
        if (dirty) save(parsed.value);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <div className="flex flex-col">
        <label htmlFor={inputId} className="sr-only">Menu price for {label}</label>
        <input
          id={inputId}
          inputMode="decimal"
          value={value}
          placeholder={String(basePrice)}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          className={`w-28 rounded-field bg-surface-container-low px-3 py-2 text-right text-body-md tabular-nums text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${error ? "border border-error" : "border border-transparent"}`}
        />
      </div>
      <span id={`${inputId}-hint`} className="text-body-md text-on-surface-variant">
        {override != null ? `product: ${formatMoney(basePrice, currency)}` : "product price"}
      </span>
      {dirty ? (
        <button type="submit" disabled={busy} className="rounded-field bg-primary-container px-3 py-2 text-label-bold text-on-primary-container disabled:opacity-60">
          Save
        </button>
      ) : null}
      {override != null && !dirty ? (
        <button type="button" disabled={busy} onClick={() => save(null)} className="rounded-field px-2 py-2 text-label-bold text-primary hover:underline disabled:opacity-60">
          Use product price
        </button>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="basis-full text-label-bold text-error">{error}</p>
      ) : null}
    </form>
  );
}

function soldOutText(until, timezone) {
  if (!until) return "Sold out until turned back on";
  return `Sold out until ${formatZoned(until, timezone, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

function AvailabilityBadge({ availability, timezone }) {
  if (availability.key === "SOLD_OUT") {
    return <span className="rounded-full bg-error-container px-2 py-0.5 text-on-error-container">{soldOutText(availability.until, timezone)}</span>;
  }
  if (availability.key === "PARTLY") {
    return <span className="rounded-full bg-warning-container px-2 py-0.5 text-on-warning-container">Some sizes sold out</span>;
  }
  if (availability.key === "NOT_OFFERED") {
    return <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Not shown</span>;
  }
  return null;
}

/**
 * Sold out, with how long for. "Rest of today" ends at the branch's midnight,
 * which is what a kitchen that ran out means; the other option stays off
 * until someone turns it back on — a seasonal item, a broken machine.
 */
function SoldOutControl({ label, soldOut, timezone, at, busy, onChange, compact = false, allSizes = false }) {
  const [choosing, setChoosing] = useState(false);
  const button = compact ? "px-3 py-2" : "px-4 py-2.5";

  if (soldOut) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange({ isAvailable: true }, `${label} is back on sale.`)}
        className={`rounded-field border border-outline text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${button}`}
      >
        Back on sale
      </button>
    );
  }

  if (!choosing) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setChoosing(true)}
        className={`rounded-field text-label-bold text-error hover:bg-error-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${button}`}
      >
        {allSizes ? "Sold out (all sizes)" : "Sold out"}
      </button>
    );
  }

  const choose = (until) => {
    setChoosing(false);
    onChange(
      { isAvailable: false, ...(until ? { until: until.toISOString() } : {}) },
      until ? `${label} is sold out for the rest of today.` : `${label} is sold out until turned back on.`,
    );
  };

  return (
    <div role="group" aria-label={`Mark ${label} sold out`} className="flex flex-wrap items-center gap-1 rounded-field bg-surface-container-lowest p-1">
      <RowButton tone="danger" disabled={busy} onClick={() => choose(endOfLocalDay(timezone, new Date(Math.max(Date.now(), at.getTime()))))}>
        Rest of today
      </RowButton>
      <RowButton tone="danger" disabled={busy} onClick={() => choose(null)}>
        Until turned back on
      </RowButton>
      <IconButton label="Cancel" icon={X} onClick={() => setChoosing(false)} />
    </div>
  );
}

/**
 * Picks products from the catalog and adds every active size of each.
 *
 * Searches the catalog as you type rather than loading it all: a chain's
 * catalog is the one list here that grows without bound.
 */
function AddProducts({ menuId, items, sections, categories, currency, onClose }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [results, setResults] = useState(null);
  const [more, setMore] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(() => new Map());
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);

  const onMenu = useMemo(() => new Set(items.map((row) => row.variantId)), [items]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const search = new URLSearchParams({ limit: "51" });
      if (q.trim()) search.set("search", q.trim());
      if (categoryId) search.set("categoryId", categoryId);
      try {
        const rows = await api.get(`/admin/products?${search}`, { signal: controller.signal });
        setResults(rows.slice(0, 50));
        setMore(rows.length > 50);
        setLoadError(null);
      } catch (failure) {
        if (failure?.name === "AbortError") return;
        setLoadError(failure?.message ?? "Products could not be loaded.");
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, categoryId]);

  const toggle = (product) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product.name);
      return next;
    });

  async function add() {
    if (!selected.size || pending) return;
    setPending(true);
    setFormError(null);
    try {
      const result = await api.post(`/admin/menus/${menuId}/items/bulk`, { productIds: [...selected.keys()], sectionId: sectionId || null });
      const skipped = result.skipped.length ? ` ${result.skipped.length} skipped (already on the menu or no active size).` : "";
      toast.success(`${result.addedProducts} ${result.addedProducts === 1 ? "product" : "products"} added.${skipped}`);
      setSelected(new Map());
      router.refresh();
      onClose();
    } catch (failure) {
      setFormError(failure?.message ?? "Those products could not be added.");
      setPending(false);
    }
  }

  const control = "w-full rounded-field border border-transparent bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring";

  return (
    <div role="region" aria-label="Add products" className="flex flex-col gap-4 rounded-field border border-outline-variant bg-surface-container-low p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-[2] flex-col gap-1.5">
          <label htmlFor="add-search" className="text-label-bold text-on-surface">Search products</label>
          <input id="add-search" type="search" autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name or SKU" className={control} />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <label htmlFor="add-category" className="text-label-bold text-on-surface">Category</label>
          <select id="add-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={control}>
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <FormAlert>{loadError}</FormAlert>

      {results === null ? (
        <p className="text-body-md text-on-surface-variant" aria-live="polite">Loading products…</p>
      ) : results.length ? (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto" aria-label="Products">
          {results.map((product) => {
            const sizes = product.variants;
            const already = sizes.length > 0 && sizes.every((variant) => onMenu.has(variant.id));
            const disabled = already || !sizes.length;
            const note = already ? "On this menu" : !sizes.length ? "No active size" : !product.isActive ? "Unpublished — hidden until published" : null;
            const prices = sizes.map((variant) => Number(variant.price));
            return (
              <li key={product.id}>
                <label className={`flex items-center gap-3 rounded-field px-3 py-2.5 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-surface-container"}`}>
                  <input type="checkbox" disabled={disabled} checked={selected.has(product.id)} onChange={() => toggle(product)} className="size-5 shrink-0 accent-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-bold text-on-surface">
                      {product.name}
                      {product.type === "COMBO" ? <span className="font-normal text-on-surface-variant"> · combo</span> : null}
                    </span>
                    <span className="block text-body-md text-on-surface-variant">
                      {product.category?.name}
                      {prices.length ? ` · ${formatMoney(Math.min(...prices), currency)}${sizes.length > 1 ? `, ${sizes.length} sizes` : ""}` : ""}
                    </span>
                    {note ? <span className="block text-label-bold font-normal text-on-surface-variant">{note}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No products match.</p>
      )}
      {more ? <p className="text-body-md text-on-surface-variant">Showing the first 50. Search or pick a category to narrow it down.</p> : null}

      <FormAlert>{formError}</FormAlert>

      <div className="flex flex-wrap items-end gap-3">
        {sections.length ? (
          <div className="flex min-w-40 flex-col gap-1.5">
            <label htmlFor="add-section" className="text-label-bold text-on-surface">Put them in</label>
            <select id="add-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)} className={control}>
              <option value="">No section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <button
          type="button"
          onClick={add}
          disabled={!selected.size || pending}
          className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending ? "Adding…" : selected.size ? `Add ${selected.size} ${selected.size === 1 ? "product" : "products"}` : "Pick products to add"}
        </button>
        <button type="button" onClick={onClose} className="rounded-field px-4 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">
          Cancel
        </button>
      </div>
    </div>
  );
}
