import { apiHandler, ok, RateLimits } from "@/lib/api";
import { sweepOrphanedUploads } from "@/server/services/media.service";
import { uploadSweepSchema } from "@/server/validation/schemas";

/**
 * The orphaned-upload sweep, on demand.
 *
 * The sweep also runs daily inside the maintenance cycle; this exists so it
 * can be *looked at* first. `dryRun` is the default on purpose — the honest
 * first use of a tool that deletes files out of a customer's bucket is to list
 * exactly what it would take, which is why a dry run returns the keys
 * themselves rather than a count.
 *
 * Gated on `media.delete`: it does the same thing that permission already
 * allows, in bulk and without a person naming each file.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "media.delete",
    query: uploadSweepSchema,
    rateLimit: RateLimits.write,
    doc: {
      summary: "Sweep uploads that were never confirmed",
      description:
        "Lists, and optionally deletes, objects in storage that no media record points to. " +
        "Defaults to a dry run. Only keys this system generated, older than the grace window " +
        "and with no media row, are ever eligible.",
      tag: "Media",
    },
  },
  async ({ query }) =>
    ok(
      await sweepOrphanedUploads({
        dryRun: query.dryRun,
        minAgeMinutes: query.minAgeMinutes,
        limit: query.limit,
      }),
    ),
);
