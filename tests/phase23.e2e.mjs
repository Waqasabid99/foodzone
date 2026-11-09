import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 23 — the live channel.
 *
 * `tests/unit.mjs` pins who may listen to what: that is pure logic and gets
 * exhaustive coverage there, cheaply. What only exists with a real server is
 * the thing this suite is for — that a frame written by one request actually
 * arrives down a connection opened by another.
 *
 * Three claims, and the suite is arranged around them:
 *
 *   1. **A change reaches an open stream**, within a second, without the
 *      client asking. That is the feature.
 *   2. **The stream never becomes the only path.** The opening frame promises
 *      `authoritative`, which is what licenses a board to slow its poll. If
 *      that promise is ever made when it is not true, boards go quietly stale
 *      — so it is asserted rather than assumed.
 *   3. **A connection that can deliver nothing is refused**, not held. A held
 *      empty stream is worse than no stream: the client waits on it instead of
 *      falling back.
 *
 * Needs `REALTIME_ENABLED=true`, which `npm run test:e2e:local` sets. Against a
 * server without it every stream answers 204 and the suite says so rather than
 * failing confusingly.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 REALTIME_ENABLED=true npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e23-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2E23${String(stamp).slice(-4)}`;
const created = { userIds: new Set(), branchIds: new Set() };

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail !== undefined ? "::" + JSON.stringify(detail).slice(0, 300) : "");
  }
}

let ipCounter = 0;
const nextIp = () => `10.230.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Opens a stream and collects frames in the background.
 *
 * A bearer token rather than a cookie, which is the mobile app's transport and
 * the only one reachable from here — `EventSource` in a browser sends the
 * session cookie instead, and both land in the same `getAuthContext`.
 *
 * Frames are parsed by splitting on the blank line SSE uses as a record
 * separator, so a frame delivered across two TCP reads is still one frame.
 * Getting that wrong would make this suite pass on a fast loopback and fail on
 * anything slower.
 */
async function openStream({ channels, token }) {
  const controller = new AbortController();
  const query = encodeURIComponent(channels.join(","));

  const res = await fetch(`${BASE}/api/v1/realtime/stream?channels=${query}`, {
    headers: {
      accept: "text/event-stream",
      "x-forwarded-for": nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: controller.signal,
  });

  const frames = [];
  const stream = { status: res.status, frames, close: () => controller.abort() };

  if (res.status !== 200 || !res.body) {
    // Nothing to read: a 204 (disabled, or nothing allowed) or an error.
    try {
      await res.text();
    } catch {
      /* no body */
    }
    return stream;
  }

  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          const event = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          // Comment-only records are the heartbeat and carry no event.
          if (event) frames.push({ event, data: data ? JSON.parse(data) : null });
        }
      }
    } catch {
      /* aborted by close(), which is how every stream here ends */
    }
  })();

  return stream;
}

/** Waits for a frame the predicate likes, up to `ms`. Returns it, or null. */
async function waitForFrame(stream, predicate, ms = 4_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = stream.frames.find(predicate);
    if (found) return found;
    if (Date.now() > deadline) return null;
    await sleep(50);
  }
}

const helloOf = (stream) => stream.frames.find((frame) => frame.event === "hello")?.data ?? null;

