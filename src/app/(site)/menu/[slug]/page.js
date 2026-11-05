import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ChevronRight, Clock, Flame, Info } from "lucide-react";
import ProductGallery from "@/components/products/ProductGallery";
import ProductOrderForm from "@/components/products/ProductOrderForm";
import ProductReviews from "@/components/products/ProductReviews";
import VideoRail from "@/components/videos/VideoRail";
import RelatedProducts from "@/components/products/RelatedProducts";
import OrderSummaryBar from "@/components/menu/OrderSummaryBar";
import OrderTypeSwitch from "@/components/menu/OrderTypeSwitch";
import Stars from "@/components/ui/Stars";
import { getProductPageData } from "@/server/content/product";
import { productVideos } from "@/server/content/creator-videos";
import { getPublicBranches } from "@/server/content/branches";
import { formatMoney, formatRating } from "@/lib/format";
import { BRANCH_COOKIE, resolveBranch } from "@/lib/branch";
import { ORDER_TYPE_COOKIE, resolveOrderType } from "@/lib/order-type";
import { serialize } from "@/lib/api/serialize";
import { ApiError } from "@/lib/api";

const DIETARY_LABELS = {
  VEG: "Vegetarian",
  VEGAN: "Vegan",
  HALAL: "Halal",
  GLUTEN_FREE: "Gluten free",
};

const SPICE_LABELS = ["Not spicy", "Mild", "Medium", "Hot", "Very hot", "Volcanic"];

