/**
 * What each person sees in the sidebar.
 *
 * Driven by **permissions, not roles**, and that distinction is the whole
 * design. Roles are database rows: the twenty seeded ones are a starting point,
 * an administrator can author more, and a grant can be pinned to a single
 * branch — so a user may be a manager at one outlet and a cashier at another.
 * A sidebar that switched on `role === "branch-manager"` would be wrong the
 * first time someone made a custom role, and silently wrong forever after.
 * Asking "may this person read orders?" is the same question the API asks
 * before it answers, so the two can never disagree.
 *
 * This file is pure data plus one filter, with no React and no API client, so
 * the rules can be tested directly — including that every key named here really
 * exists in the permission catalogue, which is the one mistake that would hide
 * a section from everybody without ever raising an error.
 *
 * Hiding is not access control. The server checks permissions again on every
 * page and every request; this only decides what is worth showing, so that a
 * cashier is not made to scroll past fifty things they cannot open.
 */

/**
 * The staff dashboard.
 *
 * Ordered by how often a working day touches them, not alphabetically or by
 * seniority: service first because that is where a shift is spent, then the
 * menu, then the back office.
 */
export const DASHBOARD_NAV = [
  {
    id: "overview",
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", permission: "dashboard.view", exact: true }],
  },
  {
    id: "service",
    label: "Service",
    items: [
      { label: "Orders", href: "/dashboard/orders", icon: "ReceiptText", permission: "orders.read" },
      { label: "Kitchen", href: "/dashboard/kitchen", icon: "ChefHat", permission: "kds.read" },
      { label: "The pass", href: "/dashboard/pass", icon: "HandPlatter", permission: "kds.read" },
      { label: "Tables", href: "/dashboard/tables", icon: "Armchair", permission: "tables.read" },
      { label: "QR codes", href: "/dashboard/qr-codes", icon: "QrCode", permission: "qr_codes.read" },
      { label: "Live carts", href: "/dashboard/carts", icon: "ShoppingCart", permission: "carts.read" },
    ],
  },
  {
    id: "delivery",
    label: "Delivery",
    items: [
      { label: "Dispatch", href: "/dashboard/dispatch", icon: "Radar", permission: "deliveries.read" },
      { label: "Deliveries", href: "/dashboard/deliveries", icon: "Bike", permission: "deliveries.read" },
      { label: "Drivers", href: "/dashboard/drivers", icon: "IdCard", permission: "drivers.read" },
      { label: "Driver payouts", href: "/dashboard/driver-payouts", icon: "HandCoins", permission: "driver_payouts.read" },
    ],
  },
  {
    id: "menu",
    label: "Menu",
    items: [
      { label: "Menus", href: "/dashboard/menus", icon: "BookOpen", permission: "menus.read" },
      { label: "Categories", href: "/dashboard/categories", icon: "FolderTree", permission: "categories.read" },
      { label: "Products", href: "/dashboard/products", icon: "Sandwich", permission: "products.read" },
      { label: "Modifiers", href: "/dashboard/modifiers", icon: "SlidersHorizontal", permission: "modifiers.read" },
      { label: "Combos", href: "/dashboard/combos", icon: "Layers", permission: "combos.read" },
      { label: "Stations", href: "/dashboard/stations", icon: "CookingPot", permission: "kitchen_stations.read" },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    items: [
      { label: "Customers", href: "/dashboard/customers", icon: "Users", permission: "customers.read" },
      { label: "Reviews", href: "/dashboard/reviews", icon: "Star", permission: "reviews.read" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    items: [
      { label: "Promotions", href: "/dashboard/promotions", icon: "Percent", permission: "promotions.read" },
      { label: "Coupons", href: "/dashboard/coupons", icon: "Ticket", permission: "coupons.read" },
      { label: "Creators", href: "/dashboard/creators", icon: "Sparkles", permission: "creators.read" },
      { label: "Creator videos", href: "/dashboard/creator-videos", icon: "Video", permission: "creator_videos.read" },
      {
        label: "Commission rules",
        href: "/dashboard/commission-rules",
        icon: "Scale",
        permission: "creator_commission_rules.read",
      },
      { label: "Creator earnings", href: "/dashboard/creator-earnings", icon: "Wallet", permission: "creator_earnings.read" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { label: "Stock", href: "/dashboard/stock", icon: "Boxes", permission: "stock.read" },
      { label: "Items", href: "/dashboard/inventory-items", icon: "Package", permission: "inventory_items.read" },
      { label: "Movements", href: "/dashboard/stock-movements", icon: "ArrowLeftRight", permission: "stock_movements.read" },
      { label: "Adjustments", href: "/dashboard/stock-adjustments", icon: "PencilRuler", permission: "stock_adjustments.read" },
      { label: "Transfers", href: "/dashboard/stock-transfers", icon: "Truck", permission: "stock_transfers.read" },
      { label: "Stock counts", href: "/dashboard/stock-counts", icon: "ClipboardCheck", permission: "stock_counts.read" },
      { label: "Wastage", href: "/dashboard/wastage", icon: "Trash2", permission: "wastage.read" },
      { label: "Recipes", href: "/dashboard/recipes", icon: "NotebookPen", permission: "recipes.read" },
      { label: "Production", href: "/dashboard/production", icon: "Factory", permission: "production_orders.read" },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing",
    items: [
      { label: "Suppliers", href: "/dashboard/suppliers", icon: "Building2", permission: "suppliers.read" },
      { label: "Purchase orders", href: "/dashboard/purchase-orders", icon: "FileText", permission: "purchase_orders.read" },
      { label: "Goods receipts", href: "/dashboard/goods-receipts", icon: "PackageCheck", permission: "goods_receipts.read" },
      { label: "Supplier bills", href: "/dashboard/supplier-bills", icon: "FileSpreadsheet", permission: "supplier_bills.read" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { label: "Payments", href: "/dashboard/payments", icon: "CreditCard", permission: "payments.read" },
      { label: "Refunds", href: "/dashboard/refunds", icon: "Undo2", permission: "refunds.read" },
      { label: "Invoices", href: "/dashboard/invoices", icon: "Receipt", permission: "invoices.read" },
      { label: "Registers", href: "/dashboard/registers", icon: "Calculator", permission: "cash_registers.read" },
      { label: "Expenses", href: "/dashboard/expenses", icon: "Banknote", permission: "expenses.read" },
      { label: "Chart of accounts", href: "/dashboard/accounts", icon: "Landmark", permission: "accounts.read" },
      { label: "Journal", href: "/dashboard/journal", icon: "BookMarked", permission: "journal_entries.read" },
      { label: "Periods", href: "/dashboard/periods", icon: "CalendarRange", permission: "accounting_periods.read" },
      { label: "Taxes", href: "/dashboard/taxes", icon: "Scale", permission: "taxes.read" },
      {
        label: "Financial reports",
        href: "/dashboard/financial-reports",
        icon: "ChartNoAxesCombined",
        anyOf: [
          "financial_reports.view_pnl",
          "financial_reports.view_balance_sheet",
          "financial_reports.view_trial_balance",
          "financial_reports.view_cash_flow",
        ],
      },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      { label: "Employees", href: "/dashboard/employees", icon: "Contact", permission: "employees.read" },
      { label: "Departments", href: "/dashboard/departments", icon: "Network", permission: "departments.read" },
      { label: "Shifts", href: "/dashboard/shifts", icon: "Clock", permission: "shifts.read" },
      { label: "Rosters", href: "/dashboard/rosters", icon: "CalendarDays", permission: "rosters.read" },
      { label: "Attendance", href: "/dashboard/attendance", icon: "Fingerprint", permission: "attendance.read" },
      { label: "Terminals", href: "/dashboard/devices", icon: "ScanFace", permission: "attendance_devices.read" },
      { label: "Leave", href: "/dashboard/leave", icon: "Plane", permission: "leave_requests.read" },
      { label: "Holidays", href: "/dashboard/holidays", icon: "PartyPopper", permission: "holidays.read" },
      { label: "Payroll", href: "/dashboard/payroll", icon: "Coins", permission: "payroll.read" },
      { label: "Payslips", href: "/dashboard/payslips", icon: "FileBadge", permission: "payslips.read" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      {
        label: "Reports",
        href: "/dashboard/reports",
        icon: "ChartColumn",
        anyOf: [
          "reports.view_sales",
          "reports.view_inventory",
          "reports.view_delivery",
          "reports.view_hr",
          "reports.view_creator",
        ],
      },
      { label: "Audit log", href: "/dashboard/audit-log", icon: "ScrollText", permission: "audit_logs.read" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      { label: "Branches", href: "/dashboard/branches", icon: "Store", permission: "branches.read" },
      { label: "Users", href: "/dashboard/users", icon: "UserCog", permission: "users.read" },
      { label: "Roles", href: "/dashboard/roles", icon: "ShieldCheck", permission: "roles.read" },
      { label: "Media", href: "/dashboard/media", icon: "Image", anyOf: ["media.upload", "media.delete"] },
      { label: "Home banners", href: "/dashboard/hero", icon: "GalleryHorizontal", permission: "hero_slides.read" },
      { label: "Public pages", href: "/dashboard/pages", icon: "FileText", permission: "content_pages.read" },
      { label: "Notifications", href: "/dashboard/notifications", icon: "Bell", permission: "notifications.read" },
      { label: "Payment callbacks", href: "/dashboard/payment-webhooks", icon: "Webhook", permission: "payment_webhooks.read" },
      { label: "Payment gateways", href: "/dashboard/payment-gateways", icon: "CreditCard", permission: "payment_providers.read" },
      { label: "Numbering", href: "/dashboard/numbering", icon: "Hash", permission: "number_sequences.read" },
      { label: "Settings", href: "/dashboard/settings", icon: "Settings", permission: "settings.read" },
    ],
  },
];

/**
 * A customer's own area.
 *
 * Separate from the staff tree rather than a filtered view of it: a customer is
 * not a member of staff with fewer permissions, they are a different person
 * using a different product. Sharing one tree would mean every staff section
 * had to be written so that it degraded into something a customer should see,
 * which is a constraint with no upside.
 */
export const ACCOUNT_NAV = [
  {
    id: "account",
    label: "My account",
    items: [
      { label: "Orders", href: "/account", icon: "ReceiptText", permission: "self.view_own_orders", exact: true },
      { label: "Addresses", href: "/account/addresses", icon: "MapPin", permission: "self.manage_addresses" },
      { label: "Reviews", href: "/account/reviews", icon: "Star", permission: "self.review_own_order" },
      { label: "Profile", href: "/account/profile", icon: "User", permission: "self.view_profile" },
      { label: "Notifications", href: "/account/notifications", icon: "Bell", permission: "self.manage_notifications" },
      { label: "Devices", href: "/account/devices", icon: "Smartphone", permission: "self.manage_devices" },
    ],
  },
  {
    id: "creator",
    label: "Creator",
    items: [
      {
        label: "Creator studio",
        href: "/account/creator",
        icon: "Sparkles",
        /**
         * Either permission, because this one link does two jobs. A creator
         * holds `view_creator_dashboard`; somebody who could *become* one
         * holds only `become_creator`. Requiring the first hid the programme
         * from exactly the people it is for — the page that invites you to
         * join was reachable only once you had joined.
         */
        anyOf: ["self.view_creator_dashboard", "self.become_creator"],
      },
      { label: "My videos", href: "/account/creator/videos", icon: "Video", permission: "self.manage_own_videos" },
    ],
  },
];

/**
 * Whether a granted set covers one key.
 *
 * `"*"` is how the API reports a super admin — it holds everything by bypass
 * rather than by grant, so there is no list to enumerate. Module wildcards are
 * accepted too: the seed expands `"orders.*"` into real rows before storing it,
 * so a grant should never arrive in that shape, but reading one correctly costs
 * a line and misreading one would hide a whole section.
 */
export function hasPermission(granted, key) {
  if (!key) return true;
  if (!granted) return false;

  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has("*")) return true;
  if (set.has(key)) return true;

  const moduleKey = key.slice(0, key.indexOf("."));
  return moduleKey ? set.has(`${moduleKey}.*`) : false;
}

/** Whether one nav item should be shown. */
export function canSeeItem(item, granted) {
  if (item.anyOf) return item.anyOf.some((key) => hasPermission(granted, key));
  return hasPermission(granted, item.permission);
}

/**
 * The tree this person actually sees.
 *
 * Sections with nothing left in them are dropped rather than rendered empty: a
 * heading with no links under it reads as something that failed to load.
 */
export function visibleNav(nav, granted) {
  const set = granted instanceof Set ? granted : new Set(granted ?? []);

  return nav
    .map((section) => ({ ...section, items: section.items.filter((item) => canSeeItem(item, set)) }))
    .filter((section) => section.items.length > 0);
}

/** How many links a person would see — used to tell "no access" from "loading". */
export function navItemCount(nav, granted) {
  return visibleNav(nav, granted).reduce((total, section) => total + section.items.length, 0);
}

/**
 * Which link the current path is on.
 *
 * Longest match wins, so `/dashboard/stock-transfers` highlights Transfers
 * rather than Stock. Items marked `exact` only match their own path — without
 * it `/dashboard` would stay highlighted on every page beneath it.
 */
export function activeHref(nav, pathname) {
  if (!pathname) return null;

  let best = null;

  for (const section of nav) {
    for (const item of section.items) {
      const matches = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

      if (matches && (!best || item.href.length > best.length)) best = item.href;
    }
  }

  return best;
}

/**
 * Where to send someone who arrives without a page in mind.
 *
 * Not everyone with dashboard access holds `dashboard.view`: a driver can read
 * deliveries but has no business seeing company-wide summary widgets, so the
 * overview is not their home — their first visible link is. Sending them to a
 * page they cannot open and calling it a permission error would be the system's
 * mistake reported as theirs.
 */
export function firstNavHref(nav, granted) {
  const [section] = visibleNav(nav, granted);
  return section?.items[0]?.href ?? null;
}

/**
 * Where the storefront header should offer to send a signed-in visitor.
 *
 * Returns both links when both apply, and that is deliberate rather than a
 * fallthrough: a member of staff ordering lunch from their own restaurant is
 * still a customer, with their own addresses and their own receipts. Only the
 * seniority of the two changes — staff lead with the dashboard, everyone else
 * has only the account area to go to.
 *
 * Each link points at the first page that person can actually open, not at a
 * fixed root. A driver holds no `dashboard.view`, so sending them to the
 * overview would be offering a door that is locked from the inside.
 */
export function workspaceLinks(granted) {
  const links = [];

  const staffHref = firstNavHref(DASHBOARD_NAV, granted);
  if (staffHref) links.push({ href: staffHref, label: "Dashboard", icon: "LayoutDashboard" });

  const accountHref = firstNavHref(ACCOUNT_NAV, granted);
  if (accountHref) links.push({ href: accountHref, label: "My account", icon: "UserRound" });

  return links;
}
