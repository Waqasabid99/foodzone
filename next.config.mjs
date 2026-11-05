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
