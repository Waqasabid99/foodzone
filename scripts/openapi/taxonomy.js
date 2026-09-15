/**
 * How endpoints are grouped and named in the OpenAPI document.
 *
 * Nothing here changes behaviour — it is presentation only. It lives apart from
 * the generator so that adding a resource means editing a table, not a
 * traversal.
 */

/** Tag order in the document, with the blurb shown under each heading. */
export const TAGS = [
  ["Auth", "Registration, login, tokens, email verification and session management."],
  ["Profile", "The signed-in customer's own account, addresses, orders, reviews and devices."],
  ["Catalog (public)", "The storefront read surface: categories, products, search and the branch menu."],
  ["Dine-in", "QR scans and short links that seat a guest at a table."],
  ["Cart", "The guest or customer basket, its context and coupons."],
  ["Checkout", "Quoting and placing an order."],
  ["Orders", "Customer order tracking."],
  ["Creator program", "Public video surfaces and the creator's own studio, wallet and earnings."],
  ["Media", "Direct-to-provider upload tickets and file delivery."],
  ["Identity & access", "Users, roles, permissions, invitations and the audit trail."],
  ["Platform", "Branches, settings, notifications and devices."],
  ["Catalog administration", "Categories, products, variants, modifiers, combos, menus and kitchen stations."],
  ["Dine-in administration", "Tables and QR codes."],
  ["Order operations", "Staff order handling, the kitchen display and reviews."],
  ["Pricing & discounts", "Tax groups and rates, promotions, coupons and manual discounts."],
  ["Payments", "Payments, refunds, cash registers and acquirer webhooks."],
  ["Delivery", "Drivers, dispatch, deliveries and driver payouts."],
  ["Inventory", "Items, stock, batches, transfers, counts, adjustments and wastage."],
  ["Procurement", "Suppliers, purchase orders, goods receipts and supplier bills."],
  ["Production", "Recipes, costing and production orders."],
  ["Finance", "Chart of accounts, fiscal calendar, journal, payables and expenses."],
  ["HR & attendance", "Employees, shifts, roster, punches, leave and payroll."],
  ["Reports", "Financial and operational reporting."],
  ["Creator administration", "Program configuration, video review, commissions, earnings and strikes."],
  ["Internal jobs", "Scheduler-triggered maintenance. Authorised by a shared secret, not a user session."],
];

/** Admin resource segment -> tag. */
const ADMIN_TAGS = {
  users: "Identity & access",
  roles: "Identity & access",
  permissions: "Identity & access",
  invitations: "Identity & access",
  "audit-logs": "Identity & access",

  branches: "Platform",
  settings: "Platform",
  notifications: "Platform",

  categories: "Catalog administration",
  products: "Catalog administration",
  "modifier-groups": "Catalog administration",
  combos: "Catalog administration",
  menus: "Catalog administration",
  "kitchen-stations": "Catalog administration",
  catalog: "Catalog administration",

  tables: "Dine-in administration",
  "qr-codes": "Dine-in administration",

  orders: "Order operations",
  kds: "Order operations",
  reviews: "Order operations",
  invoices: "Order operations",

  "tax-groups": "Pricing & discounts",
  "tax-rates": "Pricing & discounts",
  promotions: "Pricing & discounts",
  coupons: "Pricing & discounts",
  discounts: "Pricing & discounts",

  payments: "Payments",
  refunds: "Payments",
  registers: "Payments",
  "payment-webhooks": "Payments",

  drivers: "Delivery",
  deliveries: "Delivery",
  dispatch: "Delivery",
  "driver-payouts": "Delivery",

  units: "Inventory",
  "inventory-items": "Inventory",
  "inventory-categories": "Inventory",
  stock: "Inventory",
  "stock-adjustments": "Inventory",
  "stock-batches": "Inventory",
  "stock-counts": "Inventory",
  "stock-locations": "Inventory",
  "stock-transfers": "Inventory",
  wastage: "Inventory",

  suppliers: "Procurement",
  "purchase-orders": "Procurement",
  "goods-receipts": "Procurement",
  "supplier-bills": "Procurement",

  recipes: "Production",
  "production-orders": "Production",

  accounts: "Finance",
  "accounting-periods": "Finance",
  "fiscal-years": "Finance",
  "journal-entries": "Finance",
  expenses: "Finance",
  "expense-categories": "Finance",

  employees: "HR & attendance",
  departments: "HR & attendance",
  shifts: "HR & attendance",
  roster: "HR & attendance",
  attendance: "HR & attendance",
  "attendance-devices": "HR & attendance",
  "attendance-punches": "HR & attendance",
  "leave-types": "HR & attendance",
  "leave-requests": "HR & attendance",
  "leave-balances": "HR & attendance",
  "payroll-periods": "HR & attendance",
  payslips: "HR & attendance",
  holidays: "HR & attendance",

  reports: "Reports",
};