/**
 * A single product.
 *
 * Dynamic for the same reasons the menu is: the price and availability shown
 * depend on which outlet the visitor picked and on what the kitchen has taken
 * off today. The reads underneath are cached — a minute for anything
 * branch-scoped, five for the catalog.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;

  try {
    const { product } = await getProductPageData({ slug });
    return {
      title: `${product.name} — FoodZone`,
      description: product.shortDescription || product.description || undefined,
    };
  } catch {
    // A missing product is a 404, not a crash in metadata generation.
    return { title: "Product not found — FoodZone" };
  }
}

export default async function ProductPage({ params, searchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [branches, cookieStore] = await Promise.all([getPublicBranches(), cookies()]);
  const branch = resolveBranch(branches, cookieStore.get(BRANCH_COOKIE)?.value ?? null);

  let data;
  try {
    data = await getProductPageData({
      slug,
      branch,
      orderType: resolveOrderType(cookieStore.get(ORDER_TYPE_COOKIE)?.value ?? null),
    });
  } catch (error) {
    // `publicProduct` throws a NOT_FOUND for an unpublished or missing slug,
    // which is exactly a 404 here. Anything else is a real fault and should
    // reach the error boundary rather than be disguised as a missing page.
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { product, currency, reviews, related, priceSource, onBranchMenu } = data;

  /*
   * Videos of this item, filmed at this outlet.
   *
   * After the product read rather than beside it, because the product id comes
   * out of it — and a video section is not worth delaying the price for.
   */
  const videos = serialize(await productVideos({ productId: product.id, branchId: branch?.id ?? null }));

  /*
   * `?v=` is a video handing the sale over.
   *
   * Something filmed against a product that needs choices made cannot be added
   * from the feed, so the viewer sends people here instead. Carrying the id
   * means the creator still gets the credit for a sale their clip caused, two
   * taps later. Checked against the videos actually on this page, so the
   * parameter cannot be used to credit an arbitrary video.
   */
  const fromVideo = Array.isArray(query?.v) ? query.v[0] : query?.v;
  const creditVideoId = videos.some((video) => video.id === fromVideo) ? fromVideo : null;
  const cheapest = product.variants.reduce(
    (min, variant) => (min === null || variant.price < min ? variant.price : min),
    null,
  );
  const compareAt = product.variants.find((variant) => variant.compareAtPrice)?.compareAtPrice ?? null;

  return (
    <div className="mx-auto max-w-page space-y-12 px-margin-mobile py-6 md:px-margin-desktop md:py-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-label-bold font-normal text-on-surface-variant">
          <Crumb href="/">Home</Crumb>
          <Crumb href="/menu">Menu</Crumb>
          {product.category ? (
            <Crumb href={`/menu?category=${product.category.slug}`}>{product.category.name}</Crumb>
          ) : null}
          <li aria-current="page" className="text-on-surface">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <ProductGallery name={product.name} imageUrl={product.imageUrl} images={product.images ?? []} />

        <div>
          <div className="flex flex-wrap items-center gap-2">
            {product.isFeatured ? <Tag tone="primary">Signature series</Tag> : null}
            {product.dietary?.map((code) => (
              <Tag key={code} tone="success">
                {DIETARY_LABELS[code] ?? code}
              </Tag>
            ))}
            {/* Calories and allergens are real columns on the product. The
                macro table and "taste profile" in the design are not, so they
                are absent rather than invented. */}
            {product.calories ? <Tag tone="muted">{product.calories} kcal</Tag> : null}
            {!onBranchMenu && branch ? <Tag tone="warning">Not served at {branch.name}</Tag> : null}
          </div>

          <h1 className="mt-4 font-display text-headline-lg text-on-surface">{product.name}</h1>

          {reviews.summary.count > 0 ? (
            <p className="mt-3 flex items-center gap-2">
              <Stars rating={reviews.summary.average} />
              <span className="text-label-bold text-on-surface">{formatRating(reviews.summary.average)}</span>
              <Link href="#reviews-heading" className="text-label-bold font-normal text-primary hover:underline">
                {reviews.summary.count} {reviews.summary.count === 1 ? "review" : "reviews"}
              </Link>
            </p>
          ) : null}

          {product.description || product.shortDescription ? (
            <p className="mt-4 text-body-md text-on-surface-variant">
              {product.description || product.shortDescription}
            </p>
          ) : null}

          <p className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-headline-md text-primary">
              {product.variants.length > 1 ? "From " : ""}
              {formatMoney(cheapest, currency)}
            </span>
            {compareAt && cheapest && compareAt > cheapest ? (
              <span className="text-body-md text-on-surface-variant line-through">
                {formatMoney(compareAt, currency)}
              </span>
            ) : null}
          </p>

          <ul className="mt-5 flex flex-wrap gap-4 text-label-bold font-normal text-on-surface-variant">
            {product.prepTimeMinutes ? (
              <li className="flex items-center gap-1.5">
                <Clock aria-hidden="true" className="size-4 text-primary" />
                Cooked in about {product.prepTimeMinutes} minutes
              </li>
            ) : null}
            {typeof product.spiceLevel === "number" ? (
              <li className="flex items-center gap-1.5">
                <Flame aria-hidden="true" className="size-4 text-primary" />
                {SPICE_LABELS[product.spiceLevel] ?? `Spice level ${product.spiceLevel}`}
              </li>
            ) : null}
          </ul>

          {/* Allergens are a safety matter, not marketing. Shown whenever the
              product carries them, and stated as "contains" rather than as a
              complete allergen analysis, which the data is not. */}
          {product.allergens?.length ? (
            <p className="mt-5 flex items-start gap-2 rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Contains:</strong> {product.allergens.join(", ")}. Prepared in a kitchen that
                handles other allergens.
              </span>
            </p>
          ) : null}

          <hr className="my-6 border-outline-variant" />

          <ProductOrderForm
            product={product}
            currency={currency}
            branchId={branch?.id ?? null}
            canChooseBranch={branches.length > 1}
            onBranchMenu={onBranchMenu}
            priceSource={priceSource}
            creatorVideoId={creditVideoId}
          />
        </div>
      </div>

      <RelatedProducts
        items={related}
        categoryName={product.category?.name}
        currency={currency}
        branchId={branch?.id ?? null}
      />

      <VideoRail videos={videos} productName={product.name} />

      <ProductReviews reviews={reviews} productName={product.name} />

      <OrderSummaryBar currency={currency} prepMinutes={data.prepMinutes} />
      <OrderTypeSwitch renderedType={data.orderType} />
    </div>
  );
}

function Crumb({ href, children }) {
  return (
    <li className="flex items-center gap-1">
      <Link
        href={href}
        className="transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
      </Link>
      <ChevronRight aria-hidden="true" className="size-3.5" />
    </li>
  );
}

function Tag({ tone, children }) {
  const tones = {
    primary: "bg-primary-container text-on-primary-container",
    success: "bg-success-container text-on-success-container",
    warning: "bg-warning-container text-on-warning-container",
    muted: "bg-surface-container-high text-on-surface-variant",
  };

  return <span className={`rounded-full px-3 py-1 text-label-bold ${tones[tone]}`}>{children}</span>;
}
