/**
 * Category form state <-> API body.
 *
 * The same blank-means-null rule as branches: clearing a description or an
 * image has to send `null`, because on a PATCH an omitted key means "keep what
 * is there" and the cleared value would come straight back.
 */

export const CATEGORY_FIELDS = ["name", "slug", "description", "imageUrl", "parentId"];

export function categoryFormValues(category = null, { parentId = "" } = {}) {
  return {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    imageUrl: category?.imageUrl ?? "",
    parentId: category ? (category.parentId ?? "") : parentId,
    isActive: category ? Boolean(category.isActive) : true,
  };
}

export function categoryPayload(form, { original = null } = {}) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  const body = {
    name: text(form.name),
    description: text(form.description) || null,
    imageUrl: text(form.imageUrl) || null,
    parentId: text(form.parentId) || null,
    isActive: Boolean(form.isActive),
  };

  // The slug is the storefront URL. Blank on create lets the server derive it
  // from the name; on edit it is only sent when actually changed, so saving a
  // new description never risks renaming a link someone has bookmarked.
  const slug = text(form.slug);
  if (slug && slug !== (original?.slug ?? "")) body.slug = slug;

  return body;
}
