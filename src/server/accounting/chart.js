/**
 * The standard chart of accounts.
 *
 * Defined here rather than only in a seed file because the posting rules
 * resolve accounts **by code**, and a code that exists in the seed but not in
 * the rules — or the other way round — is a posting that fails at runtime for a
 * business event that has already happened. One definition, two consumers.
 *
 * Codes follow the conventional blocks so an accountant can read them without a
 * key: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx expenses.
 *
 * Two entries are worth explaining because their normal balance looks wrong:
 *
 *   * **4900 Discounts given** is income with a DEBIT normal balance. A discount
 *     is not an expense — it is revenue never earned — so it belongs in the
 *     income section as a contra account. Booking it as an expense would
 *     overstate both revenue and costs, leaving profit right and every margin
 *     wrong.
 *   * **2350 Tips payable** is a liability, not income. A tip collected on a
 *     card belongs to the staff; the restaurant is holding it, not earning it.
 *     Crediting it to sales inflates revenue and, in most places, the tax on it.
 */

/** Every code the posting rules may reference, by name, so typos fail loudly. */
export const ACCOUNTS = {
  // --- assets --------------------------------------------------------------
  CASH: "1100",
  BANK: "1200",
  CARD_CLEARING: "1250",
  ACCOUNTS_RECEIVABLE: "1300",
  EMPLOYEE_ADVANCES: "1350",
  INVENTORY: "1400",
  WORK_IN_PROGRESS: "1450",

  // --- liabilities ---------------------------------------------------------
  ACCOUNTS_PAYABLE: "2100",
  TAX_PAYABLE: "2200",
  SALARIES_PAYABLE: "2300",
  EMPLOYEE_DEDUCTIONS_PAYABLE: "2320",
  TIPS_PAYABLE: "2350",
  DRIVER_PAYABLE: "2400",
  GOODS_RECEIVED_NOT_INVOICED: "2450",
  CUSTOMER_CREDIT: "2500",

  // --- equity --------------------------------------------------------------
  OPENING_BALANCE_EQUITY: "3050",
  OWNERS_CAPITAL: "3100",
  RETAINED_EARNINGS: "3900",

  // --- income --------------------------------------------------------------
  FOOD_SALES: "4100",
  DELIVERY_INCOME: "4200",
  SERVICE_INCOME: "4300",
  DISCOUNTS_GIVEN: "4900",
  ROUNDING: "4950",

  // --- expenses ------------------------------------------------------------
  COGS: "5100",
  WASTAGE: "5200",
  PRODUCTION_LABOR: "5300",
  PRODUCTION_OVERHEAD: "5350",
  GATEWAY_FEES: "5400",
  DELIVERY_EXPENSE: "5500",
  SALARIES: "5600",
  RENT: "5700",
  UTILITIES: "5750",
  CASH_OVER_SHORT: "5900",
  INVENTORY_VARIANCE: "5950",
  OTHER_EXPENSE: "5990",
};

/**
 * The seeded chart. Parents come before children so a single pass can resolve
 * `parentCode`.
 */
