"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-toastify";
import { FileText } from "lucide-react";
import { api } from "@/lib/api-client";
import { invoicePayload } from "@/lib/finance";
import { formatMoney } from "@/lib/format";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

const blank = { name: "", taxId: "", line1: "", line2: "", city: "", postalCode: "" };

/**
 * Issuing and voiding the invoice for one order.
 *
 * The endpoints and the permissions for this existed from the start and no
 * screen ever called them, so the Invoices list could only ever be empty and
 * its own empty state pointed at a button that did not exist.
 *
 * An invoice is not a receipt and the difference is the point: a receipt is
 * proof of payment and is printed for everybody, an invoice is a numbered tax
 * document issued because somebody asked for one with their company details on
 * it. So this is a short form rather than a single button — the details are the
 * whole reason it is being issued.
 *
 * Issued invoices are never edited. A mistake is voided and a new number is
 * taken, which is how a sequential series stays auditable.
 */
export default function InvoiceActions({ orderId, invoice, currency = "PKR", canCreate, canVoid }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const live = invoice && !invoice.isVoid;

  async function issue(event) {
    event.preventDefault();
    if (pending) return;

    const { body, errors: local } = invoicePayload(form);
    setErrors(local);
    if (Object.keys(local).length) return setError("Check the billing details.");

    setPending(true);
    setError(null);
    try {
      const issued = await api.post(`/admin/orders/${orderId}/invoice`, body);
      toast.success(`Invoice ${issued?.invoiceNumber ?? ""} issued.`);
      setForm(blank);
      setOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "The invoice could not be issued.");
    } finally {
      setPending(false);
    }
  }

  async function voidIt() {
    const reason = window.prompt("Why is this invoice being voided? The reason is kept with the number.");
    if (reason === null) return;
    if (reason.trim().length < 3) return setError("A void needs a reason of at least a few words.");

    setPending(true);
    setError(null);
    try {
      await api.post(`/admin/orders/${orderId}/invoice/void`, { reason: reason.trim() });
      toast.success("Invoice voided.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be voided.");
    } finally {
      setPending(false);
    }
  }

  if (!invoice && !canCreate) return null;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div>
        <h2 className="font-display text-headline-md text-on-surface">Invoice</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          A numbered tax document, issued when a customer asks for one with their company details on it. The receipt is
          separate and is printed for everybody.
        </p>
      </div>

      <FormAlert>{error}</FormAlert>

      {invoice ? (
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-1 text-body-md">
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Number</dt>
              <dd className="font-mono text-on-surface">{invoice.invoiceNumber}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-on-surface-variant">Amount</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(invoice.totalAmount, currency)}</dd>
            </div>
            {invoice.isVoid ? (
              <div className="flex justify-between gap-3">
                <dt className="text-label-bold text-error">Voided</dt>
                <dd className="text-body-md text-error">{invoice.voidReason ?? "No reason recorded"}</dd>
              </div>
            ) : null}
          </dl>

          <div className="flex flex-wrap gap-2">
            {live ? (
              <Link
                href={`/dashboard/orders/${orderId}/invoice`}
                className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <FileText aria-hidden="true" className="size-4" />
                Print the invoice
              </Link>
            ) : null}
            {live && canVoid ? (
              <button
                type="button"
                onClick={voidIt}
                disabled={pending}
                className="rounded-field border border-error px-5 py-3 text-label-bold text-error hover:bg-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Void it
              </button>
            ) : null}
            {!live && canCreate ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Issue a replacement
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!live && canCreate ? (
        open ? (
          <form onSubmit={issue} noValidate className="flex flex-col gap-4 rounded-field bg-surface-container-low p-4">
            <p className="text-body-md text-on-surface-variant">
              Leave a box empty and the name already on the order is used.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="inv-name" label="Billed to" value={form.name} onChange={(event) => set({ name: event.target.value })} error={errors.name} autoComplete="organization" />
              <Field id="inv-tax" label="Tax number" value={form.taxId} onChange={(event) => set({ taxId: event.target.value })} error={errors.taxId} autoComplete="off" />
              <Field id="inv-line1" label="Address" value={form.line1} onChange={(event) => set({ line1: event.target.value })} autoComplete="address-line1" />
              <Field id="inv-line2" label="Address line 2" value={form.line2} onChange={(event) => set({ line2: event.target.value })} autoComplete="address-line2" />
              <Field id="inv-city" label="City" value={form.city} onChange={(event) => set({ city: event.target.value })} autoComplete="address-level2" />
              <Field id="inv-post" label="Postcode" value={form.postalCode} onChange={(event) => set({ postalCode: event.target.value })} autoComplete="postal-code" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {pending ? "Issuing…" : "Issue the invoice"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-field bg-surface-container-high px-5 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Not now
              </button>
            </div>
            <p className="text-body-md text-on-surface-variant">
              The number is taken from the branch&rsquo;s sequence and cannot be reused. A mistake is corrected by
              voiding it and issuing another.
            </p>
          </form>
        ) : invoice ? null : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-fit rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Issue an invoice
          </button>
        )
      ) : null}
    </section>
  );
}
