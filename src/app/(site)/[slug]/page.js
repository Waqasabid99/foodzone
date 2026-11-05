import { notFound } from "next/navigation";
import { getContentPage } from "@/server/content/pages";
import { getSiteIdentity } from "@/server/content/site";
import { parseProse, firstParagraph } from "@/lib/prose";
import { dateLabel } from "@/lib/finance";

/**
 * A public page whose words live in the database.
 *
 * One dynamic segment rather than five near-identical files. It sits last in
 * the matching order — every real route (`/menu`, `/checkout`, `/login`) is a
 * static segment and wins over this — so the only requests that reach here are
 * ones nothing else claimed. An unknown slug is a 404, exactly as it was
 * before this route existed.
 *
 * Styling is deliberately plain. These are pages somebody reads once to find a
 * phone number or a refund window, and a column of text at a comfortable
 * measure is the whole design brief.
 */
export const revalidate = 3600;

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await getContentPage(slug);
  if (!page) return { title: "Page not found — FoodZone" };

  return {
    title: `${page.title} — FoodZone`,
    description: page.summary || firstParagraph(page.body) || undefined,
  };
}

export default async function ContentPageRoute({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { slug } = await params;
  const page = await getContentPage(slug);
  if (!page) notFound();

  const blocks = parseProse(page.body);

  return (
    <article className="mx-auto max-w-2xl px-margin-mobile py-12 md:px-margin-desktop md:py-16">
      <h1 className="font-display text-headline-lg text-on-surface">{page.title}</h1>

      {/* Stated on every one of these, because "is this current?" is the
          question somebody reading a privacy policy or a set of terms is
          actually asking. */}
      <p className="mt-3 text-label-bold font-normal text-on-surface-variant">
        Last updated {dateLabel(page.updatedAt, timeZone)}
      </p>

      <div className="mt-8 flex flex-col gap-5">
        {blocks.map((block, index) =>
          block.type === "heading" ? (
            <h2 key={index} className="mt-3 font-display text-headline-md text-on-surface">
              {block.text}
            </h2>
          ) : (
            <p key={index} className="text-body-lg text-on-surface-variant">
              {block.text}
            </p>
          ),
        )}
      </div>
    </article>
  );
}
