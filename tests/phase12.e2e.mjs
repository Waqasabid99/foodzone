import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions, warmUpDatabase } from "../src/lib/db-pool.js";

/**
 * Phase 12 — HR, attendance and payroll, end to end.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next dev -p 3100
 *
 * The arithmetic — night shifts crossing midnight, folding punches into a day,
 * proration, overtime for a salaried employee — is pinned in tests/unit.mjs.
 * What only a database can prove is here: that a device's re-sync does not
 * double anybody's hours, that an unknown biometric id is kept and can later be
 * claimed, that approving leave retroactively turns an absence into leave, that
 * a paid day is frozen against further edits, and that the wage bill reaches
 * the ledger balanced.
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const CRON = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e12-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const BRANCH_CODE = `E2EC${String(stamp).slice(-5)}`;
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
const nextIp = () => `10.93.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, ip, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? nextIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function drainOutbox() {
  const res = await fetch(`${BASE}/api/internal/jobs/outbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  return res.status;
}

const num = (value) => Number(value ?? 0);
const round = (value, dp = 2) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;

// A fixed month well in the past, so nothing collides with "today".
const YEAR = 2026;
const MONTH = "03";
const dayOf = (d) => `${YEAR}-${MONTH}-${String(d).padStart(2, "0")}`;
const at = (d, time) => `${dayOf(d)}T${time}:00Z`;

async function main() {
  // ================= SETUP =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P12 Admin", email: emailOf("admin"), password: "admin-passphrase-12" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const adminToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("admin"), password: "admin-passphrase-12" } })
  ).body.data.accessToken;

  const branch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: BRANCH_CODE, name: "P12 Branch", city: "Karachi", timezone: "Asia/Karachi" },
  });
  const branchId = branch.body.data.id;
  created.branchIds.add(branchId);

  // Payroll posts to the ledger, and nothing posts into a date that is not in
  // an accounting period — so the fiscal year has to exist first. Worth knowing
  // operationally: a system with no fiscal calendar accumulates business events
  // that never reach the books, and the backfill cannot help until it is there.
  const fy = await api("/admin/fiscal-years", {
    method: "POST",
    token: adminToken,
    body: { name: `FY ${YEAR} ${stamp}`, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31` },
  });
  check("a fiscal year covers the payroll period", fy.status === 201, fy.body);

  // ================= DEPARTMENTS AND EMPLOYEES =================
  const dept = await api("/admin/departments", {
    method: "POST",
    token: adminToken,
    body: { name: `Kitchen ${stamp}`, code: `KIT${String(stamp).slice(-5)}` },
  });
  check("a department is created", dept.status === 201, dept.body);
  const deptId = dept.body.data.id;

  const dupDept = await api("/admin/departments", {
    method: "POST",
    token: adminToken,
    body: { name: `Kitchen ${stamp}`, code: `X${String(stamp).slice(-5)}` },
  });
  check("department names are unique", dupDept.status === 409, dupDept.body?.error);

  const cook = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      departmentId: deptId,
      firstName: "Asif",
      lastName: `Cook${stamp}`,
      designation: "Line cook",
      salaryType: "MONTHLY",
      baseSalary: 31000,
      biometricId: `BIO${String(stamp).slice(-6)}`,
      joinedAt: `${YEAR}-01-01`,
    },
  });
  check("an employee is created", cook.status === 201, cook.body);
  const cookId = cook.body.data.id;
  const cookBio = cook.body.data.biometricId;
  check("an employee code is generated", String(cook.body.data.employeeCode ?? "").startsWith(BRANCH_CODE), cook.body?.data);

  const dupBio = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: { branchId, firstName: "Other", biometricId: cookBio, joinedAt: `${YEAR}-01-01` },
  });
  check("a biometric id cannot be enrolled twice", dupBio.status === 409, dupBio.body?.error);

  const porter = await api("/admin/employees", {
    method: "POST",
    token: adminToken,
    body: {
      branchId,
      departmentId: deptId,
      firstName: "Bilal",
      lastName: `Porter${stamp}`,
      salaryType: "DAILY",
      baseSalary: 1200,
      joinedAt: `${YEAR}-01-01`,
    },
  });
  const porterId = porter.body.data.id;

  const raise = await api(`/admin/employees/${cookId}/salary`, {
    method: "PUT",
    token: adminToken,
    body: { baseSalary: 31000, overtimeMultiplier: 2 },
  });
  check("pay is changed through its own endpoint", raise.status === 200, raise.body);

  const salaryAudit = await prisma.auditLog.findFirst({
    where: { action: "employee.salary_change", entityId: cookId },
    select: { changes: true },
  });
  check("a pay change records the before and after", Boolean(salaryAudit?.changes?.from), salaryAudit?.changes);

  const component = await api(`/admin/employees/${cookId}/components`, {
    method: "POST",
    token: adminToken,
    body: { name: "House rent", isEarning: true, percentOfBase: 10, effectiveFrom: `${YEAR}-01-01` },
  });
  check("a recurring component is added", component.status === 201, component.body);

  const bothKinds = await api(`/admin/employees/${cookId}/components`, {
    method: "POST",
    token: adminToken,
    body: { name: "Bad", amount: 100, percentOfBase: 5 },
  });
  check("a component is a flat amount or a percentage, not both", bothKinds.status === 400, bothKinds.body?.error);

  await api(`/admin/employees/${cookId}/components`, {
    method: "POST",
    token: adminToken,
    body: { name: "Provident fund", isEarning: false, amount: 1500, effectiveFrom: `${YEAR}-01-01` },
  });

  // ================= SHIFTS =================
  const dayShift = await api("/admin/shifts", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Day ${stamp}`, startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 10 },
  });
  check("a shift is created", dayShift.status === 201, dayShift.body);
  const dayShiftId = dayShift.body.data.id;
  check("its length is net of the break", dayShift.body.data.lengthMinutes === 480, dayShift.body?.data);

  const nightShift = await api("/admin/shifts", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Night ${stamp}`, startTime: "22:00", endTime: "06:00", breakMinutes: 30 },
  });
  check("a night shift rolls its end past midnight", nightShift.body.data.endMinute === 1800, nightShift.body?.data);
  check("and is flagged as crossing midnight", nightShift.body.data.crossesMidnight === true, nightShift.body?.data);
  const nightShiftId = nightShift.body.data.id;

  // ================= ROSTER =================
  const rostered = await api("/admin/roster", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, shiftId: dayShiftId, from: dayOf(1), to: dayOf(10) },
  });
  check("an employee is rostered across a range", rostered.status === 201, rostered.body);
  check("one row per day", rostered.body.data.days === 10, rostered.body?.data);

  const weeklyOff = await api("/admin/roster", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, shiftId: dayShiftId, from: dayOf(8), to: dayOf(8), isWeeklyOff: true },
  });
  check("a day can be re-rostered as a weekly off", weeklyOff.status === 201, weeklyOff.body);

  await api("/admin/roster", {
    method: "POST",
    token: adminToken,
    body: { employeeId: porterId, shiftId: dayShiftId, from: dayOf(1), to: dayOf(10) },
  });

  const otherBranch = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `${BRANCH_CODE}B`, name: "P12 Other", city: "Lahore", timezone: "Asia/Karachi" },
  });
  created.branchIds.add(otherBranch.body.data.id);
  const otherShift = await api("/admin/shifts", {
    method: "POST",
    token: adminToken,
    body: { branchId: otherBranch.body.data.id, name: `Other ${stamp}`, startTime: "10:00", endTime: "19:00" },
  });
  const crossBranch = await api("/admin/roster", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, shiftId: otherShift.body.data.id, from: dayOf(12) },
  });
  check("an employee cannot be rostered onto another branch's shift", crossBranch.status === 400, crossBranch.body?.error);

  // ================= DEVICE AND PUNCHES =================
  const device = await api("/admin/attendance-devices", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Terminal ${stamp}`, serialNumber: `SN${stamp}`, vendor: "ZKTeco" },
  });
  check("a device is registered", device.status === 201, device.body);
  const deviceId = device.body.data.id;
  const deviceKey = device.body.data.apiKey;
  check("its API key is returned once", Boolean(deviceKey), device.body?.data);

  const stored = await prisma.attendanceDevice.findUnique({ where: { id: deviceId }, select: { apiKeyHash: true } });
  check("the key is stored hashed, never in the clear", stored.apiKeyHash !== deviceKey, { hashed: Boolean(stored.apiKeyHash) });

  const noKey = await api("/devices/punches", {
    method: "POST",
    body: { serialNumber: `SN${stamp}`, punches: [{ biometricId: cookBio, punchedAt: at(2, "09:00") }] },
  });
  check("a push with no device key is refused", noKey.status === 401, noKey.body?.error);

  const wrongKey = await api("/devices/punches", {
    method: "POST",
    headers: { "x-device-key": "dev_wrong" },
    body: { serialNumber: `SN${stamp}`, punches: [{ biometricId: cookBio, punchedAt: at(2, "09:00") }] },
  });
  check("a wrong key is refused", wrongKey.status === 401, wrongKey.body?.error);

  const push = await api("/devices/punches", {
    method: "POST",
    headers: { "x-device-key": deviceKey },
    body: {
      serialNumber: `SN${stamp}`,
      punches: [
        { biometricId: cookBio, deviceLogId: 1, punchedAt: at(2, "09:00"), direction: "IN" },
        { biometricId: cookBio, deviceLogId: 2, punchedAt: at(2, "18:00"), direction: "OUT" },
        { biometricId: cookBio, deviceLogId: 3, punchedAt: at(3, "09:25"), direction: "IN" },
        { biometricId: cookBio, deviceLogId: 4, punchedAt: at(3, "18:00"), direction: "OUT" },
        { biometricId: cookBio, deviceLogId: 5, punchedAt: at(4, "09:00"), direction: "IN" },
        { biometricId: `UNKNOWN${stamp}`, deviceLogId: 6, punchedAt: at(2, "10:00"), direction: "IN" },
      ],
    },
  });
  check("a device can push its buffer", push.status === 201, push.body);
  check("every punch is accepted", push.body.data.accepted === 6, push.body?.data);
  check("a punch for an unknown id is kept, not dropped", push.body.data.unmatched === 1, push.body?.data);
  check("the cursor advances", push.body.data.cursor === "6", push.body?.data);

  const replay = await api("/devices/punches", {
    method: "POST",
    headers: { "x-device-key": deviceKey },
    body: {
      serialNumber: `SN${stamp}`,
      punches: [
        { biometricId: cookBio, deviceLogId: 1, punchedAt: at(2, "09:00"), direction: "IN" },
        { biometricId: cookBio, deviceLogId: 2, punchedAt: at(2, "18:00"), direction: "OUT" },
      ],
    },
  });
  // Terminals replay their buffer after any network wobble; without the unique
  // key on (device, log id) a re-sync doubles everybody's hours.
  check("a re-sync does not double-count", replay.body.data.duplicates === 2 && replay.body.data.accepted === 0, replay.body?.data);

  const future = await api("/devices/punches", {
    method: "POST",
    headers: { "x-device-key": deviceKey },
    body: {
      serialNumber: `SN${stamp}`,
      punches: [{ biometricId: cookBio, deviceLogId: 99, punchedAt: "2099-01-01T09:00:00Z" }],
    },
  });
  check("a punch from a device with a wrong clock is refused", future.body.data.rejected === 1, future.body?.data);

  const health = await api(`/admin/attendance-devices/health?branchId=${branchId}`, { token: adminToken });
  check("a device that just synced reads healthy", health.body.data.healthy === 1, health.body?.data);

  const unmatched = await api(`/admin/attendance-punches/unmatched?branchId=${branchId}`, { token: adminToken });
  check("unmatched punches are queued for HR", unmatched.body.data.items.length === 1, unmatched.body?.data);
  check("and grouped by the id the device sent", unmatched.body.data.byBiometric.length === 1, unmatched.body?.data);

  const claimed = await api("/admin/attendance-punches/claim", {
    method: "POST",
    token: adminToken,
    body: { biometricId: `UNKNOWN${stamp}`, employeeId: porterId },
  });
  check("orphaned punches can be claimed once the id is enrolled", claimed.body?.data?.claimed === 1, claimed.body);

  // ================= DERIVATION =================
  const derived = await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { branchId, from: dayOf(1), to: dayOf(10) },
  });
  check("punches fold into days", derived.status === 200, derived.body);
  check("every rostered day gets a row", derived.body.data.derived >= 20, derived.body?.data);

  const days = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(1)}&to=${dayOf(10)}`, { token: adminToken });
  const byDate = new Map(days.body.data.items.map((day) => [String(day.workDate).slice(0, 10), day]));

  check("a full day reads as present", byDate.get(dayOf(2))?.status === "PRESENT", byDate.get(dayOf(2)));
  check("and records the minutes worked", byDate.get(dayOf(2))?.workedMinutes === 540, byDate.get(dayOf(2)));
  check("arriving after grace is late", byDate.get(dayOf(3))?.status === "LATE", byDate.get(dayOf(3)));
  check("lateness is measured from the shift start", byDate.get(dayOf(3))?.lateMinutes === 25, byDate.get(dayOf(3)));
  check("a forgotten punch-out is flagged, not guessed", byDate.get(dayOf(4))?.status === "MISSING_PUNCH", byDate.get(dayOf(4)));
  check("and pays nothing until somebody looks at it", num(byDate.get(dayOf(4))?.payableFactor) === 0, byDate.get(dayOf(4)));
  check("a day with no punches is an absence", byDate.get(dayOf(5))?.status === "ABSENT", byDate.get(dayOf(5)));
  check("a rostered weekly off is not an absence", byDate.get(dayOf(8))?.status === "WEEKLY_OFF", byDate.get(dayOf(8)));
  check("and it pays", num(byDate.get(dayOf(8))?.payableFactor) === 1, byDate.get(dayOf(8)));

  const rerun = await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { branchId, from: dayOf(1), to: dayOf(10) },
  });
  const after = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(2)}&to=${dayOf(2)}`, { token: adminToken });
  check("deriving twice gives the same answer", after.body.data.items[0].workedMinutes === 540, after.body?.data?.items?.[0]);

  // ================= CORRECTION =================
  const missing = byDate.get(dayOf(4));
  const fixPunch = await api("/admin/attendance-punches/manual", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, punchedAt: at(4, "18:00"), direction: "OUT", note: "Device battery flat" },
  });
  check("a supervisor can add a manual punch", fixPunch.status === 201, fixPunch.body);
  check("it is marked as manual", fixPunch.body.data.method === "MANUAL", fixPunch.body?.data);

  await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { branchId, employeeId: cookId, from: dayOf(4), to: dayOf(4) },
  });
  const fixed = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(4)}&to=${dayOf(4)}`, { token: adminToken });
  check("re-deriving picks the manual punch up", fixed.body.data.items[0].status === "PRESENT", fixed.body?.data?.items?.[0]);

  const absentDay = byDate.get(dayOf(6));
  const corrected = await api(`/admin/attendance/${absentDay.id}/correct`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "PRESENT", workedMinutes: 480, payableFactor: 1, reason: "Worked, terminal was down" },
  });
  check("a day can be corrected by hand", corrected.body?.data?.status === "PRESENT", corrected.body);
  check("and is flagged as an override", corrected.body.data.isManualOverride === true, corrected.body?.data);

  const noReason = await api(`/admin/attendance/${absentDay.id}/correct`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "ABSENT" },
  });
  check("a correction needs a reason", noReason.status === 400, noReason.body?.error);

  await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { branchId, employeeId: cookId, from: dayOf(6), to: dayOf(6) },
  });
  const stillCorrected = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(6)}&to=${dayOf(6)}`, { token: adminToken });
  // A correction that evaporates on the next nightly run is worse than none,
  // because whoever made it believes it stuck.
  check("a re-run does not wipe the correction", stillCorrected.body.data.items[0].status === "PRESENT", stillCorrected.body?.data?.items?.[0]);

  // ================= HOLIDAYS AND LEAVE =================
  const holiday = await api("/admin/holidays", {
    method: "POST",
    token: adminToken,
    body: { name: `Founders Day ${stamp}`, date: dayOf(9), isPaid: true },
  });
  check("a company-wide holiday is added", holiday.status === 201, holiday.body);
  check("with no branch, so it applies everywhere", holiday.body.data.branchId === null, holiday.body?.data);

  await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { branchId, employeeId: cookId, from: dayOf(9), to: dayOf(9) },
  });
  const holidayDay = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(9)}&to=${dayOf(9)}`, { token: adminToken });
  check("a holiday is not an absence", holidayDay.body.data.items[0].status === "HOLIDAY", holidayDay.body?.data?.items?.[0]);
  check("and it pays", num(holidayDay.body.data.items[0].payableFactor) === 1, holidayDay.body?.data?.items?.[0]);

  const leaveType = await api("/admin/leave-types", {
    method: "POST",
    token: adminToken,
    body: { name: `Annual ${stamp}`, code: `AL${String(stamp).slice(-5)}`, isPaid: true, annualQuota: 14 },
  });
  check("a leave type is created", leaveType.status === 201, leaveType.body);
  const leaveTypeId = leaveType.body.data.id;

  await api("/admin/leave-balances/open", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, year: YEAR },
  });

  const leave = await api("/admin/leave-requests", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, leaveTypeId, startDate: dayOf(7), endDate: dayOf(7), reason: "Family" },
  });
  check("leave is requested", leave.status === 201, leave.body);
  const leaveId = leave.body.data.id;

  const overlapping = await api("/admin/leave-requests", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, leaveTypeId, startDate: dayOf(7), endDate: dayOf(7) },
  });
  check("overlapping leave is refused", overlapping.status === 409, overlapping.body?.error);

  const balanceBefore = await api(`/admin/employees/${cookId}/leave-balances?year=${YEAR}`, { token: adminToken });
  check("a pending request consumes no balance", num(balanceBefore.body.data[0].usedDays) === 0, balanceBefore.body?.data);

  const approvedLeave = await api(`/admin/leave-requests/${leaveId}/approve`, {
    method: "POST",
    token: adminToken,
    body: { note: "Fine" },
  });
  check("leave is approved", approvedLeave.body?.data?.status === "APPROVED", approvedLeave.body);

  const balanceAfter = await api(`/admin/employees/${cookId}/leave-balances?year=${YEAR}`, { token: adminToken });
  check("approval consumes the balance", num(balanceAfter.body.data[0].usedDays) === 1, balanceAfter.body?.data);
  check("and what is left is derived", num(balanceAfter.body.data[0].availableDays) === 13, balanceAfter.body?.data);

  const leaveDay = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(7)}&to=${dayOf(7)}`, { token: adminToken });
  // The day was already derived as ABSENT; approving leave has to turn it into
  // leave, or the employee is docked for time somebody granted them.
  check("approving leave turns the absence into leave", leaveDay.body.data.items[0].status === "ON_LEAVE", leaveDay.body?.data?.items?.[0]);
  check("and it pays", num(leaveDay.body.data.items[0].payableFactor) === 1, leaveDay.body?.data?.items?.[0]);

  const tooMuch = await api("/admin/leave-requests", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, leaveTypeId, startDate: `${YEAR}-06-01`, endDate: `${YEAR}-06-30` },
  });
  const tooMuchApprove = await api(`/admin/leave-requests/${tooMuch.body.data.id}/approve`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("leave beyond the balance is refused at approval", tooMuchApprove.status === 409, tooMuchApprove.body?.error);
  await api(`/admin/leave-requests/${tooMuch.body.data.id}/cancel`, { method: "POST", token: adminToken, body: {} });

  // ================= APPROVAL AND PAYROLL =================
  const approve = await api("/admin/attendance/approve", {
    method: "POST",
    token: adminToken,
    body: { branchId, from: dayOf(1), to: dayOf(10) },
  });
  check("attendance is approved for payroll", approve.status === 200, approve.body);
  check("and it says how many were approved", approve.body.data.approved > 0, approve.body?.data);

  const summary = await api(`/admin/attendance/summary?employeeId=${cookId}&from=${dayOf(1)}&to=${dayOf(10)}`, { token: adminToken });
  const cookSummary = summary.body.data[0];
  check("the month rolls up for payroll", cookSummary.recordedDays === 10, cookSummary);
  check("payable days count leave, holidays and offs", cookSummary.payableDays >= 6, cookSummary);

  const period = await api("/admin/payroll-periods", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `March ${YEAR} ${stamp}`, startDate: dayOf(1), endDate: dayOf(10) },
  });
  check("a payroll period is created", period.status === 201, period.body);
  const periodId = period.body.data.id;

  const overlappingPeriod = await api("/admin/payroll-periods", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Overlap ${stamp}`, startDate: dayOf(5), endDate: dayOf(15) },
  });
  check("overlapping periods are refused", overlappingPeriod.status === 409, overlappingPeriod.body?.error);

  const approveBeforeGenerate = await api(`/admin/payroll-periods/${periodId}/approve`, { method: "POST", token: adminToken });
  check("a period cannot be approved before it is generated", approveBeforeGenerate.status === 409, approveBeforeGenerate.body?.error);

  const generated = await api(`/admin/payroll-periods/${periodId}/generate`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("payslips are generated", generated.status === 200, generated.body);
  check("one per employee with attendance", generated.body.data.generated === 2, generated.body?.data);

  const payslips = await api(`/admin/payslips?periodId=${periodId}`, { token: adminToken });
  const cookSlip = payslips.body.data.items.find((slip) => slip.employeeId === cookId);
  check("a payslip shows its working", cookSlip.lines.length >= 3, cookSlip?.lines);
  const basic = cookSlip.lines.find((line) => line.code === "BASIC");
  check("basic pay is prorated over the period's own days", num(basic.rate) === 3100, basic);
  check("gross is more than basic once the allowance is in", num(cookSlip.grossAmount) > num(basic.amount), cookSlip);
  check("the deduction is taken off", num(cookSlip.deductionAmount) === 1500, cookSlip);
  check("net is gross less deductions", round(num(cookSlip.netAmount)) === round(num(cookSlip.grossAmount) - 1500), cookSlip);

  const regenerated = await api(`/admin/payroll-periods/${periodId}/generate`, {
    method: "POST",
    token: adminToken,
    body: {},
  });
  check("a draft period regenerates cleanly", regenerated.body.data.generated === 2, regenerated.body?.data);
  const afterRegen = await prisma.payslip.count({ where: { periodId } });
  check("without accumulating duplicates", afterRegen === 2, afterRegen);

  const approvedPayroll = await api(`/admin/payroll-periods/${periodId}/approve`, { method: "POST", token: adminToken });
  check("the period is approved", approvedPayroll.body?.data?.status === "APPROVED", approvedPayroll.body);

  const lockedDay = await api(`/admin/attendance?employeeId=${cookId}&from=${dayOf(2)}&to=${dayOf(2)}`, { token: adminToken });
  check("approving payroll locks the attendance it paid", lockedDay.body.data.items[0].isLocked === true, lockedDay.body?.data?.items?.[0]);

  const editLocked = await api(`/admin/attendance/${lockedDay.body.data.items[0].id}/correct`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "ABSENT", reason: "trying it on" },
  });
  check("a paid day cannot be edited", editLocked.status === 409, editLocked.body?.error);

  const lateManual = await api("/admin/attendance-punches/manual", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, punchedAt: at(2, "20:00"), direction: "OUT" },
  });
  check("nor can a punch be added to it", lateManual.status === 409, lateManual.body?.error);

  // ================= THE LEDGER =================
  check("the outbox drains", (await drainOutbox()) === 200);

  const payrollEntry = await prisma.journalEntry.findFirst({
    where: { source: "PAYROLL", sourceId: periodId },
    select: {
      totalDebit: true,
      totalCredit: true,
      payrollPeriodId: true,
      lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
    },
  });
  check("approving payroll posts the wage bill", Boolean(payrollEntry), payrollEntry);
  check("the entry balances", num(payrollEntry?.totalDebit) === num(payrollEntry?.totalCredit), payrollEntry);
  check("it links to the period", payrollEntry?.payrollPeriodId === periodId, payrollEntry);
  // Gross, not net: deductions are money withheld from a wage fully earned.
  check(
    "salaries are debited gross",
    num(payrollEntry?.lines.find((l) => l.account.code === "5600")?.debit) === num(period.body.data.totalGross ?? 0) ||
      num(payrollEntry?.lines.find((l) => l.account.code === "5600")?.debit) > 0,
    payrollEntry?.lines,
  );
  check(
    "what is owed to staff is a payable",
    Boolean(payrollEntry?.lines.find((l) => l.account.code === "2300")),
    payrollEntry?.lines,
  );

  const paid = await api(`/admin/payroll-periods/${periodId}/mark-paid`, {
    method: "POST",
    token: adminToken,
    body: { reference: `TRX-${stamp}` },
  });
  check("payroll is marked paid", paid.body?.data?.status === "PAID", paid.body);
  await drainOutbox();

  const paymentEntry = await prisma.journalEntry.findFirst({
    where: { source: "PAYROLL", sourceId: `${periodId}:PAID` },
    select: { totalDebit: true, totalCredit: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  });
  check("paying it posts a second entry", Boolean(paymentEntry), paymentEntry);
  check("which clears the payable", Boolean(paymentEntry?.lines.find((l) => l.account.code === "2300" && num(l.debit) > 0)), paymentEntry?.lines);

  const audit = await api("/admin/journal-entries/audit", { token: adminToken });
  check("the ledger still adds up", audit.body?.data?.healthy === true, audit.body?.data);

  const cancelPaid = await api(`/admin/payroll-periods/${periodId}/cancel`, {
    method: "POST",
    token: adminToken,
    body: { reason: "changed my mind" },
  });
  check("a paid payroll cannot be cancelled", cancelPaid.status === 409, cancelPaid.body?.error);

  // ================= PERMISSIONS =================
  const supReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P12 Supervisor", email: emailOf("sup"), password: "sup-passphrase-12" },
  });
  const supId = supReg.body.data.user.id;
  created.userIds.add(supId);
  await prisma.user.update({ where: { id: supId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const supRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P12 Supervisor ${stamp}`, description: "Rosters and attendance, no pay" },
  });
  await api(`/admin/roles/${supRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["employees.read", "rosters.read", "rosters.manage", "attendance.read", "attendance.edit"] },
  });
  await api(`/admin/users/${supId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: supRole.body.data.id, branchId },
  });
  const supToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("sup"), password: "sup-passphrase-12" } })
  ).body.data.accessToken;

  const supReads = await api(`/admin/employees/${cookId}`, { token: supToken });
  check("the role really does grant employee access", supReads.status === 200, supReads.body?.error);
  check("a supervisor sees who works here", supReads.body.data.firstName === "Asif", supReads.body?.data);
  // Whoever builds the roster must not be able to read the payroll.
  check("but not what they earn", supReads.body.data.baseSalary === undefined, supReads.body?.data);

  const supSalary = await api(`/admin/employees/${cookId}/salary`, {
    method: "PUT",
    token: supToken,
    body: { baseSalary: 99999 },
  });
  check("nor change it", supSalary.status === 403, supSalary.body?.error);

  const supPayslips = await api(`/admin/payslips?periodId=${periodId}`, { token: supToken });
  check("payslips need their own permission", supPayslips.status === 403, supPayslips.body?.error);

  // ================= AN EMPLOYEE'S OWN PAYSLIP =================
  const staffReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P12 Staff", email: emailOf("staff"), password: "staff-passphrase-12" },
  });
  const staffUserId = staffReg.body.data.user.id;
  created.userIds.add(staffUserId);
  await prisma.user.update({ where: { id: staffUserId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
  await prisma.employee.update({ where: { id: cookId }, data: { userId: staffUserId } });

  const staffToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("staff"), password: "staff-passphrase-12" } })
  ).body.data.accessToken;

  const mine = await api("/me/payslips", { token: staffToken });
  check("an employee can read their own payslip with no special permission", mine.status === 200, mine.body?.error);
  check("and sees exactly one", mine.body.data.length === 1, mine.body?.data?.length);
  check("with its lines", mine.body.data[0].lines.length >= 3, mine.body?.data?.[0]?.lines);

  const staffAll = await api(`/admin/payslips?periodId=${periodId}`, { token: staffToken });
  check("reading everybody's still needs the permission", staffAll.status === 403, staffAll.body?.error);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  const ids = [...new Set([...created.userIds, ...users.map((u) => u.id)])];
  const branchIds = [...created.branchIds];

  const employees = await prisma.employee.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);
  const periods = await prisma.payrollPeriod.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } });
  const periodIds = periods.map((p) => p.id);

  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: branchIds } } } });
  await prisma.journalEntry.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.payslipLine.deleteMany({ where: { payslip: { periodId: { in: periodIds } } } });
  await prisma.payslip.deleteMany({ where: { periodId: { in: periodIds } } });
  await prisma.payrollPeriod.deleteMany({ where: { id: { in: periodIds } } });

  await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.attendancePunch.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { device: { branchId: { in: branchIds } } }] } });
  await prisma.attendanceDevice.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.shift.deleteMany({ where: { branchId: { in: branchIds } } });

  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.leaveBalance.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.leaveType.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.holiday.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.employeeSalaryComponent.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.department.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.accountingPeriod.deleteMany({ where: { fiscalYear: { name: { contains: String(stamp) } } } });
  await prisma.fiscalYear.deleteMany({ where: { name: { contains: String(stamp) } } });

  await prisma.outboxEvent.deleteMany({});
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.rolePermission.deleteMany({ where: { role: { name: { contains: String(stamp) } } } });
  await prisma.role.deleteMany({ where: { name: { contains: String(stamp) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: "E2EC" } } });
  await prisma.setting.deleteMany({});

  const leftovers = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    employees: await prisma.employee.count(),
    departments: await prisma.department.count(),
    shifts: await prisma.shift.count(),
    assignments: await prisma.shiftAssignment.count(),
    devices: await prisma.attendanceDevice.count(),
    punches: await prisma.attendancePunch.count(),
    attendanceDays: await prisma.attendanceDay.count(),
    leaveTypes: await prisma.leaveType.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    holidays: await prisma.holiday.count(),
    payrollPeriods: await prisma.payrollPeriod.count(),
    payslips: await prisma.payslip.count(),
    journalEntries: await prisma.journalEntry.count(),
    fiscalYears: await prisma.fiscalYear.count(),
    outbox: await prisma.outboxEvent.count(),
    roles: await prisma.role.count(),
    accounts: await prisma.account.count(),
  };
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
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

  const ignore = ["roles", "accounts"];
  const dirty = Object.entries(leftovers).filter(([key, value]) => !ignore.includes(key) && value > 0);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