/** Public / customer-facing first segment -> tag. */
const PUBLIC_TAGS = {
  auth: "Auth",
  addresses: "Profile",
  categories: "Catalog (public)",
  products: "Catalog (public)",
  search: "Catalog (public)",
  branches: "Catalog (public)",
  settings: "Catalog (public)",
  cart: "Cart",
  checkout: "Checkout",
  coupons: "Cart",
  orders: "Orders",
  qr: "Dine-in",
  s: "Dine-in",
  media: "Media",
  webhooks: "Payments",
  devices: "HR & attendance",
  creators: "Creator program",
  "creator-videos": "Creator program",
};

export function tagFor(segments) {
  // segments: path split, e.g. ["v1", "admin", "products", "{id}"]
  if (segments[0] === "internal") return "Internal jobs";

  const [, first, second] = segments;

  if (first === "admin") {
    if (second?.startsWith("creator")) return "Creator administration";
    return ADMIN_TAGS[second] ?? "Platform";
  }

  if (first === "me") {
    if (second === "creator") return "Creator program";
    if (second === "driver") return "Delivery";
    if (second === "payslips") return "HR & attendance";
    return "Profile";
  }

  return PUBLIC_TAGS[first] ?? "Platform";
}

/** Path segments whose display phrase the general rules cannot produce. */
export const PHRASE = {
  kds: "kitchen display",
  qr: "QR code",
  "qr-codes": "QR codes",
  s: "short link",
  me: "profile",
};

/** Words the general singular rule gets wrong, including those already singular. */
export const SINGULAR = {
  menus: "menu",
  status: "status",
  analytics: "analytics",
  terms: "terms",
  settings: "settings",
};

/**
 * Leaf segments that name an action rather than a resource.
 *
 * The distinction cannot be inferred — `review` is a verb under an id and a
 * noun as a collection — so it is stated. A segment missing from here is
 * treated as a noun, which reads oddly rather than wrongly, and can be fixed
 * either by adding it or by an entry in `SUMMARY_OVERRIDES`.
 */
export const ACTION_SEGMENTS = new Set([
  "accept", "activate", "adjust", "approve", "archive", "assign", "backfill", "bump", "cancel",
  "capture", "clone", "change", "claim", "close", "collect", "complete", "confirm", "consume", "correct",
  "derive", "dispatch", "feature", "forgot", "freeze", "generate", "handover-code", "invite", "like", "lock",
  "login", "logout", "mark-paid", "open", "pay", "plan", "post", "publish", "read", "rebuild",
  "receive", "recost", "reinstate", "reject", "reconcile", "reopen", "reorder", "replay", "report",
  "resend", "reset", "restore", "reverse", "revert", "revise", "review", "revoke", "rotate-key",
  "seen", "send", "share", "simulate", "start", "submit", "takedown", "track", "unassign",
  "validate", "verify", "view", "void", "write-off",
]);

/** Segments that are a module root, not a resource an action can be applied to. */
export const ROOT_SEGMENTS = new Set(["auth", "admin", "me", "internal", "jobs", "v1"]);

/**
 * Summaries the path shape cannot produce a good sentence for.
 *
 * The generator fails if an entry here no longer matches a route, so this table
 * cannot rot silently.
 */
