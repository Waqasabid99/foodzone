import { redirect } from "next/navigation";
import { Hash } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import SequenceForm from "@/components/dashboard/admin/SequenceForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listSequences } from "@/server/services/numbering.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Numbering — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The counters behind order, invoice and document numbers.
 *
 * Counters appear by themselves — the first document of a kind at a branch
 * creates one — so there is nothing to add here, only the shape of a number
 * to change.
 */
export default async function NumberingPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/numbering"));
  if (!hasPermission(grantedPermissionKeys(principal), "number_sequences.read")) redirect("/dashboard");

  const sequences = serialize(await listSequences());
  const canManage = can(principal, "number_sequences.manage");

  const byType = new Map();
  for (const sequence of sequences) {
    if (!byType.has(sequence.documentType)) byType.set(sequence.documentType, []);
    byType.get(sequence.documentType).push(sequence);
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Numbering"
        description="How order, invoice and document numbers are built. The counter itself cannot be changed: moving it back would re-issue numbers that are already on invoices, and moving it forward leaves a gap."
      />

      {sequences.length ? (
        [...byType.entries()].map(([documentType, rows]) => (
          <Section
            key={documentType}
            title={rows[0].label}
            description={`${rows.length} ${rows.length === 1 ? "counter" : "counters"} — one per branch and period, so numbers never collide between outlets.`}
          >
            <ul className="flex flex-col gap-4">
              {rows.map((sequence) => (
                <li key={sequence.id} className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-body-md">
                      <span className="text-label-bold text-on-surface">{sequence.branch ? sequence.branch.name : "Company-wide"}</span>
                      {sequence.periodKey ? <Chip>{sequence.periodKey}</Chip> : null}
                    </p>
                    <p className="text-body-md text-on-surface-variant">{sequence.issued} issued so far</p>
                  </div>
                  <SequenceForm sequence={sequence} canManage={canManage} />
                </li>
              ))}
            </ul>
          </Section>
        ))
      ) : (
        <EmptyState icon={Hash} title="No counters yet">
          A counter is created the first time a document of its kind is issued — take an order or receive a delivery, and it appears here.
        </EmptyState>
      )}
    </div>
  );
}
