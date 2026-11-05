import { z } from "zod";

/**
 * Editing a public page.
 *
 * `slug` is deliberately absent: it is half of a route, and Zod strips what it
 * does not declare, so a client that sends one changes nothing rather than
 * being told off. The body is plain text — see `@/lib/prose` for why it is not
 * HTML and not Markdown.
 *
 * The length cap is generous rather than tight. A privacy policy written by a
 * lawyer is genuinely long, and a limit that refuses one is a limit that sends
 * the owner back to editing the file.
 */
export const updateContentPageSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(50_000).optional(),
    summary: z.string().trim().max(300).nullish(),
    isPublished: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });
