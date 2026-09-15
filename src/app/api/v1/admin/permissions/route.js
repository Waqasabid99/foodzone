import { apiHandler, ok } from "@/lib/api";
import { listPermissions } from "@/server/services/role.service";

/**
 * The seeded permission catalogue, grouped by module for the role editor.
 * Read-only: there is deliberately no write endpoint — permissions are part of
 * the code, not data an admin authors.
 */
export const GET = apiHandler({ auth: true, permissions: "permissions.read" }, async () => ok(await listPermissions()));
