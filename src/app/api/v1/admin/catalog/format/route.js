import { apiHandler, ok } from "@/lib/api";
import { importFormat } from "@/server/services/catalog-transfer.service";

/**
 * The columns each importable resource accepts.
 *
 * Served rather than only documented so the admin UI can render the column list
 * and the rules beside the file picker — the moment someone actually needs
 * them — and so it cannot drift from what the importer enforces.
 */
export const GET = apiHandler(
  { auth: true, permissions: ["catalog.import", "catalog.export"], anyPermission: true },
  async () => ok(importFormat()),
);
