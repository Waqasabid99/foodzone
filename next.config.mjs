/**
 * The public host of an S3 / R2 bucket, when that storage driver is used.
 *
 * Uploaded photos are served from wherever the storage driver puts them, and
 * `next/image` refuses any host not listed here — a product photo would throw
 * on the storefront instead of rendering. Cloudinary's host is fixed and listed
 * below; the local driver's files skip optimisation (see `FoodImage`).
 */
function bucketPattern() {
  try {
    const url = new URL(process.env.S3_PUBLIC_URL);
    return [{ protocol: url.protocol.replace(":", ""), hostname: url.hostname }];
  } catch {
    return [];
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Ship the server, not the toolchain.
   *
   * A standalone build traces the dependencies each route actually imports and
   * writes a self-contained server into `.next/standalone`, so a deployment is
   * a couple of hundred megabytes instead of the gigabyte-plus that shipping
   * `node_modules` entire would cost. On a small VPS that is the difference
   * between comfortable and tight, and it is also the shape Hostinger's Node
   * runtime expects, which keeps both deployment targets identical.
   *
   * Two things the output does *not* include, because Next cannot know whether
   * a CDN is serving them: `.next/static` and `public/`. Both have to be copied
   * in beside the server, or the site renders with no CSS and no images. The
   * deployment runbook does this; if a deploy ever comes up unstyled, this is
   * the reason.
   *
   * `next start` is unaffected — the normal build output is still written, so
   * local runs and the end-to-end suite behave exactly as before.
   */
  output: "standalone",

  /**
   * Where the build goes.
   *
   * `.next` unless something asks otherwise, which lets a production build for
   * the end-to-end suite be written somewhere else while `next dev` is running
   * out of `.next` — otherwise the two fight over the same directory and the
   * dev server falls over mid-test.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      ...bucketPattern(),
    ],
  },
};

export default nextConfig;
