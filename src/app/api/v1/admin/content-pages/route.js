import { apiHandler, ok } from "@/lib/api";
import { listContentPages } from "@/server/services/content-page.service";

/**
 * The public pages an owner may edit.
 *
 * No POST. These are seeded, because a slug is half of a route — see the
 * service for why inventing one at runtime is a page that 404s on a typo.
 */
export const GET = apiHandler({ auth: true, permissions: "content_pages.read" }, async () =>
  ok(await listContentPages()),
);
