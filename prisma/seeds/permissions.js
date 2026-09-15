// The complete permission catalogue.
//
// These rows are the system's vocabulary of authority. They are seeded with
// isSystem = true and must never be creatable, renamable or deletable through
// the admin UI — admins compose them into roles, nothing more. Adding a new
// capability to the product means adding it here and re-running the seed.
//
// Key format: "<module>.<action>". Keys are the contract the API checks
// against, so renaming one is a breaking change: add the new key, migrate the
// role grants, then remove the old one.

/** @type {Array<{ module: string, label: string, actions: Array<[string, string, string?]> }>} */
export const PERMISSION_MODULES = [
  {
    module: "dashboard",
    label: "Dashboard",
    actions: [["view", "View dashboard", "Access the staff dashboard and its summary widgets"]],
  },
  {
    module: "branches",
    label: "Branches",
    actions: [
      ["read", "View branches"],
      ["create", "Create branches"],
      ["update", "Edit branches"],
      ["delete", "Delete branches"],
      ["manage_hours", "Manage opening hours", "Edit weekly hours and one-off closures"],
    ],
  },
  {
    module: "users",
    label: "Users",
    actions: [
      ["read", "View users"],
      ["create", "Create users"],
      ["update", "Edit users"],
      ["delete", "Delete users"],
      ["suspend", "Suspend or reactivate users"],
      ["reset_password", "Reset a user's password"],
      ["manage_sessions", "Revoke sessions", "Force-logout a user's devices"],
    ],
  },
  {
    module: "roles",
    label: "Roles",
    actions: [
      ["read", "View roles"],
      ["create", "Create roles"],
      ["update", "Edit roles and their permissions"],
      ["delete", "Delete roles"],
      ["assign", "Assign roles to users", "Grant or revoke a role, optionally scoped to a branch"],
    ],
  },
  {
    module: "permissions",
    label: "Permissions",
    actions: [["read", "View the permission catalogue", "Read-only: permissions are seeded, never authored"]],
  },
  {
    module: "audit_logs",
    label: "Audit log",
    actions: [
      ["read", "View the audit log"],
      ["export", "Export the audit log"],
    ],
  },
  {
    module: "customers",
    label: "Customers",
    actions: [
      ["read", "View customers"],
      ["update", "Edit customer details"],
      ["delete", "Delete customer accounts"],
      ["export", "Export customer data"],
    ],
  },

  // --- Catalog -------------------------------------------------------------
  {
    module: "categories",
    label: "Categories",
    actions: [
      ["read", "View categories"],
      ["create", "Create categories"],
      ["update", "Edit categories"],
      ["delete", "Delete categories"],
    ],
  },
  {
    module: "products",
    label: "Products",
    actions: [
      ["read", "View products"],
      ["create", "Create products"],
      ["update", "Edit products"],
      ["delete", "Delete products"],
      ["publish", "Publish or unpublish products"],
    ],
  },
  {
    module: "variants",
    label: "Product variants",
    actions: [
      ["read", "View variants"],
      ["create", "Create variants"],
      ["update", "Edit variants and prices"],
      ["delete", "Delete variants"],
    ],
  },
  {
    module: "modifiers",
    label: "Modifiers",
    actions: [
      ["read", "View modifier groups"],
      ["create", "Create modifier groups"],
      ["update", "Edit modifier groups and options"],
      ["delete", "Delete modifier groups"],
    ],
  },
  {
    module: "combos",
    label: "Combos",
    actions: [
      ["read", "View combos"],
      ["create", "Create combos"],
      ["update", "Edit combos"],
      ["delete", "Delete combos"],
    ],
  },
  {
    module: "catalog",
    label: "Catalog transfer",
    actions: [
      ["export", "Export the catalog", "Download categories, products, variants or menu items as CSV"],
      [
        "import",
        "Import the catalog",
        "Bulk-create and update catalog records from a CSV. Rewrites prices across the estate, so it is separate from editing one product.",
      ],
    ],
  },
  {
    module: "menus",
    label: "Menus",
    actions: [
      ["read", "View menus"],
      ["create", "Create menus"],
      ["update", "Edit menus and sections"],
      ["delete", "Delete menus"],
      ["publish", "Publish menus"],
    ],
  },
  {
    module: "menu_items",
    label: "Menu items",
    actions: [
      ["read", "View menu items"],
      ["update_price", "Override menu prices"],
      ["toggle_availability", "Mark items available or sold out", "The 86 switch"],
    ],
  },
  {
    module: "kitchen_stations",
    label: "Kitchen stations",
    actions: [
      ["read", "View kitchen stations"],
      ["manage", "Manage kitchen stations"],
    ],
  },

  // --- Dine-in surface -----------------------------------------------------
  {
    module: "tables",
    label: "Tables",
    actions: [
      ["read", "View tables"],
      ["create", "Create tables"],
      ["update", "Edit tables"],
      ["delete", "Delete tables"],
    ],
  },
  {
    module: "qr_codes",
    label: "QR codes",
    actions: [
      ["read", "View QR codes"],
      ["create", "Generate QR codes"],
      ["update", "Edit QR codes and their targets"],
      ["delete", "Delete QR codes"],
      ["print", "Download printable QR assets"],
      ["view_analytics", "View QR scan analytics"],
    ],
  },

  // --- Ordering ------------------------------------------------------------
  {
    module: "carts",
    label: "Carts",
    actions: [["read", "View customer carts", "Support tooling for abandoned-cart help"]],
  },
  {
    module: "orders",
    label: "Orders",
    actions: [
      ["read", "View orders"],
      ["read_all_branches", "View orders across all branches", "Bypasses branch scoping on order lists"],
      ["create", "Create orders", "Counter, phone and POS order entry"],
      ["update", "Edit orders"],
      ["edit_items", "Add or remove order items after placement"],
      ["update_status", "Advance order status"],
      ["cancel", "Cancel orders"],
      ["apply_manual_discount", "Apply a manual discount"],
      ["export", "Export orders"],
    ],
  },
  {
    module: "kds",
    label: "Kitchen display",
    actions: [
      ["read", "View kitchen tickets"],
      ["update_item_status", "Mark items preparing, ready or served"],
    ],
  },
  {
    module: "invoices",
    label: "Invoices",
    actions: [
      ["read", "View invoices"],
      ["create", "Issue invoices"],
      ["void", "Void invoices"],
      ["download", "Download invoice PDFs"],
    ],
  },
  {
    module: "reviews",
    label: "Reviews",
    actions: [
      ["read", "View reviews"],
      ["moderate", "Publish or reject reviews"],
      ["delete", "Delete reviews"],
    ],
  },

  // --- Discounts -----------------------------------------------------------
  {
    module: "promotions",
    label: "Promotions",
    actions: [
      ["read", "View promotions"],
      ["create", "Create promotions"],
      ["update", "Edit promotions"],
      ["delete", "Delete promotions"],
      ["activate", "Activate or pause promotions"],
    ],
  },
  {
    module: "coupons",
    label: "Coupons",
    actions: [
      ["read", "View coupons"],
      ["create", "Create coupons"],
      ["update", "Edit coupons"],
      ["delete", "Delete coupons"],
      ["generate_bulk", "Bulk-generate coupon codes"],
    ],
  },

  // --- Money in ------------------------------------------------------------
  {
    module: "payments",
    label: "Payments",
    actions: [
      ["read", "View payments"],
      ["capture", "Capture authorised payments"],
      ["mark_collected", "Mark cash or COD collected"],
      ["void", "Void a payment"],
      ["export", "Export payments"],
    ],
  },
  {
    module: "refunds",
    label: "Refunds",
    actions: [
      ["read", "View refunds"],
      ["request", "Request a refund"],
      ["approve", "Approve and process refunds"],
      ["reject", "Reject refund requests"],
    ],
  },
  {
    module: "payment_webhooks",
    label: "Payment webhooks",
    actions: [
      ["read", "View gateway webhook events"],
      ["replay", "Replay a webhook event"],
    ],
  },
  {
    module: "cash_registers",
    label: "Cash registers",
    actions: [
      ["read", "View register sessions"],
      ["open", "Open a register session"],
      ["close", "Close a register session"],
      ["reconcile", "Reconcile cash variance"],
      ["record_movement", "Record cash in, out or drops"],
    ],
  },

  // --- Delivery ------------------------------------------------------------
  {
    module: "drivers",
    label: "Drivers",
    actions: [
      ["read", "View drivers"],
      ["create", "Add drivers"],
      ["update", "Edit drivers"],
      ["delete", "Remove drivers"],
      ["track", "Track driver locations"],
    ],
  },
  {
    module: "deliveries",
    label: "Deliveries",
    actions: [
      ["read", "View deliveries"],
      ["assign", "Assign a driver"],
      ["reassign", "Reassign a delivery"],
      ["update_status", "Update delivery status"],
      ["mark_failed", "Mark a delivery failed"],
    ],
  },
  {
    module: "driver_payouts",
    label: "Driver payouts",
    actions: [
      ["read", "View driver payouts"],
      ["create", "Generate driver payouts"],
      ["approve", "Approve driver payouts"],
      ["mark_paid", "Mark driver payouts paid"],
    ],
  },

  // --- People --------------------------------------------------------------
  {
    module: "departments",
    label: "Departments",
    actions: [
      ["read", "View departments"],
      ["manage", "Manage departments"],
    ],
  },
  {
    module: "employees",
    label: "Employees",
    actions: [
      ["read", "View employees"],
      ["create", "Add employees"],
      ["update", "Edit employees"],
      ["delete", "Remove employees"],
      ["view_salary", "View salary details"],
      ["manage_salary", "Edit salary and components"],
    ],
  },
  {
    module: "shifts",
    label: "Shifts",
    actions: [
      ["read", "View shifts"],
      ["manage", "Create and edit shifts"],
    ],
  },
  {
    module: "rosters",
    label: "Rosters",
    actions: [
      ["read", "View the roster"],
      ["manage", "Assign shifts to employees"],
    ],
  },
  {
    module: "attendance",
    label: "Attendance",
    actions: [
      ["read", "View attendance"],
      ["edit", "Correct attendance days"],
      ["approve", "Approve attendance"],
      ["export", "Export attendance"],
    ],
  },
  {
    module: "attendance_devices",
    label: "Attendance devices",
    actions: [
      ["read", "View attendance devices"],
      ["manage", "Register and configure devices"],
      ["sync", "Trigger a device sync"],
    ],
  },
  {
    module: "attendance_punches",
    label: "Attendance punches",
    actions: [
      ["read", "View raw punches"],
      ["create_manual", "Add a manual punch"],
    ],
  },
  {
    module: "leave_types",
    label: "Leave types",
    actions: [
      ["read", "View leave types"],
      ["manage", "Manage leave types and quotas"],
    ],
  },
  {
    module: "leave_requests",
    label: "Leave requests",
    actions: [
      ["read", "View leave requests"],
      ["create", "Raise a leave request"],
      ["approve", "Approve leave"],
      ["reject", "Reject leave"],
      ["cancel", "Cancel leave"],
    ],
  },
  {
    module: "holidays",
    label: "Holidays",
    actions: [
      ["read", "View holidays"],
      ["manage", "Manage the holiday calendar"],
    ],
  },
  {
    module: "payroll",
    label: "Payroll",
    actions: [
      ["read", "View payroll periods"],
      ["process", "Run payroll"],
      ["approve", "Approve payroll"],
      ["mark_paid", "Mark payroll paid"],
    ],
  },
  {
    module: "payslips",
    label: "Payslips",
    actions: [
      ["read", "View payslips"],
      ["view_all", "View every employee's payslip"],
      ["download", "Download payslip PDFs"],
    ],
  },

  // --- Inventory -----------------------------------------------------------
  {
    module: "inventory_items",
    label: "Inventory items",
    actions: [
      ["read", "View inventory items"],
      ["create", "Create inventory items"],
      ["update", "Edit inventory items"],
      ["delete", "Delete inventory items"],
    ],
  },
  {
    module: "inventory_categories",
    label: "Inventory categories",
    actions: [
      ["read", "View inventory categories"],
      ["manage", "Manage inventory categories"],
    ],
  },
  {
    module: "units",
    label: "Units of measure",
    actions: [
      ["read", "View units"],
      ["manage", "Manage units and conversions"],
    ],
  },
  {
    module: "stock_locations",
    label: "Stock locations",
    actions: [
      ["read", "View stock locations"],
      ["manage", "Manage stock locations"],
    ],
  },
  {
    module: "stock",
    label: "Stock",
    actions: [
      ["read", "View stock on hand"],
      ["view_valuation", "View stock valuation", "Exposes cost prices"],
    ],
  },
  {
    module: "stock_movements",
    label: "Stock movements",
    actions: [
      ["read", "View the stock ledger"],
      ["export", "Export stock movements"],
    ],
  },
  {
    module: "stock_adjustments",
    label: "Stock adjustments",
    actions: [
      ["read", "View adjustments"],
      ["create", "Create adjustments"],
      ["approve", "Approve adjustments"],
    ],
  },
  {
    module: "stock_transfers",
    label: "Stock transfers",
    actions: [
      ["read", "View transfers"],
      ["create", "Create transfers"],
      ["approve", "Approve transfers"],
      ["receive", "Receive transfers"],
    ],
  },
  {
    module: "stock_counts",
    label: "Stock counts",
    actions: [
      ["read", "View stock counts"],
      ["create", "Start a stock count"],
      ["submit", "Submit counted quantities"],
      ["approve", "Approve and post a count"],
    ],
  },
  {
    module: "stock_batches",
    label: "Stock batches",
    actions: [
      ["read", "View batches and expiry"],
      ["quarantine", "Quarantine a batch"],
      ["write_off", "Write off a batch"],
    ],
  },
  {
    module: "wastage",
    label: "Wastage",
    actions: [
      ["read", "View wastage"],
      ["create", "Record wastage"],
      ["approve", "Approve wastage"],
    ],
  },

  // --- Procurement ---------------------------------------------------------
  {
    module: "suppliers",
    label: "Suppliers",
    actions: [
      ["read", "View suppliers"],
      ["create", "Create suppliers"],
      ["update", "Edit suppliers"],
      ["delete", "Delete suppliers"],
    ],
  },
  {
    module: "purchase_orders",
    label: "Purchase orders",
    actions: [
      ["read", "View purchase orders"],
      ["create", "Create purchase orders"],
      ["update", "Edit purchase orders"],
      ["approve", "Approve purchase orders"],
      ["send", "Send a purchase order to the supplier"],
      ["cancel", "Cancel purchase orders"],
    ],
  },
  {
    module: "goods_receipts",
    label: "Goods receipts",
    actions: [
      ["read", "View goods receipts"],
      ["create", "Receive goods"],
      ["approve", "Approve goods receipts"],
    ],
  },

  // --- Production ----------------------------------------------------------
  {
    module: "recipes",
    label: "Recipes",
    actions: [
      ["read", "View recipes"],
      ["create", "Create recipes"],
      ["update", "Edit recipes"],
      ["delete", "Delete recipes"],
      ["view_cost", "View recipe costing", "Exposes ingredient costs and margins"],
    ],
  },
  {
    module: "production_orders",
    label: "Production",
    actions: [
      ["read", "View production orders"],
      ["create", "Plan production"],
      ["start", "Start a production run"],
      ["complete", "Complete a production run"],
      ["cancel", "Cancel a production run"],
    ],
  },

  // --- Finance -------------------------------------------------------------
  {
    module: "accounts",
    label: "Chart of accounts",
    actions: [
      ["read", "View accounts"],
      ["create", "Create accounts"],
      ["update", "Edit accounts"],
      ["deactivate", "Deactivate accounts"],
    ],
  },
  {
    module: "journal_entries",
    label: "Journal entries",
    actions: [
      ["read", "View journal entries"],
      ["create", "Create journal entries"],
      ["post", "Post journal entries"],
      ["void", "Void or reverse entries"],
    ],
  },
  {
    module: "accounting_periods",
    label: "Accounting periods",
    actions: [
      ["read", "View periods"],
      ["close", "Close a period"],
      ["reopen", "Reopen a period"],
    ],
  },
  {
    module: "supplier_bills",
    label: "Supplier bills",
    actions: [
      ["read", "View supplier bills"],
      ["create", "Create supplier bills"],
      ["approve", "Approve supplier bills"],
      ["record_payment", "Record a bill payment"],
    ],
  },
  {
    module: "expenses",
    label: "Expenses",
    actions: [
      ["read", "View expenses"],
      ["create", "Record expenses"],
      ["approve", "Approve expenses"],
      ["delete", "Delete expenses"],
    ],
  },
  {
    module: "taxes",
    label: "Taxes",
    actions: [
      ["read", "View tax groups and rates"],
      ["manage", "Manage tax groups and rates"],
    ],
  },
  {
    module: "financial_reports",
    label: "Financial reports",
    actions: [
      ["view_pnl", "View profit and loss"],
      ["view_balance_sheet", "View the balance sheet"],
      ["view_trial_balance", "View the trial balance"],
      ["view_cash_flow", "View cash flow"],
      ["export", "Export financial reports"],
    ],
  },
  {
    module: "reports",
    label: "Operational reports",
    actions: [
      ["view_sales", "View sales reports"],
      ["view_inventory", "View inventory reports"],
      ["view_delivery", "View delivery reports"],
      ["view_hr", "View attendance and HR reports"],
      ["view_creator", "View creator program reports"],
      ["export", "Export operational reports"],
    ],
  },

  // --- Platform ------------------------------------------------------------
  {
    module: "settings",
    label: "Settings",
    actions: [
      ["read", "View settings"],
      ["update", "Change settings"],
    ],
  },
  {
    module: "number_sequences",
    label: "Number sequences",
    actions: [
      ["read", "View document numbering"],
      ["manage", "Configure document numbering"],
    ],
  },
  {
    module: "notifications",
    label: "Notifications",
    actions: [
      ["read", "View notifications"],
      ["send", "Send notifications"],
      ["manage_templates", "Manage notification templates"],
    ],
  },
  {
    module: "media",
    label: "Media",
    actions: [
      ["upload", "Upload media"],
      ["delete", "Delete media"],
    ],
  },

  // --- Creator program -----------------------------------------------------
  {
    module: "creators",
    label: "Creators",
    actions: [
      ["read", "View creators"],
      ["approve", "Approve creator accounts"],
      ["suspend", "Suspend creators"],
      ["ban", "Ban creators"],
      ["adjust_strikes", "Issue or revoke strikes"],
    ],
  },
  {
    module: "creator_videos",
    label: "Creator videos",
    actions: [
      ["read", "View creator videos"],
      ["review", "Review submitted videos"],
      ["publish", "Approve and publish a video"],
      ["reject", "Reject a video"],
      ["takedown", "Take down a live video"],
      ["delete", "Delete a video"],
    ],
  },
  {
    module: "creator_commission_rules",
    label: "Commission rules",
    actions: [
      ["read", "View commission rules"],
      ["create", "Create commission rules"],
      ["update", "Edit commission rules"],
      ["delete", "Delete commission rules"],
    ],
  },
  {
    module: "creator_earnings",
    label: "Creator earnings",
    actions: [
      ["read", "View creator earnings"],
      ["approve", "Approve earnings for crediting"],
      ["reverse", "Reverse or claw back earnings"],
      ["export", "Export earnings"],
    ],
  },
  {
    module: "creator_wallets",
    label: "Creator wallets",
    actions: [
      ["read", "View creator wallets"],
      ["adjust", "Adjust a wallet balance"],
      ["freeze", "Freeze or unfreeze a wallet"],
    ],
  },
  {
    module: "creator_program",
    label: "Creator program",
    actions: [
      ["configure", "Configure the creator program"],
      ["manage_terms", "Publish creator terms versions"],
    ],
  },

  // --- Self-service --------------------------------------------------------
  // Held by ordinary customers and creators. Everything here is implicitly
  // scoped to the acting user's own records.
  {
    module: "self",
    label: "Own account",
    actions: [
      ["view_profile", "View own profile"],
      ["update_profile", "Edit own profile"],
      ["manage_addresses", "Manage own addresses"],
      ["place_order", "Place an order"],
      ["view_own_orders", "View own orders"],
      ["cancel_own_order", "Cancel own order"],
      ["review_own_order", "Review a purchased item"],
      ["manage_notifications", "Read and dismiss own notifications"],
      ["manage_devices", "Register and remove own devices for push"],
      ["become_creator", "Join the creator program"],
      ["manage_own_videos", "Upload and manage own videos"],
      ["view_creator_dashboard", "View own creator dashboard"],
      ["redeem_credit", "Redeem own store credit"],
    ],
  },
];

/** Flattened catalogue, ready to upsert. */
export const PERMISSIONS = PERMISSION_MODULES.flatMap((mod, moduleIndex) =>
  mod.actions.map(([action, label, description], actionIndex) => ({
    key: `${mod.module}.${action}`,
    module: mod.module,
    action,
    label,
    description: description ?? null,
    isSystem: true,
    // Keeps the admin UI in a stable, readable order.
    sortOrder: moduleIndex * 100 + actionIndex,
  })),
);