export const STANDARD_CHART = [
  // --- assets --------------------------------------------------------------
  { code: "1000", name: "Assets", type: "ASSET", normalBalance: "DEBIT" },
  { code: "1100", name: "Cash on hand", type: "ASSET", normalBalance: "DEBIT", subType: "Cash", parentCode: "1000" },
  { code: "1200", name: "Bank", type: "ASSET", normalBalance: "DEBIT", subType: "Bank", parentCode: "1000" },
  {
    code: "1250",
    name: "Card and gateway clearing",
    type: "ASSET",
    normalBalance: "DEBIT",
    subType: "Clearing",
    parentCode: "1000",
    description: "Money a provider has taken from the customer but not yet settled to the bank",
  },
  { code: "1300", name: "Accounts receivable", type: "ASSET", normalBalance: "DEBIT", subType: "Receivable", parentCode: "1000" },
  {
    code: "1350",
    name: "Employee advances",
    type: "ASSET",
    normalBalance: "DEBIT",
    subType: "Receivable",
    parentCode: "1000",
    description: "Money advanced to staff, recovered from later wages",
  },
  { code: "1400", name: "Inventory", type: "ASSET", normalBalance: "DEBIT", subType: "Inventory", parentCode: "1000" },
  {
    code: "1450",
    name: "Work in progress",
    type: "ASSET",
    normalBalance: "DEBIT",
    subType: "Inventory",
    parentCode: "1000",
    description: "Material issued to a production run that has not yet produced output",
  },

  // --- liabilities ---------------------------------------------------------
  { code: "2000", name: "Liabilities", type: "LIABILITY", normalBalance: "CREDIT" },
  { code: "2100", name: "Accounts payable", type: "LIABILITY", normalBalance: "CREDIT", subType: "Payable", parentCode: "2000" },
  { code: "2200", name: "Tax payable", type: "LIABILITY", normalBalance: "CREDIT", subType: "Tax", parentCode: "2000" },
  { code: "2300", name: "Salaries payable", type: "LIABILITY", normalBalance: "CREDIT", subType: "Payable", parentCode: "2000" },
  {
    code: "2320",
    name: "Employee deductions payable",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    subType: "Payable",
    parentCode: "2000",
    description: "Withheld from wages and owed to somebody else, where no more specific account is set on the component",
  },
  {
    code: "2350",
    name: "Tips payable",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    subType: "Payable",
    parentCode: "2000",
    description: "Tips collected on behalf of staff. Held, not earned.",
  },
  { code: "2400", name: "Driver payable", type: "LIABILITY", normalBalance: "CREDIT", subType: "Payable", parentCode: "2000" },
  {
    code: "2450",
    name: "Goods received not invoiced",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    subType: "Payable",
    parentCode: "2000",
    description: "Stock that has arrived and been booked, before the supplier's invoice does",
  },

  {
    code: "2500",
    name: "Customer credit and gift cards",
    type: "LIABILITY",
    normalBalance: "CREDIT",
    subType: "Deferred revenue",
    parentCode: "2000",
    description: "Money taken for food not yet supplied. Redeeming it settles the liability, it is not new income.",
  },

  // --- equity --------------------------------------------------------------
  { code: "3000", name: "Equity", type: "EQUITY", normalBalance: "CREDIT" },
  {
    code: "3050",
    name: "Opening balance equity",
    type: "EQUITY",
    normalBalance: "CREDIT",
    parentCode: "3000",
    description:
      "The other side of balances brought in when the books started, such as opening stock. An accountant clears it into owner's capital once the opening position is complete.",
  },
  { code: "3100", name: "Owner's capital", type: "EQUITY", normalBalance: "CREDIT", parentCode: "3000" },
  { code: "3900", name: "Retained earnings", type: "EQUITY", normalBalance: "CREDIT", parentCode: "3000" },

  // --- income --------------------------------------------------------------
  { code: "4000", name: "Income", type: "INCOME", normalBalance: "CREDIT" },
  { code: "4100", name: "Food sales", type: "INCOME", normalBalance: "CREDIT", subType: "Sales", parentCode: "4000" },
  { code: "4200", name: "Delivery income", type: "INCOME", normalBalance: "CREDIT", subType: "Sales", parentCode: "4000" },
  {
    code: "4300",
    name: "Service and packaging income",
    type: "INCOME",
    normalBalance: "CREDIT",
    subType: "Sales",
    parentCode: "4000",
  },
  {
    code: "4900",
    name: "Discounts given",
    type: "INCOME",
    normalBalance: "DEBIT",
    subType: "Contra income",
    parentCode: "4000",
    description: "Contra-income: revenue never earned, not a cost incurred",
  },
  {
    code: "4950",
    name: "Rounding",
    type: "INCOME",
    normalBalance: "CREDIT",
    subType: "Other income",
    parentCode: "4000",
    description: "Cash rounding differences, which go both ways",
  },

  // --- expenses ------------------------------------------------------------
  { code: "5000", name: "Expenses", type: "EXPENSE", normalBalance: "DEBIT" },
  { code: "5100", name: "Cost of goods sold", type: "EXPENSE", normalBalance: "DEBIT", subType: "COGS", parentCode: "5000" },
  { code: "5200", name: "Wastage", type: "EXPENSE", normalBalance: "DEBIT", subType: "COGS", parentCode: "5000" },
  { code: "5300", name: "Production labour", type: "EXPENSE", normalBalance: "DEBIT", subType: "Production", parentCode: "5000" },
  { code: "5350", name: "Production overhead", type: "EXPENSE", normalBalance: "DEBIT", subType: "Production", parentCode: "5000" },
  { code: "5400", name: "Payment gateway fees", type: "EXPENSE", normalBalance: "DEBIT", subType: "Operating", parentCode: "5000" },
  { code: "5500", name: "Delivery expense", type: "EXPENSE", normalBalance: "DEBIT", subType: "Operating", parentCode: "5000" },
  { code: "5600", name: "Salaries and wages", type: "EXPENSE", normalBalance: "DEBIT", subType: "Payroll", parentCode: "5000" },
  { code: "5700", name: "Rent", type: "EXPENSE", normalBalance: "DEBIT", subType: "Occupancy", parentCode: "5000" },
  { code: "5750", name: "Utilities", type: "EXPENSE", normalBalance: "DEBIT", subType: "Occupancy", parentCode: "5000" },
  {
    code: "5900",
    name: "Cash over and short",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    subType: "Operating",
    parentCode: "5000",
    description: "Till variance at close. A credit balance here means the drawer was over.",
  },
  {
    code: "5950",
    name: "Inventory variance",
    type: "EXPENSE",
    normalBalance: "DEBIT",
    subType: "COGS",
    parentCode: "5000",
    description: "Stock counts and adjustments — what the shelf had that the ledger did not",
  },
  { code: "5990", name: "Other expenses", type: "EXPENSE", normalBalance: "DEBIT", subType: "Operating", parentCode: "5000" },
];

/** Codes that must exist for the posting rules to work at all. */
export const REQUIRED_CODES = Object.values(ACCOUNTS);
