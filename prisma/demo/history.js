/**
 * A month of trading, invented but plausible.
 *
 * The catalog alone makes a storefront; this is what makes the *back* of the
 * system worth showing. A dashboard reading zero, a kitchen board with nothing
 * on it and a profit-and-loss of all dashes demonstrate nothing — and they are
 * what a prospect sees on a freshly seeded install.
 *
 * Three properties matter more than volume:
 *
 *   * **Shape.** Orders cluster at lunch and dinner, thin out on weekday
 *     afternoons, and rise at the weekend, because a restaurant owner reads a
 *     revenue chart the way they read their own takings and a flat line tells
 *     them the numbers are fake.
 *   * **Spread.** Across both branches, all four channels and all three order
 *     types, so the filters on every screen have something to filter.
 *   * **Today.** A handful of orders left mid-flight — pending, preparing,
 *     ready, out for delivery — so the kitchen board and the pass are not
 *     empty during the one demo where somebody asks to see them.
 *
 * Deterministic: the same seed produces the same month, so a demo looks the
 * same on the second showing and a number quoted in a meeting is still there
 * afterwards.
 */

/** A tiny seeded generator — Mulberry32. Repeatable without a dependency. */
export function random(seed = 20261107) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Karachi names, because the demo is set in Karachi. */
export const CUSTOMERS = [
  { name: "Ayesha Siddiqui", email: "ayesha.siddiqui@example.com", phone: "+92 300 2345671" },
  { name: "Bilal Ahmed", email: "bilal.ahmed@example.com", phone: "+92 321 2345672" },
  { name: "Fatima Noor", email: "fatima.noor@example.com", phone: "+92 333 2345673" },
  { name: "Hassan Raza", email: "hassan.raza@example.com", phone: "+92 345 2345674" },
  { name: "Zainab Malik", email: "zainab.malik@example.com", phone: "+92 301 2345675" },
  { name: "Usman Tariq", email: "usman.tariq@example.com", phone: "+92 322 2345676" },
  { name: "Mehwish Khan", email: "mehwish.khan@example.com", phone: "+92 334 2345677" },
  { name: "Imran Qureshi", email: "imran.qureshi@example.com", phone: "+92 346 2345678" },
];

/** Walk-ins and phone orders have no account, only a name and a number. */
export const GUESTS = [
  { name: "Saad", phone: "+92 300 9001101" },
  { name: "Hira", phone: "+92 321 9001102" },
  { name: "Owais", phone: "+92 333 9001103" },
  { name: "Nida", phone: "+92 345 9001104" },
];

/**
 * How busy each hour is, relative to the rest. Zero means closed.
 *
 * Two peaks, because that is how a restaurant trades: a lunch rush around one
 * o'clock and a much larger dinner rush from eight, which in Karachi runs late.
 */
export const HOUR_WEIGHTS = [
  // 00  01  02  03  04  05  06  07  08  09  10  11
  2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3,
  // 12  13  14  15  16  17  18  19  20  21  22  23
  7, 9, 6, 3, 2, 3, 5, 8, 12, 13, 10, 5,
];

/** Weekends are busier. Friday evening most of all. */
export const DAY_MULTIPLIER = [0.85, 0.8, 0.85, 0.9, 1.0, 1.35, 1.25]; // Sun..Sat

/**
 * What people actually order together, so the basket looks like a basket.
 *
 * A burger with fries and a drink, a bucket for the family, wings to share.
 * Random items drawn from the whole menu would produce three desserts and a
 * salad, which is nobody's dinner.
 */
export const BASKETS = [
  { weight: 10, items: [["classic-beef-burger", 1], ["seasoned-fries", 1], ["soft-drink", 1]] },
  { weight: 12, items: [["zinger-crispy-burger", 1], ["seasoned-fries", 1], ["soft-drink", 1]] },
  { weight: 6, items: [["zinger-crispy-burger", 2], ["seasoned-fries", 2], ["mint-lemonade", 2]] },
  { weight: 5, items: [["double-cheese-burger", 1], ["seasoned-fries", 1]] },
  { weight: 4, items: [["tower-burger", 1], ["soft-drink", 1]] },
  { weight: 7, items: [["chicken-tikka-pizza", 1], ["soft-drink", 2]] },
  { weight: 5, items: [["pepperoni-pizza", 1], ["mint-lemonade", 1]] },
  { weight: 6, items: [["chicken-bucket", 1], ["seasoned-fries", 2], ["soft-drink", 3]] },
  { weight: 5, items: [["hot-wings", 1], ["seasoned-fries", 1], ["soft-drink", 1]] },
  { weight: 4, items: [["crispy-chicken-strips", 1], ["seasoned-fries", 1]] },
  { weight: 4, items: [["chicken-wrap", 1], ["soft-drink", 1]] },
  { weight: 3, items: [["club-sandwich", 1], ["mint-lemonade", 1]] },
  { weight: 3, items: [["creamy-pasta", 1], ["garden-salad", 1]] },
  { weight: 3, items: [["classic-beef-burger", 1], ["brownie-sundae", 1], ["soft-drink", 1]] },
  { weight: 2, items: [["chocolate-fudge-cake", 1], ["mint-lemonade", 1]] },
  { weight: 2, items: [["raspberry-cheesecake", 1], ["soft-drink", 1]] },
  { weight: 3, items: [["smoky-bbq-burger", 1], ["seasoned-fries", 1], ["soft-drink", 1]] },
  { weight: 2, items: [["chicken-tikka-pizza", 1], ["hot-wings", 1], ["soft-drink", 2]] },
];

/**
 * Channel and order type together, because they are not independent: nobody
 * places a dine-in order on the website, and a QR order is by definition at a
 * table.
 */
export const CHANNELS = [
  { weight: 30, channel: "WEB", type: "DELIVERY" },
  { weight: 12, channel: "MOBILE_APP", type: "DELIVERY" },
  { weight: 22, channel: "POS", type: "DINE_IN" },
  { weight: 14, channel: "QR", type: "DINE_IN" },
  { weight: 12, channel: "PHONE", type: "DELIVERY" },
  { weight: 10, channel: "POS", type: "PICKUP" },
];

/** Weighted pick from a list of `{ weight, ... }`. */
export function pick(rng, options) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  let roll = rng() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option;
  }
  return options[options.length - 1];
}
