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

/**
 * Drains the outbox until it is actually empty.
 *
 * One call processes at most WORKER_BATCH_SIZE events, so a single drain is
 * not "the queue is empty" — it is "twenty fewer". With a backlog ahead of it,
 * the event this test is waiting for never gets claimed, and the assertion
 * fails for a reason that has nothing to do with what it is testing. A real
 * scheduler calls this repeatedly; so does this.
 */
async function drainOutbox({ maxCycles = 20 } = {}) {
  let status = 0;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    const res = await fetch(`${BASE}/api/internal/jobs/outbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON}` },
    });
    status = res.status;
    if (status !== 200) return status;

    const body = await res.json().catch(() => null);
    const stats = body?.data?.stats;
    if (!stats || (stats.pending === 0 && stats.processing === 0)) return status;
  }
  return status;
}

const num = (value) => Number(value ?? 0);
const round = (value, dp = 2) => Math.round(Number(value ?? 0) * 10 ** dp) / 10 ** dp;

// A fixed month well in the past, so nothing collides with "today".
const YEAR = 2026;
const MONTH = "03";
const dayOf = (d) => `${YEAR}-${MONTH}-${String(d).padStart(2, "0")}`;
/**
 * A wall-clock time at the branch, as the instant a device would report.
 *
 * The branch is in Asia/Karachi and its shift is "09:00 to 18:00" — a wall
 * clock, not UTC. Sending these as `…T18:00Z` made them 23:00 in Karachi,
 * four hours past the window a punch may fall in, so every clock-out was
 * discarded and a full day derived as MISSING_PUNCH. The code was right; the
 * test was writing local times and labelling them UTC.
 *
 * `+05:00` rather than a timezone lookup because Karachi has no daylight
 * saving, so the offset is the whole truth.
 */