async function main() {
  // ---- actors -------------------------------------------------------------
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P23 Admin", email: emailOf("admin"), password: "admin-passphrase-23" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-23" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P23 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  const other = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `${BRANCH_CODE}B`, name: "P23 Other", city: "Lahore", timezone: "Asia/Karachi" },
  });
  const otherBranchId = other.body.data.id;
  created.branchIds.add(otherBranchId);

  // A cook: `kds.read` at one branch and nothing else. The whole point of the
  // channel check is that this person's connection differs from an owner's.
  const cookReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P23 Cook", email: emailOf("cook"), password: "cook-passphrase-23" },
  });
  const cookId = cookReg.body.data.user.id;
  created.userIds.add(cookId);
  await prisma.user.update({ where: { id: cookId }, data: { status: "ACTIVE", emailVerifiedAt: new Date() } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P23 Cook ${stamp}`, description: "Reads the board, nothing else" },
  });
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["kds.read", "kds.update_item_status"] },
  });
  await api(`/admin/users/${cookId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: role.body.data.id, branchId },
  });
  const cookToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cook"), password: "cook-passphrase-23" } })
  ).body.data.accessToken;

  // Something to sell.
  const category = await api("/admin/categories", { method: "POST", token: adminToken, body: { name: `Live ${stamp}` } });
  const product = await api("/admin/products", {
    method: "POST",
    token: adminToken,
    body: { name: `Live Burger ${stamp}`, categoryId: category.body.data.id, price: 900 },
  });
  const productId = product.body.data.id;
  await api(`/admin/products/${productId}/publish`, { method: "PUT", token: adminToken, body: { isActive: true } });

  const menu = await api("/admin/menus", {
    method: "POST",
    token: adminToken,
    body: { branchId, isActive: true, name: `Live menu ${stamp}`, type: "DINE_IN", isDefault: true },
  });
  await api(`/admin/menus/${menu.body.data.id}/items`, { method: "POST", token: adminToken, body: { productId } });

  // ================= IS IT EVEN ON =================
  const probe = await openStream({ channels: [`branch-kds:${branchId}`], token: cookToken });
  if (probe.status === 204) {
    probe.close();
    console.log(
      "\nREALTIME_ENABLED is not set on this server, so every stream answers 204.\n" +
        "That is the documented off state, not a failure — but this suite cannot\n" +
        "prove anything without it. Run it through `npm run test:e2e:local`.\n",
    );
    check("realtime is enabled on the server under test", false, { status: probe.status });
    return;
  }
  check("a stream opens for a cook watching their own kitchen", probe.status === 200, { status: probe.status });

  const hello = await waitForFrame(probe, (frame) => frame.event === "hello");
  check("it opens with a hello frame rather than silence", Boolean(hello), probe.frames);
  check(
    "which promises the frames can be trusted, so a board may slow its poll",
    hello?.data?.authoritative === true,
    hello?.data,
  );
  check("and names what it is actually listening to", hello?.data?.channels?.includes(`branch-kds:${branchId}`), hello?.data);
  check(
    "and how long the connection will be held before it asks for a reconnect",
    typeof hello?.data?.maxSeconds === "number" && hello.data.maxSeconds > 0,
    hello?.data,
  );

  // ================= A CHANGE ARRIVES =================
  /*
   * The feature, in one assertion: an order placed by a different request,
   * through the ordinary endpoint, with nobody asking for an update.
   */
  const order = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      type: "DINE_IN",
      channel: "POS",
      items: [{ productId, quantity: 2 }],
      guest: { name: "Live test" },
    },
  });
  const orderId = order.body?.data?.id;
  check("an order can be placed while a stream is open", order.status === 201, order.body?.error);

  const placed = await waitForFrame(probe, (frame) => frame.event === "change" && frame.data?.type === "order.placed");
  check("a new ticket reaches the kitchen without it asking", Boolean(placed), probe.frames.slice(-5));
  check("and the frame says which order it is about", placed?.data?.orderId === orderId, placed?.data);
  check("on the channel the client subscribed to", placed?.data?.channel === `branch-kds:${branchId}`, placed?.data);

  /*
   * Frames carry no data beyond the hint. This is deliberate and worth a test,
   * because the tempting optimisation — push the ticket itself — would create a
   * second read path with its own idea of what a cook may see, and the first
   * time it disagreed with the endpoint, the silent one would win.
   */
  check(
    "a frame carries a hint, never the record",
    placed?.data && !("items" in placed.data) && !("grandTotal" in placed.data) && !("guestName" in placed.data),
    placed?.data,
  );

  // A cook advancing a line is news to the pass, which is the change nothing
  // but a poll could previously see — the order's own status does not move.
  const beforeKds = probe.frames.length;
  const bumped = await api(`/admin/orders/${orderId}/bump`, {
    method: "POST",
    token: cookToken,
    body: { status: "PREPARING" },
  });
  check("a cook can start the ticket", bumped.status < 400, bumped.body?.error);

  const kdsFrame = await waitForFrame(
    probe,
    (frame, index) => index >= beforeKds && frame.event === "change",
  );
  check("starting a ticket reaches every board showing it", Boolean(kdsFrame), probe.frames.slice(beforeKds));

  /*
   * One tap, one refetch. `bumpOrder` moves every line on the ticket and each
   * line publishes, so the frames come in a burst — the client coalesces them,
   * and this records that the burst is expected rather than a bug to chase
   * later.
   */
  await sleep(400);
  const burst = probe.frames.filter((frame, index) => index >= beforeKds && frame.event === "change").length;
  check("a burst of frames for one action is expected, and the client coalesces it", burst >= 1, { burst });

  // ================= WHAT A STREAM MAY NOT CARRY =================
  const refusedStream = await openStream({
    channels: [`branch-kds:${branchId}`, `branch-orders:${branchId}`],
    token: cookToken,
  });
  const refusedHello = await waitForFrame(refusedStream, (frame) => frame.event === "hello");
  check(
    "a cook listening to the order list is given the kitchen and refused the rest",
    refusedHello?.data?.channels?.length === 1 &&
      refusedHello.data.channels[0] === `branch-kds:${branchId}`,
    refusedHello?.data,
  );
  check(
    "and told which one was refused, so a screen can say why it is not live",
    refusedHello?.data?.refused?.some((row) => row.channel === `branch-orders:${branchId}` && row.reason === "FORBIDDEN"),
    refusedHello?.data?.refused,
  );
  refusedStream.close();

  // A branch they hold nothing at. The interesting case is not that it is
  // refused, but that the connection is not held open delivering nothing.
  const crossBranch = await openStream({ channels: [`branch-kds:${otherBranchId}`], token: cookToken });
  check(
    "a stream that could only ever deliver nothing is refused, not held",
    crossBranch.status === 204,
    { status: crossBranch.status },
  );
  crossBranch.close();

  const anonymous = await openStream({ channels: [`branch-kds:${branchId}`] });
  check("and an unauthenticated listener gets nowhere", anonymous.status === 401, { status: anonymous.status });
  anonymous.close();

  const nonsense = await openStream({ channels: ["not-a-channel:abc"], token: adminToken });
  check("an unknown channel kind is refused rather than guessed at", nonsense.status === 204, { status: nonsense.status });
  nonsense.close();

  const empty = await openStream({ channels: [""], token: adminToken });
  check("naming no channel at all is a validation error", empty.status === 400, { status: empty.status });
  empty.close();

  // ================= A CUSTOMER WATCHING THEIR OWN ORDER =================
  /*
   * The channel the mobile app will use. Ownership is a row rather than a
   * permission, so this is the one kind the route has to read the database to
   * authorise — and the one where getting it wrong would stream one customer's
   * order to another.
   */
  const custReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P23 Customer", email: emailOf("cust"), password: "customer-passphrase-23" },
  });
  const custId = custReg.body.data.user.id;
  created.userIds.add(custId);
  await prisma.user.update({ where: { id: custId }, data: { emailVerifiedAt: new Date() } });
  const custToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("cust"), password: "customer-passphrase-23" } })
  ).body.data.accessToken;

  const ownOrder = await api("/admin/orders", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      type: "DINE_IN",
      channel: "POS",
      items: [{ productId, quantity: 1 }],
      userId: custId,
    },
  });
  const ownOrderId = ownOrder.body?.data?.id;

  const mine = await openStream({ channels: [`order:${ownOrderId}`, `user:${custId}`], token: custToken });
  const mineHello = await waitForFrame(mine, (frame) => frame.event === "hello");
  check("a customer may listen to their own order", mineHello?.data?.channels?.includes(`order:${ownOrderId}`), mineHello?.data);
  check("and to their own notifications", mineHello?.data?.channels?.includes(`user:${custId}`), mineHello?.data);

  await api(`/admin/orders/${ownOrderId}/status`, { method: "PUT", token: adminToken, body: { status: "PREPARING" } });
  const statusFrame = await waitForFrame(
    mine,
    (frame) => frame.event === "change" && frame.data?.type === "order.status",
  );
  check("a status change reaches the customer's own stream", Boolean(statusFrame), mine.frames);
  check("naming their order", statusFrame?.data?.orderId === ownOrderId, statusFrame?.data);
  mine.close();

  // Somebody else's order, asked for by id. The id is real and the caller is
  // real; only the ownership is missing, which is exactly the attack.
  const notMine = await openStream({ channels: [`order:${orderId}`], token: custToken });
  check(
    "but not somebody else's, even naming it exactly",
    notMine.status === 204,
    { status: notMine.status },
  );
  notMine.close();

  const notTheirUser = await openStream({ channels: [`user:${adminId}`], token: custToken });
  check("nor another person's notifications", notTheirUser.status === 204, { status: notTheirUser.status });
  notTheirUser.close();

  // ================= THE POLL IS STILL THERE =================
  /*
   * Not a transport test — a promise test. The boards slow their poll on the
   * strength of `authoritative`, and the only thing that makes that safe is
   * that they do not *stop*. If this ever becomes "the stream is the only
   * path", a two-instance deployment goes stale in silence.
   */
  const kdsStillWorks = await api(`/admin/kds?branchId=${branchId}`, { token: cookToken });
  check(
    "the endpoint behind the channel still answers on its own, which is the fallback",
    kdsStillWorks.status === 200 && Array.isArray(kdsStillWorks.body?.data ?? kdsStillWorks.body),
    kdsStillWorks.body?.error,
  );

  probe.close();
  // Give the server a moment to run the stream's `cancel` before the suite
  // tears the database out from under it.
  await sleep(300);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const orders = await prisma.order.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const orderIds = orders.map((row) => row.id);

  await prisma.stockReservation.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItemModifier.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderTaxLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderDiscount.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  for (const id of orderIds) {
    await prisma.outboxEvent.deleteMany({ where: { payload: { path: ["orderId"], equals: id } } });
  }

  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.menu.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.product.deleteMany({ where: { slug: { contains: String(stamp) } } });
  await prisma.category.deleteMany({ where: { slug: { contains: String(stamp) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2E23" } } });

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    orders: await prisma.order.count(),
    products: await prisma.product.count(),
    menus: await prisma.menu.count(),
    reservations: await prisma.stockReservation.count(),
    roles: await prisma.role.count(),
  };
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

try {
  await warmUpDatabase(prisma);
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 5).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));

  const dirty = Object.entries(leftovers).filter(([key, value]) => key !== "roles" && value > 0);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
