import { apiHandler, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertRecordAccess } from "@/server/hr/access";
import { payslipPdf } from "@/server/services/document.service";

/**
 * Anybody's payslip, as a file — for the person who runs payroll.
 *
 * A draft renders too, carrying a DRAFT banner, because the point of looking
 * at one before approval is to check it. What the banner prevents is a slip
 * built from figures that may still be regenerated circulating as final.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "payslips.view_all",
    params: idParamSchema,
    rateLimit: RateLimits.read,
    doc: {
      summary: "Download a payslip as a PDF",
      description:
        "Renders the payslip to A4, showing earnings, deductions and the attendance they were computed from. " +
        "A draft or cancelled payslip renders with a banner saying so. Approved and paid slips are stored and linked from pdfUrl.",
      tag: "Payroll",
    },
  },
  async ({ auth, params }) => {
    await assertRecordAccess(auth, "payslip", params.id, "payslips.view_all");
    const pdf = await payslipPdf(params.id, { actorId: auth.userId });

    return new Response(pdf.buffer, {
      headers: {
        "content-type": pdf.contentType,
        "content-disposition": `inline; filename="${pdf.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  },
);