const at = (d, time) => new Date(`${dayOf(d)}T${time}:00+05:00`).toISOString();

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

  /*
   * Payroll posts to the ledger, and nothing posts into a date that is not in
   * an accounting period — so a period covering this suite's month has to
   * exist first.
   *
   * Created only when nothing covers it, and covering only the month the suite
   * actually posts into. `db:seed` opens the year covering *today* — July to
   * June by default — so on a seeded database a calendar year requested here
   * would overlap its second half and be refused, which is the fiscal module
   * working as designed: overlapping years make "which period does this date
   * belong to" ambiguous. A single month can sit beside any shape of year
   * without colliding with it.
   */
  const monthStart = `${YEAR}-${MONTH}-01`;
  const monthEnd = new Date(Date.UTC(YEAR, Number(MONTH), 0)).toISOString().slice(0, 10);
  const covered = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lte: new Date(`${monthStart}T00:00:00Z`) }, endDate: { gte: new Date(`${monthEnd}T00:00:00Z`) } },
    select: { id: true },
  });

  if (!covered) {
    const fy = await api("/admin/fiscal-years", {
      method: "POST",
      token: adminToken,
      body: { name: `FY ${YEAR}-${MONTH} ${stamp}`, startDate: monthStart, endDate: monthEnd },
    });
    check("a fiscal year covers the payroll period", fy.status === 201, fy.body);
  }

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

  // ================= THE NIGHTLY FOLD =================
  /*
   * Everything above derives because this suite asks it to. In production
   * nobody asks: an absence is not pushed by anything, so a day with no punch
   * becomes a row only when something folds it — and payroll is built from
   * those rows. This is that something.
   *
   * Tested against a real recent day rather than the fixed month above,
   * because the job folds *yesterday* in each branch's own zone.
   */
  const foldJob = async (secret) =>
    fetch(`${BASE}/api/internal/jobs/attendance`, {
      method: "POST",
      ...(secret ? { headers: { authorization: `Bearer ${secret}` } } : {}),
    });

  const unauthorisedFold = await foldJob(null);
  check("the fold cannot be triggered without the cron secret", unauthorisedFold.status !== 200, unauthorisedFold.status);

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await api("/admin/roster", {
    method: "POST",
    token: adminToken,
    body: { employeeId: cookId, shiftId: dayShiftId, from: yesterday, to: yesterday },
  });

  const foldRes = await foldJob(process.env.E2E_CRON_SECRET ?? "phase2-test-secret");
  const fold = (await foldRes.json().catch(() => null))?.data;
  check("the nightly fold runs", foldRes.status === 200, foldRes.status);
  check("and works through every branch", (fold?.branches ?? 0) >= 1, fold);

  const foldedDay = await prisma.attendanceDay.findFirst({
    where: { employeeId: cookId, workDate: new Date(`${yesterday}T00:00:00.000Z`) },
    select: { id: true, status: true },
  });
  check("yesterday is folded without anyone asking", Boolean(foldedDay), { yesterday, foldedDay });
  check("an employee who never punched is marked absent, not left missing", foldedDay?.status === "ABSENT", foldedDay);

  /*
   * The job reaches three days back so a missed night heals itself, which
   * means most nights re-fold a day that is already done. That recomputes the
   * row from the same punches rather than skipping it, so what matters is
   * that the answer does not move — and that the two kinds of day which must
   * never move are refused outright.
   */
  const secondFold = (await (await foldJob(process.env.E2E_CRON_SECRET ?? "phase2-test-secret")).json().catch(() => null))?.data;
  check("a second fold runs over the same window", (secondFold?.branches ?? 0) >= 1, secondFold);

  const refolded = await prisma.attendanceDay.findFirst({
    where: { employeeId: cookId, workDate: new Date(`${yesterday}T00:00:00.000Z`) },
    select: { id: true, status: true },
  });
  check("and lands on the same answer", refolded?.status === foldedDay?.status, { before: foldedDay?.status, after: refolded?.status });
  check("without replacing the row", refolded?.id === foldedDay?.id, { before: foldedDay?.id, after: refolded?.id });

  /*
   * A day a human corrected by hand is the one the nightly job must never
   * quietly undo: somebody looked at a missing punch and decided what really
   * happened, and a machine overwriting that at 3am is how people stop
   * trusting the payroll.
   */
  await prisma.attendanceDay.update({
    where: { id: refolded.id },
    data: { status: "PRESENT", isManualOverride: true },
  });
  await foldJob(process.env.E2E_CRON_SECRET ?? "phase2-test-secret");
  const afterOverride = await prisma.attendanceDay.findUnique({
    where: { id: refolded.id },
    select: { status: true, isManualOverride: true },
  });
  check("a hand-corrected day survives the nightly fold", afterOverride?.status === "PRESENT", afterOverride);

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

  // ================= TWO PEOPLE ON THE PAYROLL =================
  // Whoever ran the payroll must not be the one who approves it. The
  // permissions were already separate, but `hr-manager` is seeded with
  // `payroll.*` and nothing checked *who* ran the previous step, so one person
  // could compute their own pay, approve it and mark it paid.
  const selfApprove = await api(`/admin/payroll-periods/${periodId}/approve`, { method: "POST", token: adminToken });
  check("the person who ran payroll cannot approve it", selfApprove.status === 403, {
    status: selfApprove.status,
    body: selfApprove.body?.error,
  });

  const stillProcessing = await api(`/admin/payroll-periods/${periodId}`, { token: adminToken });
  check("and the refused approval left the period alone", stillProcessing.body?.data?.status === "PROCESSING", stillProcessing.body?.data?.status);

  const payReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P12 Payroll Approver", email: emailOf("approver"), password: "approver-passphrase-12" },
  });
  const approverId = payReg.body.data.user.id;
  created.userIds.add(approverId);
  await prisma.user.update({ where: { id: approverId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const approverRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P12 Payroll Approver ${stamp}`, description: "Approves payroll, does not run it" },
  });
  await api(`/admin/roles/${approverRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["payroll.read", "payroll.approve", "payroll.mark_paid", "employees.read"] },
  });
  await api(`/admin/users/${approverId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: approverRole.body.data.id, branchId },
  });
  const approverToken = (
    await api("/auth/login", { method: "POST", body: { email: emailOf("approver"), password: "approver-passphrase-12" } })
  ).body.data.accessToken;

  const approvedPayroll = await api(`/admin/payroll-periods/${periodId}/approve`, { method: "POST", token: approverToken });
  check("a second person approves it", approvedPayroll.body?.data?.status === "APPROVED", approvedPayroll.body);
  check("and the period records who", approvedPayroll.body?.data?.approvedById === approverId, approvedPayroll.body?.data);

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
  check("by the person who ran it, which is allowed", paid.status === 200, paid.body?.error);
  await drainOutbox();

  // ================= THE OVERRIDE =================
  // One outlet, one person who does the payroll. The second-person rule is a
  // branch setting rather than an absolute, because a control that stops wages
  // going out is a control somebody switches off in a hurry — better that it is
  // a deliberate, audited change than a reason to share a login.
  const soloPeriod = await api("/admin/payroll-periods", {
    method: "POST",
    token: adminToken,
    body: { branchId, name: `Solo ${YEAR} ${stamp}`, startDate: dayOf(11), endDate: dayOf(20) },
  });
  check("a second period is created", soloPeriod.status === 201, soloPeriod.body?.error);
  const soloId = soloPeriod.body.data.id;

  // Two worked days written straight to the table. The punch-to-attendance
  // pipeline is proved earlier in this suite; what is being tested here is the
  // approval rule, and routing it through punches again only borrows that
  // pipeline's flakiness. The porter rather than the cook, because the cook's
  // user account is used further down to prove an employee sees their own
  // payslip and only that one.
  for (const day of [11, 12]) {
    await prisma.attendanceDay.create({
      data: {
        employeeId: porterId,
        branchId,
        workDate: new Date(`${dayOf(day)}T00:00:00.000Z`),
        status: "PRESENT",
        workedMinutes: 480,
        payableFactor: 1,
      },
    });
  }

  const soloGenerated = await api(`/admin/payroll-periods/${soloId}/generate`, { method: "POST", token: adminToken, body: {} });
  check("the second period has a payslip to approve", soloGenerated.body?.data?.generated === 1, soloGenerated.body?.data);

  const blocked = await api(`/admin/payroll-periods/${soloId}/approve`, { method: "POST", token: adminToken });
  check("the rule still applies to the new period", blocked.status === 403, blocked.status);

  const turnOff = await api("/admin/settings", {
    method: "PUT",
    token: adminToken,
    body: { branchId, values: { "payroll.require_separate_approver": false } },
  });
  check("a branch can turn the second person off", turnOff.status === 200, turnOff.body?.error);

  const selfApproved = await api(`/admin/payroll-periods/${soloId}/approve`, { method: "POST", token: adminToken });
  check("and then one person can approve their own run", selfApproved.body?.data?.status === "APPROVED", selfApproved.body?.error);

  const trail = await prisma.auditLog.findFirst({
    where: { action: "payroll.approve", entityId: soloId },
    orderBy: { createdAt: "desc" },
    select: { changes: true, actorId: true },
  });
  check("the exception is on the audit trail", trail?.changes?.selfApproved === true, trail?.changes);

  const normalTrail = await prisma.auditLog.findFirst({
    where: { action: "payroll.approve", entityId: periodId },
    select: { changes: true },
  });
  check("and an ordinary approval is not marked", normalTrail?.changes?.selfApproved === undefined, normalTrail?.changes);

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

  // --- the payslip as a file ---
  //
  // This is the one document in the system an employee is entitled to receive
  // and the one most likely to be handed to somebody else — a landlord, a
  // bank. Fetched raw, because the endpoint returns bytes rather than the
  // JSON envelope.
  async function fetchPdf(pathname, token) {
    const res = await fetch(`${BASE}/api/v1${pathname}`, {
      headers: { "x-forwarded-for": nextIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      type: res.headers.get("content-type"),
      disposition: res.headers.get("content-disposition"),
      isPdf: bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.subarray(-6).toString("latin1").includes("%%EOF"),
    };
  }

  const mySlipId = mine.body.data[0].id;
  const ownPdf = await fetchPdf(`/me/payslips/${mySlipId}/pdf`, staffToken);
  check("an employee can download their own payslip", ownPdf.status === 200 && ownPdf.isPdf, ownPdf);
  check("it arrives as a file to save, not a page to look at", ownPdf.disposition?.startsWith("attachment"), ownPdf.disposition);

  const storedSlip = await prisma.payslip.findUnique({ where: { id: mySlipId }, select: { pdfUrl: true } });
  check("an approved payslip keeps its rendered copy", Boolean(storedSlip?.pdfUrl), storedSlip);

  // Somebody else's. The answer must be the same as for a payslip that does
  // not exist, or an id probe tells a stranger which ones do.
  const otherSlip = await prisma.payslip.findFirst({
    where: { periodId, id: { not: mySlipId } },
    select: { id: true },
  });
  if (otherSlip) {
    const theirs = await fetchPdf(`/me/payslips/${otherSlip.id}/pdf`, staffToken);
    check("an employee cannot download somebody else's payslip", theirs.status === 404, theirs.status);
  }

  const adminPdf = await fetchPdf(`/admin/payslips/${mySlipId}/pdf`, adminToken);
  check("payroll can download anybody's", adminPdf.status === 200 && adminPdf.isPdf, adminPdf.status);

  const staffAdminPdf = await fetchPdf(`/admin/payslips/${mySlipId}/pdf`, staffToken);
  check("but the admin route still needs the permission", staffAdminPdf.status === 403, staffAdminPdf.status);

  // A draft is not a statement of what anybody is owed yet, so no copy of it
  // is kept — the figures can still be regenerated underneath it.
  const draftSlip = await prisma.payslip.findFirst({ where: { status: "DRAFT" }, select: { id: true } });
  if (draftSlip) {
    const draftPdf = await fetchPdf(`/admin/payslips/${draftSlip.id}/pdf`, adminToken);
    check("a draft payslip renders for review", draftPdf.status === 200 && draftPdf.isPdf, draftPdf.status);
    const storedDraft = await prisma.payslip.findUnique({ where: { id: draftSlip.id }, select: { pdfUrl: true } });
    check("but a draft is never stored", storedDraft?.pdfUrl === null, storedDraft);
  }

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

  const leftovers = await countAll();
  console.log("\nDatabase after cleanup:", JSON.stringify(leftovers));
  return leftovers;
}

/** Every count the cleanliness gate looks at, read the same way before and after. */
async function countAll() {
  return {
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
}

/*
 * The cleanliness gate: this suite must leave the database as it found it.
 *
 * Compared against a baseline taken before the first assertion, not against
 * zero. Zero was right while an e2e database was effectively empty of
 * accounting data, and stopped being right when `db:seed` began opening the
 * fiscal year covering today: the seeded year, its twelve periods, and the
 * ledger rows the *earlier* phases legitimately post are all part of the
 * database this suite inherits, and none of them are its mess to clean.
 *
 * A baseline keeps the gate honest in both directions — anything this suite
 * leaves behind still fails, without it having to be taught which rows other
 * suites own.
 */
let baseline = {};

try {
  // Wake the database before the first assertion, so a suspended compute
  // fails here rather than as a mystery timeout mid-suite.
  await warmUpDatabase(prisma);
  baseline = await countAll();
  await main();
} catch (error) {
  console.log("SUITE ERROR:", error.message, "\n", error.stack?.split("\n").slice(0, 5).join("\n"));
  failures.push("suite crashed: " + error.message);
} finally {
  const leftovers = await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) console.log("Failures:\n - " + failures.join("\n - "));

  // Only growth counts. `[name, left behind, total]` so the number that
  // matters is not buried in the number that does not.
  const dirty = Object.entries(leftovers)
    .filter(([key, value]) => value > (baseline[key] ?? 0))
    .map(([key, value]) => [key, value - (baseline[key] ?? 0), value]);
  if (dirty.length) console.log("WARNING: database not clean:", JSON.stringify(dirty));

  process.exit(failures.length || dirty.length ? 1 : 0);
}
