import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import QrCodeForm from "@/components/dashboard/service/QrCodeForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { actionableBranches, qrTargetOptions, tableOptions } from "@/server/content/service-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New QR code — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewQrCodePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/qr-codes/new"));

  const branches = await actionableBranches(principal, "qr_codes.create");
  if (!branches.length) redirect("/dashboard/qr-codes");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branchId = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : branches[0].id;

  const [targets, tables] = await Promise.all([qrTargetOptions(branchId), tableOptions(principal, branchId)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New QR code"
        description="A short link you can print. Where it points can be changed later without reprinting anything."
        back={{ href: "/dashboard/qr-codes", label: "QR codes" }}
      />
      <QrCodeForm branches={serialize(branches)} targets={serialize(targets)} tables={serialize(tables)} />
    </div>
  );
}
