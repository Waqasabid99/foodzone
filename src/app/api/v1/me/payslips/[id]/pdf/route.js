import { apiHandler, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOwnPayslip } from "@/server/services/payroll.service";
import { payslipPdf } from "@/server/services/document.service";

/**
 * An employee downloading their own payslip.
 *
 * Separate from the admin route on purpose, and not the admin route with a
 * filter: reading anybody's payslip needs `payslips.view_all`, reading your
 * own needs only being you, and conflating the two is how one endpoint ends
 * up handing out the whole payroll.
 *
 * `attachment`, not `inline`: this is the copy that goes to a landlord or a
 * bank, so the expected action is "save it".
 */
export const GET = apiHandler(
  {
    auth: true,
    params: idParamSchema,
    rateLimit: RateLimits.read,
    doc: {
      summary: "Download your own payslip as a PDF",
      description: "Only the signed-in employee's own payslips, and only once approved or paid.",
      tag: "Me",
    },
  },
  async ({ auth, params }) => {
    await assertOwnPayslip({ userId: auth.userId, payslipId: params.id });
    const pdf = await payslipPdf(params.id, { actorId: auth.userId });

    return new Response(pdf.buffer, {
      headers: {
        "content-type": pdf.contentType,
        "content-disposition": `attachment; filename="${pdf.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  },
);
