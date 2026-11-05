"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { ORDER_STATES, bulkTablePayload, bulkTablePreview, tablePayload } from "@/lib/service";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";

const blank = { name: "", area: "", seats: "4", isActive: true };

/**
 * The dining room.
 *
 * Two ways in, because laying out a room and fixing one table are different
 * jobs: the bulk form creates T-1 to T-20 in one go when a branch opens, and
 * the row editor fixes the one table that lost a chair.
 *
 * A table with orders against it is deactivated rather than deleted — the
 * server refuses the delete and says so. That is right: a deleted table takes
 * its history with it, and "which table was that complaint about?" stops
 * having an answer.
 */
export default function TablesEditor({ branchId, tables, areas, seated = {}, canCreate, canUpdate, canDelete, canSeat = false }) {
  const router = useRouter();
  const [form, setForm] = useState(blank);
  const [bulk, setBulk] = useState({ prefix: "T-", from: "1", to: "10", seats: "4", area: "", padTo: "" });
  const [showBulk, setShowBulk] = useState(false);
  const [errors, setErrors] = useState({});
  const [bulkErrors, setBulkErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setB = (patch) => setBulk((current) => ({ ...current, ...patch }));
  const preview = bulkTablePreview({ ...bulk, padTo: bulk.padTo || null });

  async function addOne(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = tablePayload({ ...form, branchId });
    setErrors(local);
    if (Object.keys(local).length) return setError("Some fields need attention.");

    setPending(true);
    setError(null);
    try {
      await api.post("/admin/tables", body);
      toast.success(`${body.name} added.`);
      setForm(blank);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be added.");
    } finally {
      setPending(false);
    }
  }

  async function addMany(event) {
    event.preventDefault();
    if (pending) return;
    const { body, errors: local } = bulkTablePayload({ ...bulk, branchId, padTo: bulk.padTo || null });
    setBulkErrors(local);
    if (Object.keys(local).length) return setError("Check the range.");
    if (!window.confirm(`Create ${preview.count} tables, ${preview.sample.join(", ")}?`)) return;

    setPending(true);
    setError(null);
    try {
      const result = await api.post("/admin/tables/bulk", body);
      toast.success(`${result?.created ?? preview.count} tables added.`);
      setShowBulk(false);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "They could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function toggle(table) {
    if (busyId) return;
    setBusyId(table.id);
    setError(null);
    try {
      await api.patch(`/admin/tables/${table.id}`, { isActive: !table.isActive });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(table) {
    if (busyId) return;
    if (!window.confirm(`Delete ${table.name}? If it has ever had an order on it the server will refuse — turn it off instead.`)) return;
    setBusyId(table.id);
    setError(null);
    try {
      await api.delete(`/admin/tables/${table.id}`);
      toast.success(`${table.name} deleted.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be deleted.");
    } finally {
      setBusyId(null);
    }
  }

  const grouped = new Map();
  for (const table of tables) {
    const key = table.area ?? "No area";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(table);
  }

  return (
    <div className="flex flex-col gap-6">
      <FormAlert>{error}</FormAlert>

      {tables.length ? (
        [...grouped.entries()].map(([area, rows]) => (
          <section key={area} className="flex flex-col gap-3">
            <h2 className="font-display text-headline-md text-on-surface">{area}</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((table) => (
                <li
                  key={table.id}
                  className={`flex items-center justify-between gap-3 rounded-field px-4 py-3 ${
                    seated[table.id]
                      ? "bg-secondary-container text-on-secondary-container"
                      : table.isActive
                        ? "bg-surface-container-lowest"
                        : "bg-surface-container-high"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="text-label-bold">{table.name}</span>
                    {/* An occupied table has to read as occupied from across
                        the room, so it carries the order rather than looking
                        exactly like the empty one beside it. */}
                    {seated[table.id] ? (
                      <span className="block text-label-bold font-normal">
                        <Link href={`/dashboard/orders/${seated[table.id].id}`} className="underline underline-offset-2">
                          {seated[table.id].orderNumber}
                        </Link>
                        {" · "}
                        {(ORDER_STATES[seated[table.id].status] ?? {}).label ?? seated[table.id].status}
                        {seated[table.id].paymentState === "PAID" ? "" : " · unpaid"}
                      </span>
                    ) : (
                      <span className="block text-label-bold font-normal text-on-surface-variant">
                        Free · {table.seats} {table.seats === 1 ? "seat" : "seats"}
                        {table.qrCodeCount ? ` · ${table.qrCodeCount} QR` : ""}
                        {table.isActive ? "" : " · off"}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {/* The whole point of a floor plan: the table under your
                        finger is the one you are seating. Without this a
                        waiter crossed the room, opened the counter screen and
                        picked the table they were just standing at out of a
                        list of twenty. */}
                    {canSeat && !seated[table.id] && table.isActive ? (
                      <Link
                        href={`/dashboard/orders/new?branch=${branchId}&type=DINE_IN&table=${table.id}`}
                        className="rounded-field bg-primary-container px-3 py-2 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Seat them
                      </Link>
                    ) : null}
                    {canSeat && seated[table.id] ? (
                      <Link
                        href={`/dashboard/orders/${seated[table.id].id}`}
                        className="rounded-field bg-surface-container-lowest px-3 py-2 text-label-bold text-on-surface hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Open it
                      </Link>
                    ) : null}
                    {canUpdate ? (
                      <button
                        type="button"
                        onClick={() => toggle(table)}
                        disabled={busyId === table.id}
                        className="rounded-field px-3 py-2 text-label-bold text-primary hover:bg-surface-container disabled:opacity-60"
                      >
                        {table.isActive ? "Turn off" : "Turn on"}
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        aria-label={`Delete ${table.name}`}
                        onClick={() => remove(table)}
                        disabled={busyId === table.id}
                        className="rounded-field px-2 py-2 text-error hover:bg-surface-container disabled:opacity-60"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
          No tables here yet. Lay the room out below — orders can be tagged to a table, and a table QR code seats people
          without anyone asking which table they are at.
        </p>
      )}

      {canCreate ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowBulk(false)}
              aria-pressed={!showBulk}
              className={`rounded-field px-4 py-2.5 text-label-bold ${!showBulk ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface"}`}
            >
              One table
            </button>
            <button
              type="button"
              onClick={() => setShowBulk(true)}
              aria-pressed={showBulk}
              className={`rounded-field px-4 py-2.5 text-label-bold ${showBulk ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface"}`}
            >
              A whole row
            </button>
          </div>

          {showBulk ? (
            <form onSubmit={addMany} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
              <p className="text-label-bold text-on-surface">Lay out a room</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field id="bulk-prefix" label="Prefix" value={bulk.prefix} onChange={(event) => setB({ prefix: event.target.value })} autoComplete="off" />
                <Field id="bulk-from" label="From" inputMode="numeric" value={bulk.from} onChange={(event) => setB({ from: event.target.value })} error={bulkErrors.from} autoComplete="off" />
                <Field id="bulk-to" label="To" inputMode="numeric" value={bulk.to} onChange={(event) => setB({ to: event.target.value })} error={bulkErrors.to} autoComplete="off" />
                <Field id="bulk-seats" label="Seats each" inputMode="numeric" value={bulk.seats} onChange={(event) => setB({ seats: event.target.value })} error={bulkErrors.seats} autoComplete="off" />
                <Field id="bulk-pad" label="Pad to" inputMode="numeric" value={bulk.padTo} onChange={(event) => setB({ padTo: event.target.value })} error={bulkErrors.padTo} hint="So T-01 sorts before T-10." autoComplete="off" />
              </div>
              <Field id="bulk-area" label="Area" value={bulk.area} onChange={(event) => setB({ area: event.target.value })} hint="Optional — Terrace, Upstairs, Garden." autoComplete="off" />
              <p className="rounded-field bg-surface-container px-4 py-3 text-body-md text-on-surface">
                {preview.count ? <>Creates <strong className="tabular-nums">{preview.count}</strong> tables: {preview.sample.join(", ")}</> : "Nothing to create yet."}
              </p>
              <button type="submit" disabled={pending || !preview.count} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {pending ? "Creating…" : `Create ${preview.count || ""} tables`}
              </button>
            </form>
          ) : (
            <form onSubmit={addOne} noValidate className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
              <p className="text-label-bold text-on-surface">Add a table</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="table-name" label="Name" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} autoComplete="off" />
                <Field id="table-seats" label="Seats" inputMode="numeric" value={form.seats} onChange={(event) => set({ seats: event.target.value })} error={errors.seats} autoComplete="off" />
                {areas.length ? (
                  <SelectField
                    id="table-area"
                    label="Area"
                    value={form.area}
                    onChange={(event) => set({ area: event.target.value })}
                    options={[{ value: "", label: "No area" }, ...areas.map((area) => ({ value: area, label: area }))]}
                  />
                ) : (
                  <Field id="table-area" label="Area" value={form.area} onChange={(event) => set({ area: event.target.value })} hint="Optional." autoComplete="off" />
                )}
              </div>
              <button type="submit" disabled={pending} className="inline-flex w-fit items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <Plus aria-hidden="true" className="size-4" />
                {pending ? "Adding…" : "Add table"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