export const SUMMARY_OVERRIDES = {
  "POST /api/v1/auth/login": "Log in",
  "POST /api/v1/auth/logout": "Log out",
  "POST /api/v1/auth/register": "Register a customer account",
  "POST /api/v1/auth/refresh": "Refresh the access token",
  "POST /api/v1/auth/password/forgot": "Request a password reset",
  "POST /api/v1/auth/email/verify/resend": "Resend the email verification code",
  "GET /api/v1/auth/me": "Get the signed-in principal",
  "GET /api/v1/me": "Get my profile",
  "PATCH /api/v1/me": "Update my profile",
  "POST /api/v1/addresses/{id}/default": "Make an address the default",
  "PUT /api/v1/cart/context": "Set the cart context",
  "POST /api/v1/cart/coupon": "Apply a coupon to the cart",
  "DELETE /api/v1/cart/coupon": "Remove the coupon from the cart",
  "POST /api/v1/checkout": "Place an order",
  "POST /api/v1/checkout/quote": "Quote the cart before checkout",
  "POST /api/v1/coupons/validate": "Validate a coupon code",
  "POST /api/v1/me/notifications/read": "Mark notifications as read",
  "GET /api/v1/settings/public": "Get the public settings",
  "POST /api/v1/webhooks/payments/{provider}": "Receive a payment provider webhook",
  "GET /api/v1/s/{code}": "Follow a short link",
  "GET /api/v1/qr/{code}": "Scan a QR code",
  "POST /api/v1/admin/creator-program/terms": "Publish a new version of the creator terms",
  "POST /api/v1/admin/attendance-punches/manual": "Record a punch by hand",
  "GET /api/v1/admin/attendance-punches/unmatched": "List punches that matched no shift",

  // Endpoints whose leaf segment names neither a resource nor a plain action.
  "GET /api/v1/search": "Search the catalogue",
  "GET /api/v1/admin/attendance": "List attendance days",
  "GET /api/v1/admin/attendance/summary": "Get an attendance summary",
  "GET /api/v1/admin/attendance-devices/health": "Get attendance device health",
  "GET /api/v1/admin/accounts/tree": "Get the chart of accounts as a tree",
  "GET /api/v1/admin/journal-entries/audit": "Audit the ledger for imbalance",
  "GET /api/v1/admin/dispatch": "Get the dispatch board",
  "GET /api/v1/admin/expenses/summary": "Get an expense summary",
  "GET /api/v1/admin/kds/summary": "Get a kitchen display summary",
  "GET /api/v1/admin/reports/summary": "Get the reporting summary",
  "GET /api/v1/admin/reports/delivery": "Get the delivery report",
  "GET /api/v1/admin/reports/inventory": "Get the inventory report",
  "GET /api/v1/admin/modifier-groups/cost-report": "Get the modifier cost report",
  "GET /api/v1/admin/production-orders/variance": "Get production variance",
  "GET /api/v1/admin/recipes/menu-cost": "Get menu costing across products",
  "GET /api/v1/admin/stock/valuation": "Get stock valuation",
  "GET /api/v1/admin/stock/usage-variance": "Get theoretical against actual usage",
  "GET /api/v1/admin/stock-batches/expiring": "List batches nearing expiry",
  "GET /api/v1/admin/stock-transfers/in-transit": "List transfers in transit",
  "GET /api/v1/admin/supplier-bills/ageing": "Get supplier bill ageing",
  "POST /api/v1/admin/supplier-bills/from-receipt/{goodsReceiptId}": "Raise a supplier bill from a goods receipt",
  "GET /api/v1/admin/qr-codes/analytics": "Get QR code analytics",
  "GET /api/v1/admin/qr-codes/{id}/image": "Download a QR code image",
  "GET /api/v1/admin/purchase-orders/{id}/outstanding": "Get the outstanding quantities of a purchase order",
  "GET /api/v1/admin/creator-earnings/summary": "Get a creator earnings summary",
  "GET /api/v1/admin/creator-program/config": "Get the creator program configuration",
  "GET /api/v1/admin/creator-program/overview": "Get the creator program overview",
  "GET /api/v1/admin/creator-program/terms": "Get the current creator terms",
  "GET /api/v1/admin/creator-videos/queue": "List videos awaiting review",
  "POST /api/v1/admin/roster": "Assign a shift to an employee",
  "GET /api/v1/admin/wastage": "List wastage records",
  "POST /api/v1/admin/wastage": "Record wastage",
  "POST /api/v1/admin/tables/bulk": "Create tables in bulk",
  "GET /api/v1/admin/catalog/export": "Export part of the catalog as CSV",
  "POST /api/v1/admin/catalog/import": "Import catalog records from a CSV",
  "GET /api/v1/admin/catalog/format": "Describe the catalog CSV columns",

  // The signed-in caller's own surfaces, where "the" reads as someone else's.
  "GET /api/v1/me/creator": "Get my creator profile",
  "POST /api/v1/me/creator": "Join the creator program",
  "GET /api/v1/me/creator/appreciation": "Get my appreciation feed",
  "GET /api/v1/me/creator/eligibility": "Check whether I may join the creator program",
  "GET /api/v1/me/creator/filmable": "List order items I am allowed to film",
  "GET /api/v1/me/creator/performance": "Get my creator performance",
  "GET /api/v1/me/creator/wallet": "Get my creator wallet",
  "GET /api/v1/me/creator/wallet/redeemable": "Get my redeemable store credit",
  "GET /api/v1/me/driver": "Get my driver profile",
  "POST /api/v1/me/driver/location": "Report my current location",
  "POST /api/v1/me/driver/shift": "Start my driver shift",
  "DELETE /api/v1/me/driver/shift": "End my driver shift",
  "GET /api/v1/me/notifications/unread-count": "Count my unread notifications",
  "GET /api/v1/orders/track/{orderNumber}/delivery": "Track the delivery of an order",

  // Bulk or report variants that collide with, or read worse than, the
  // per-record operation the same words would otherwise describe.
  "GET /api/v1/admin/stock/levels": "List stock levels",
  "GET /api/v1/admin/stock/movements": "List stock movements",
  "GET /api/v1/admin/stock/reorder": "List items below their reorder point",
  "POST /api/v1/admin/stock/rebuild": "Rebuild stock levels from the ledger",
  "GET /api/v1/admin/recipes/versions": "List recipe versions",
  "POST /api/v1/admin/recipes/recost": "Recost every recipe",
  "GET /api/v1/admin/reports/sales": "Get the sales report",
  "GET /api/v1/admin/tables/areas": "List table areas",
  "DELETE /api/v1/admin/roster/assignment": "Remove a shift assignment",
  "PATCH /api/v1/admin/promotions/{id}/active": "Activate or deactivate a promotion",
  "POST /api/v1/admin/orders/{id}/invoice": "Issue an invoice for an order",
  "POST /api/v1/admin/production-orders/{id}/consume": "Record consumption against a production order",
  "POST /api/v1/admin/payroll-periods/{id}/mark-paid": "Mark a payroll period paid",
  "PUT /api/v1/admin/accounts/{id}/active": "Activate or deactivate an account",
  "GET /api/v1/admin/accounts/verify": "Check the chart of accounts for problems",
  "PATCH /api/v1/admin/attendance/{id}/correct": "Correct an attendance day",
  "POST /api/v1/admin/attendance/{id}/revert": "Revert a corrected attendance day",
  "POST /api/v1/admin/attendance/approve": "Approve attendance days",
  "POST /api/v1/admin/attendance/derive": "Derive attendance days from punches",
  "POST /api/v1/admin/attendance-devices/{id}/rotate-key": "Rotate an attendance device's API key",
  "GET /api/v1/admin/audit-logs/actions": "List the audited action names",
  "PUT /api/v1/admin/categories/reorder": "Reorder categories",
  "POST /api/v1/admin/coupons/generate": "Generate coupon codes",
  "POST /api/v1/admin/coupons/revoke": "Revoke coupon codes",
  "POST /api/v1/admin/creator-commission-rules/simulate": "Simulate which rule would pay a line",
  "PATCH /api/v1/admin/creator-program/config": "Update the creator program configuration",
  "POST /api/v1/admin/creators/{id}/wallet/adjust": "Adjust a creator wallet by hand",
  "PUT /api/v1/admin/creators/{id}/wallet/freeze": "Freeze or unfreeze a creator wallet",
  "POST /api/v1/admin/creator-videos/{id}/takedown": "Take down a creator video",
  "POST /api/v1/admin/deliveries/{id}/handover-code": "Issue a handover code for a delivery",
  "GET /api/v1/admin/wastage/report": "Get the wastage report",

  // Customer surfaces where the generic phrasing is ambiguous or impersonal.
  "DELETE /api/v1/auth/sessions": "Revoke every other session",
  "POST /api/v1/cart/items": "Add an item to the cart",
  "PATCH /api/v1/cart/items/{itemId}": "Update a cart item",
  "DELETE /api/v1/cart/items/{itemId}": "Remove an item from the cart",
  "GET /api/v1/media": "List media assets",
  "GET /api/v1/media/{id}": "Get a media asset",
  "PATCH /api/v1/media/{id}": "Update a media asset",
  "DELETE /api/v1/media/{id}": "Delete a media asset",
  "POST /api/v1/media/uploads": "Request an upload ticket",
  "PUT /api/v1/media/local/{ticket}": "Upload a file against a local-driver ticket",
  "GET /api/v1/orders/track/{orderNumber}": "Track an order by its number",
  "POST /api/v1/devices/punches": "Record a punch from an attendance device",
  "PATCH /api/v1/me/creator": "Update my creator profile",
  "POST /api/v1/me/creator/appreciation/seen": "Mark appreciation messages as seen",
  "GET /api/v1/me/creator/earnings": "List my earnings",
  "GET /api/v1/me/creator/videos": "List my videos",
  "POST /api/v1/me/creator/videos": "Create a video draft",
  "GET /api/v1/me/creator/videos/{id}": "Get one of my videos",
  "POST /api/v1/me/creator/videos/{id}/archive": "Archive one of my videos",
  "PUT /api/v1/me/creator/videos/{id}/asset": "Attach the uploaded file to one of my videos",
  "GET /api/v1/me/creator/videos/{id}/stats": "Get statistics for one of my videos",
  "POST /api/v1/me/creator/videos/{id}/submit": "Submit one of my videos for review",
  "PUT /api/v1/me/driver/availability": "Set my availability",
  "GET /api/v1/me/driver/deliveries": "List the deliveries assigned to me",
  "GET /api/v1/me/orders/{id}/pay": "List the payments against my order",
  "POST /api/v1/me/orders/{id}/pay": "Pay for my order",
};
