import { apiHandler, ok } from "@/lib/api";
import { creatorEligibility } from "@/server/services/creator.service";

/**
 * Whether this account can join, and why not.
 *
 * The reason matters: "you'll be able to join once this order is complete" is a
 * very different message from "you're not eligible", and this drives the invite
 * on the order page.
 */
export const GET = apiHandler({ auth: true }, async ({ auth }) => ok(await creatorEligibility(auth.userId)));
