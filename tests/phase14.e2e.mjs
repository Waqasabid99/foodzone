import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgPoolOptions } from "../src/lib/db-pool.js";

/**
 * Phase 14 — the People screens, and the branch wall behind them.
 *
 * Phase 12 proves the HR arithmetic against a database. This proves the thing
 * that arithmetic never touches: **whose data a scoped manager can reach.**
 *
 * `can()` answers "may this person do X at branch B?" — the right question for
 * one record and the wrong one for a list. A manager holding `employees.read`
 * at one outlet does hold it, somewhere, so a list endpoint that only checks
 * the permission hands them the whole company the moment they leave the branch
 * filter off. With `employees.view_salary` it hands them everyone's pay.
 *
 * Two branches, one manager scoped to the first, and every People endpoint
 * asked for the second one's data by name and by omission. Plus every new page
 * rendered, because a screen that 500s is not shipped.
 *
 * Start a server first:
 *   APP_URL=http://localhost:3100 CRON_SECRET=phase2-test-secret npx next start -p 3100
 */
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, ...pgPoolOptions() }) });

const stamp = Date.now();
const tag = `e2e14-${stamp}`;
const emailOf = (name) => `${tag}-${name}@example.test`;
const short = String(stamp).slice(-5);
const created = { userIds: new Set(), branchIds: new Set(), roleIds: new Set(), deptIds: new Set() };

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log("PASS ", name);
  } else {
    failures.push(name);
    console.log("FAIL ", name, detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 300) : "");
  }
}

let ipCounter = 0;
const nextIp = () => `10.94.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

async function api(pathname, { method = "GET", body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/v1${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
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
    json = null;
  }
  return { status: res.status, body: json };
}

/** Fetches a dashboard page as a signed-in browser would. */
async function page(pathname, cookie) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { cookie, "x-forwarded-for": nextIp() },
    redirect: "manual",
  });
  const html = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), html };
}

async function loginCookies(email, password) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email, password, client: "WEB" }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const body = await res.json();
  return {
    token: body?.data?.accessToken,
    cookie: setCookie.map((line) => line.split(";")[0]).join("; "),
  };
}

const YEAR = 2026;
const dayOf = (d) => `${YEAR}-04-${String(d).padStart(2, "0")}`;
const at = (d, time) => `${dayOf(d)}T${time}:00Z`;

async function main() {
  // ================= SETUP: two branches =================
  const adminReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P14 Admin", email: emailOf("admin"), password: "admin-passphrase-14" },
  });
  const adminId = adminReg.body.data.user.id;
  created.userIds.add(adminId);
  await prisma.user.update({
    where: { id: adminId },
    data: { isSuperAdmin: true, status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const admin = await loginCookies(emailOf("admin"), "admin-passphrase-14");
  const adminToken = admin.token;

  const mine = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `A${short}`, name: `P14 Mine ${short}`, city: "Karachi", timezone: "Asia/Karachi" },
  });
  const theirs = await api("/admin/branches", {
    method: "POST",
    token: adminToken,
    body: { code: `B${short}`, name: `P14 Theirs ${short}`, city: "Lahore", timezone: "Asia/Karachi" },
  });
  check("two branches exist", mine.status === 201 && theirs.status === 201, { mine: mine.body, theirs: theirs.body });
  const mineId = mine.body.data.id;
  const theirsId = theirs.body.data.id;
  created.branchIds.add(mineId);
  created.branchIds.add(theirsId);

  // ================= staff at each =================
  const dept = await api("/admin/departments", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Kitchen ${short}`, code: `K${short}` },
  });
  created.deptIds.add(dept.body?.data?.id);

  const makeEmployee = async (branchId, name, salary, bio) =>
    api("/admin/employees", {
      method: "POST",
      token: adminToken,
      body: {
        branchId,
        departmentId: dept.body.data.id,
        firstName: name,
        lastName: `P14${short}`,
        designation: "Line cook",
        salaryType: "MONTHLY",
        baseSalary: salary,
        biometricId: bio,
        joinedAt: `${YEAR}-01-01`,
      },
    });

  const ours = await makeEmployee(mineId, "Ayesha", 40000, `BIOA${short}`);
  const other = await makeEmployee(theirsId, "Bilal", 90000, `BIOB${short}`);
  check("an employee at each branch", ours.status === 201 && other.status === 201, { ours: ours.body, other: other.body });
  const ourId = ours.body.data.id;
  const otherId = other.body.data.id;

  // ================= shifts and rosters at each =================
  const makeShift = async (branchId, name) =>
    api("/admin/shifts", {
      method: "POST",
      token: adminToken,
      body: { branchId, name: `${name} ${short}`, startTime: "22:00", endTime: "06:00", breakMinutes: 30 },
    });

  const ourShift = await makeShift(mineId, "Nights");
  const otherShift = await makeShift(theirsId, "Nights");
  check("a night shift rolls past midnight in the database too", ourShift.body?.data?.endMinute === 1800, ourShift.body?.data);
  check("and is reported as crossing midnight", ourShift.body?.data?.crossesMidnight === true, ourShift.body?.data);

  for (const [employeeId, shiftId] of [
    [ourId, ourShift.body.data.id],
    [otherId, otherShift.body.data.id],
  ]) {
    await api("/admin/roster", {
      method: "POST",
      token: adminToken,
      body: { employeeId, shiftId, from: dayOf(1), to: dayOf(3) },
    });
  }

  // Punches, then days, at both branches.
  for (const [employeeId, day] of [
    [ourId, 1],
    [otherId, 1],
  ]) {
    await api("/admin/attendance-punches/manual", {
      method: "POST",
      token: adminToken,
      body: { employeeId, punchedAt: at(day, "22:05"), direction: "IN" },
    });
    await api("/admin/attendance-punches/manual", {
      method: "POST",
      token: adminToken,
      body: { employeeId, punchedAt: at(day + 1, "06:02"), direction: "OUT" },
    });
  }

  const derived = await api("/admin/attendance/derive", {
    method: "POST",
    token: adminToken,
    body: { from: dayOf(1), to: dayOf(3) },
  });
  check("attendance derives for both branches as an admin", derived.status === 200, derived.body);

  const ourDay = await prisma.attendanceDay.findFirst({ where: { employeeId: ourId }, select: { id: true } });
  const otherDay = await prisma.attendanceDay.findFirst({ where: { employeeId: otherId }, select: { id: true } });
  check("a night shift's punches land on the day it started", Boolean(ourDay && otherDay), { ourDay, otherDay });

  // Terminals at each branch.
  const makeDevice = async (branchId, name) =>
    api("/admin/attendance-devices", {
      method: "POST",
      token: adminToken,
      body: { branchId, name: `${name} ${short}`, serialNumber: `SN-${name}-${short}` },
    });
  const ourDevice = await makeDevice(mineId, "Ours");
  const otherDevice = await makeDevice(theirsId, "Theirs");
  check("a terminal's key is returned once on registration", typeof ourDevice.body?.data?.apiKey === "string", Object.keys(ourDevice.body?.data ?? {}));
  check("and is never readable afterwards", (await api(`/admin/attendance-devices/${ourDevice.body.data.id}`, { token: adminToken })).body?.data?.apiKey === undefined);

  // ================= a manager scoped to one branch =================
  const mgrReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P14 Manager", email: emailOf("mgr"), password: "mgr-passphrase-14" },
  });
  const mgrId = mgrReg.body.data.user.id;
  created.userIds.add(mgrId);
  await prisma.user.update({ where: { id: mgrId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const role = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Branch Manager ${short}`, description: "One outlet only", scope: "BRANCH", level: 40 },
  });
  created.roleIds.add(role.body?.data?.id);
  await api(`/admin/roles/${role.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: {
      permissionKeys: [
        "dashboard.view",
        "employees.read",
        "employees.update",
        "employees.view_salary",
        "departments.read",
        "shifts.read",
        "shifts.manage",
        "rosters.read",
        "rosters.manage",
        "attendance.read",
        "attendance.edit",
        "attendance.approve",
        "attendance_punches.read",
        "attendance_punches.create_manual",
        "attendance_devices.read",
        "leave_requests.read",
        "leave_requests.create",
        "holidays.read",
      ],
    },
  });
  // Granted at ONE branch. Everything below asks for the other one.
  await api(`/admin/users/${mgrId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: role.body.data.id, branchId: mineId },
  });
  const mgr = await loginCookies(emailOf("mgr"), "mgr-passphrase-14");
  const mgrToken = mgr.token;

  // ================= THE WALL: lists =================
  const allEmployees = await api("/admin/employees?limit=100", { token: mgrToken });
  check("a scoped manager can list employees at all", allEmployees.status === 200, allEmployees.body?.error);
  const listedIds = (allEmployees.body?.data?.items ?? []).map((row) => row.id);
  check("their own branch's staff are listed", listedIds.includes(ourId), listedIds.length);
  // The bug this whole phase exists for: omit the filter, get the company.
  check(
    "another branch's staff are NOT listed when the filter is omitted",
    !listedIds.includes(otherId),
    { listed: listedIds.length, leaked: otherId },
  );

  const askedForTheirs = await api(`/admin/employees?branchId=${theirsId}`, { token: mgrToken });
  check("asking for another branch by name is refused", askedForTheirs.status === 403, askedForTheirs.status);

  // ================= THE WALL: salary =================
  const ourRow = (allEmployees.body?.data?.items ?? []).find((row) => row.id === ourId);
  check("pay is visible where the key is held", Number(ourRow?.baseSalary) === 40000, ourRow);

  const theirRecord = await api(`/admin/employees/${otherId}`, { token: mgrToken });
  check("another branch's employee reads as missing, not forbidden", theirRecord.status === 404, theirRecord.status);

  // ================= THE WALL: records by id =================
  const editTheirs = await api(`/admin/employees/${otherId}`, {
    method: "PATCH",
    token: mgrToken,
    body: { designation: "Hacked" },
  });
  check("editing another branch's employee is refused", editTheirs.status === 404, editTheirs.status);

  const theirShift = await api(`/admin/shifts/${otherShift.body.data.id}`, { token: mgrToken });
  check("another branch's shift is out of reach", theirShift.status === 404, theirShift.status);

  const retimeTheirs = await api(`/admin/shifts/${otherShift.body.data.id}`, {
    method: "PATCH",
    token: mgrToken,
    body: { name: "Hacked" },
  });
  check("and cannot be edited", retimeTheirs.status === 404, retimeTheirs.status);

  const theirDay = await api(`/admin/attendance/${otherDay.id}/correct`, {
    method: "PATCH",
    token: mgrToken,
    body: { status: "PRESENT", payableFactor: 1, reason: "not mine to correct" },
  });
  check("another branch's attendance cannot be corrected", theirDay.status === 404, theirDay.status);

  const revertTheirs = await api(`/admin/attendance/${otherDay.id}/revert`, { method: "POST", token: mgrToken, body: {} });
  check("nor reverted", revertTheirs.status === 404, revertTheirs.status);

  const rosterTheirs = await api("/admin/roster", {
    method: "POST",
    token: mgrToken,
    body: { employeeId: otherId, shiftId: otherShift.body.data.id, from: dayOf(5), to: dayOf(5) },
  });
  check("another branch's employee cannot be rostered", rosterTheirs.status === 404, rosterTheirs.status);

  const unrosterTheirs = await api("/admin/roster/assignment", {
    method: "DELETE",
    token: mgrToken,
    body: { employeeId: otherId, workDate: dayOf(1) },
  });
  check("nor un-rostered", unrosterTheirs.status === 404, unrosterTheirs.status);

  const punchTheirs = await api("/admin/attendance-punches/manual", {
    method: "POST",
    token: mgrToken,
    body: { employeeId: otherId, punchedAt: at(2, "23:00"), direction: "IN" },
  });
  check("a punch cannot be vouched for at another branch", punchTheirs.status === 404, punchTheirs.status);

  const theirDevice = await api(`/admin/attendance-devices/${otherDevice.body.data.id}`, { token: mgrToken });
  check("another branch's terminal is out of reach", theirDevice.status === 404, theirDevice.status);

  // ================= THE WALL: sweeping writes =================
  const sweepDerive = await api("/admin/attendance/derive", {
    method: "POST",
    token: mgrToken,
    body: { from: dayOf(1), to: dayOf(3) },
  });
  check("a manager may rebuild attendance with no branch named", sweepDerive.status === 200, sweepDerive.body?.error);
  check(
    "but the rebuild only reaches their own branch",
    sweepDerive.body?.data?.employees === 1,
    sweepDerive.body?.data,
  );

  const sweepApprove = await api("/admin/attendance/approve", {
    method: "POST",
    token: mgrToken,
    body: { from: dayOf(1), to: dayOf(3) },
  });
  check("a manager may approve with no branch named", sweepApprove.status === 200, sweepApprove.body?.error);

  const theirsApproved = await prisma.attendanceDay.count({
    where: { employeeId: otherId, approvedAt: { not: null } },
  });
  // An approval is a signature. It must never reach a branch the signer has no
  // authority at, however broadly they asked.
  check("approving 'everything' never signs off another branch", theirsApproved === 0, theirsApproved);

  const oursApproved = await prisma.attendanceDay.count({
    where: { employeeId: ourId, approvedAt: { not: null } },
  });
  check("their own branch is signed off", oursApproved > 0, oursApproved);

  // ================= THE WALL: the other lists =================
  const shiftList = await api("/admin/shifts", { token: mgrToken });
  const shiftIds = (shiftList.body?.data ?? []).map((row) => row.id);
  check("shift lists stop at the branch wall", shiftIds.includes(ourShift.body.data.id) && !shiftIds.includes(otherShift.body.data.id), shiftIds.length);

  const rosterList = await api(`/admin/roster?from=${dayOf(1)}&to=${dayOf(3)}`, { token: mgrToken });
  const rosterEmployees = new Set((rosterList.body?.data ?? []).map((row) => row.employeeId));
  check("the rota stops at the branch wall", rosterEmployees.has(ourId) && !rosterEmployees.has(otherId), [...rosterEmployees].length);

  const dayList = await api(`/admin/attendance?from=${dayOf(1)}&to=${dayOf(3)}`, { token: mgrToken });
  const dayEmployees = new Set((dayList.body?.data?.items ?? []).map((row) => row.employeeId));
  check("attendance stops at the branch wall", dayEmployees.has(ourId) && !dayEmployees.has(otherId), [...dayEmployees].length);

  const summary = await api(`/admin/attendance/summary?from=${dayOf(1)}&to=${dayOf(3)}`, { token: mgrToken });
  const summaryEmployees = new Set((summary.body?.data ?? []).map((row) => row.employeeId));
  check("the payroll roll-up stops at the branch wall", !summaryEmployees.has(otherId), [...summaryEmployees].length);

  const punchList = await api(`/admin/attendance-punches?from=${dayOf(1)}&to=${dayOf(4)}`, { token: mgrToken });
  const punchEmployees = new Set((punchList.body?.data?.items ?? []).map((row) => row.employeeId));
  check("raw punches stop at the branch wall", !punchEmployees.has(otherId), [...punchEmployees].length);

  const deviceList = await api("/admin/attendance-devices", { token: mgrToken });
  const deviceIds = (deviceList.body?.data ?? []).map((row) => row.id);
  check("terminals stop at the branch wall", deviceIds.includes(ourDevice.body.data.id) && !deviceIds.includes(otherDevice.body.data.id), deviceIds.length);

  const health = await api("/admin/attendance-devices/health", { token: mgrToken });
  check("so does the health board", health.body?.data?.total === 1, health.body?.data);

  // ================= salary is its own wall =================
  const noPayReg = await api("/auth/register", {
    method: "POST",
    body: { name: "P14 Supervisor", email: emailOf("sup"), password: "sup-passphrase-14" },
  });
  const supId = noPayReg.body.data.user.id;
  created.userIds.add(supId);
  await prisma.user.update({ where: { id: supId }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });

  const supRole = await api("/admin/roles", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Supervisor ${short}`, description: "Sees people, not pay", scope: "BRANCH", level: 50 },
  });
  created.roleIds.add(supRole.body?.data?.id);
  await api(`/admin/roles/${supRole.body.data.id}/permissions`, {
    method: "PUT",
    token: adminToken,
    body: { permissionKeys: ["dashboard.view", "employees.read", "rosters.read", "attendance.read"] },
  });
  await api(`/admin/users/${supId}/roles`, {
    method: "POST",
    token: adminToken,
    body: { roleId: supRole.body.data.id, branchId: mineId },
  });
  const sup = await loginCookies(emailOf("sup"), "sup-passphrase-14");

  const supList = await api("/admin/employees?limit=100", { token: sup.token });
  const supRow = (supList.body?.data?.items ?? []).find((row) => row.id === ourId);
  check("a supervisor sees who works here", Boolean(supRow), supList.body?.data?.items?.length);
  check("but no pay figure reaches them in a list", supRow?.baseSalary === undefined, supRow);

  const supOne = await api(`/admin/employees/${ourId}`, { token: sup.token });
  check("nor on the record itself", supOne.body?.data?.baseSalary === undefined, Object.keys(supOne.body?.data ?? {}));
  check("and the rest of the record still reads", supOne.body?.data?.firstName === "Ayesha", supOne.body?.data?.firstName);

  // ================= THE SCREENS =================
  const adminPages = [
    "/dashboard/employees",
    `/dashboard/employees/${ourId}`,
    `/dashboard/employees/${ourId}/edit`,
    "/dashboard/employees/new",
    "/dashboard/departments",
    "/dashboard/shifts",
    "/dashboard/shifts/new",
    `/dashboard/shifts/${ourShift.body.data.id}`,
    "/dashboard/rosters",
    `/dashboard/rosters?week=${dayOf(1)}`,
    "/dashboard/attendance",
    `/dashboard/attendance?from=${dayOf(1)}&to=${dayOf(3)}`,
    `/dashboard/attendance/${ourDay.id}`,
    "/dashboard/attendance/unmatched",
    "/dashboard/devices",
    "/dashboard/devices/new",
    `/dashboard/devices/${ourDevice.body.data.id}`,
  ];

  let rendered = 0;
  for (const pathname of adminPages) {
    const result = await page(pathname, admin.cookie);
    if (result.status === 200) rendered += 1;
    else check(`page renders: ${pathname}`, false, { status: result.status, location: result.location });
  }
  check(`every People page renders for an admin (${rendered}/${adminPages.length})`, rendered === adminPages.length, rendered);

  // The pages a scoped manager opens must not 500 on data they cannot see.
  const mgrPages = ["/dashboard/employees", "/dashboard/rosters", "/dashboard/attendance", "/dashboard/shifts", "/dashboard/devices"];
  let mgrRendered = 0;
  for (const pathname of mgrPages) {
    const result = await page(pathname, mgr.cookie);
    if (result.status === 200) mgrRendered += 1;
    else check(`manager page renders: ${pathname}`, false, { status: result.status, location: result.location });
  }
  check(`the People pages render for a scoped manager (${mgrRendered}/${mgrPages.length})`, mgrRendered === mgrPages.length, mgrRendered);

  const mgrEmployees = await page("/dashboard/employees", mgr.cookie);
  check("the employee list page shows their own staff", mgrEmployees.html.includes("Ayesha"), mgrEmployees.status);
  // Rendering is the last place a leak can happen: the page calls the service
  // directly rather than going through the route that filters.
  check("and does not render another branch's staff", !mgrEmployees.html.includes("Bilal"), mgrEmployees.status);

  const supEmployees = await page("/dashboard/employees", sup.cookie);
  check("a supervisor's employee page renders", supEmployees.status === 200, supEmployees.status);
  check("with no salary figure on it", !supEmployees.html.includes("40,000") && !supEmployees.html.includes("40000"), supEmployees.status);

  // A page for a record at another branch is a 404, not a 500 and not a leak.
  const theirPage = await page(`/dashboard/employees/${otherId}`, mgr.cookie);
  check("another branch's employee page is not found", theirPage.status === 404, theirPage.status);

  const theirDayPage = await page(`/dashboard/attendance/${otherDay.id}`, mgr.cookie);
  check("another branch's attendance page is not found", theirDayPage.status === 404, theirDayPage.status);

  const theirDevicePage = await page(`/dashboard/devices/${otherDevice.body.data.id}`, mgr.cookie);
  check("another branch's terminal page is not found", theirDevicePage.status === 404, theirDevicePage.status);

  // ================= LEAVE, HOLIDAYS AND PAYROLL =================
  const leaveType = await api("/admin/leave-types", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Annual ${short}`, code: `AL${short}`, isPaid: true, annualQuota: 14 },
  });
  check("a kind of leave is created", leaveType.status === 201, leaveType.body);
  const leaveTypeId = leaveType.body.data.id;

  const balances = await api("/admin/leave-balances/open", {
    method: "POST",
    token: adminToken,
    body: { employeeId: ourId, year: YEAR },
  });
  check("a year's balances are opened", balances.status === 200, balances.body?.error);

  const request = await api("/admin/leave-requests", {
    method: "POST",
    token: adminToken,
    body: { employeeId: ourId, leaveTypeId, startDate: dayOf(8), endDate: dayOf(9), reason: "family" },
  });
  check("leave is requested", request.status === 201, request.body);
  const requestId = request.body.data.id;

  // Nothing comes off a balance until approval: holding days against a pending
  // request blocks the employee from asking for anything else.
  const beforeApproval = await prisma.leaveBalance.findFirst({
    where: { employeeId: ourId, leaveTypeId, year: YEAR },
    select: { usedDays: true },
  });
  check("a pending request consumes no balance", Number(beforeApproval?.usedDays) === 0, beforeApproval);

  const approvedLeave = await api(`/admin/leave-requests/${requestId}/approve`, {
    method: "POST",
    token: adminToken,
    body: { note: "fine" },
  });
  check("leave is approved", approvedLeave.status === 200, approvedLeave.body?.error);

  const afterApproval = await prisma.leaveBalance.findFirst({
    where: { employeeId: ourId, leaveTypeId, year: YEAR },
    select: { usedDays: true },
  });
  check("approval is what consumes the balance", Number(afterApproval?.usedDays) === 2, afterApproval);

  const theirRequest = await api("/admin/leave-requests", {
    method: "POST",
    token: mgrToken,
    body: { employeeId: otherId, leaveTypeId, startDate: dayOf(8), endDate: dayOf(8) },
  });
  check("leave cannot be booked for another branch's staff", theirRequest.status === 404, theirRequest.status);

  const leaveList = await api("/admin/leave-requests?limit=100", { token: mgrToken });
  const leaveEmployees = new Set((leaveList.body?.data?.items ?? []).map((row) => row.employeeId));
  check("leave lists stop at the branch wall", !leaveEmployees.has(otherId), [...leaveEmployees].length);

  const holiday = await api("/admin/holidays", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Company Day ${short}`, date: dayOf(12) },
  });
  check("a company-wide holiday needs no branch", holiday.status === 201 && holiday.body.data.branchId === null, holiday.body);

  const localHoliday = await api("/admin/holidays", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 Local ${short}`, date: dayOf(13), branchId: theirsId },
  });
  check("and one can be pinned to a single branch", localHoliday.status === 201, localHoliday.body);

  const holidayList = await api(`/admin/holidays?year=${YEAR}`, { token: mgrToken });
  const holidayNames = (holidayList.body?.data ?? []).map((row) => row.name);
  check("a company-wide holiday is visible to everybody", holidayNames.includes(`P14 Company Day ${short}`), holidayNames);
  check(
    "another branch's own closure is not",
    !holidayNames.includes(`P14 Local ${short}`),
    holidayNames,
  );

  /*
   * Payroll needs a period covering the month it posts into, and only creates
   * one when nothing already covers it. `db:seed` opens the year covering
   * today — July to June by default — so a calendar year requested here would
   * overlap its second half and be refused. One month cannot collide with any
   * shape of year.
   */
  const monthStart = `${YEAR}-04-01`;
  const monthEnd = `${YEAR}-04-30`;
  const covered = await prisma.accountingPeriod.findFirst({
    where: { startDate: { lte: new Date(`${monthStart}T00:00:00Z`) }, endDate: { gte: new Date(`${monthEnd}T00:00:00Z`) } },
    select: { id: true },
  });

  if (!covered) {
    const fiscal = await api("/admin/fiscal-years", {
      method: "POST",
      token: adminToken,
      body: { name: `P14 FY ${short}`, startDate: monthStart, endDate: monthEnd },
    });
    check("a fiscal year covers the run", fiscal.status === 201, fiscal.body);
  }

  await api("/admin/attendance/approve", {
    method: "POST",
    token: adminToken,
    body: { from: dayOf(1), to: dayOf(30) },
  });

  const run = await api("/admin/payroll-periods", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 April ${short}`, startDate: dayOf(1), endDate: dayOf(30), branchId: mineId },
  });
  check("a pay run is opened", run.status === 201, run.body);
  const runId = run.body.data.id;

  const generated = await api(`/admin/payroll-periods/${runId}/generate`, { method: "POST", token: adminToken, body: {} });
  check("payslips are generated from approved attendance", generated.status === 200, generated.body?.error);

  const slips = await api(`/admin/payslips?periodId=${runId}`, { token: adminToken });
  check("one payslip per employee with attendance", (slips.body?.data?.items ?? []).length >= 1, slips.body?.data?.items?.length);
  const payslipId = slips.body?.data?.items?.[0]?.id;
  check("a payslip shows its working", (slips.body?.data?.items?.[0]?.lines ?? []).length >= 1, slips.body?.data?.items?.[0]?.lines);

  // A run at another branch, to prove the wall holds for payroll too.
  const theirRun = await api("/admin/payroll-periods", {
    method: "POST",
    token: adminToken,
    body: { name: `P14 April Theirs ${short}`, startDate: dayOf(1), endDate: dayOf(30), branchId: theirsId },
  });
  const theirRunId = theirRun.body?.data?.id;

  const mgrRuns = await api("/admin/payroll-periods?limit=100", { token: adminToken });
  check("both runs exist for an admin", (mgrRuns.body?.data?.items ?? []).length >= 2, mgrRuns.body?.data?.items?.length);

  const payrollReader = await api(`/admin/payroll-periods/${theirRunId}`, { token: mgrToken });
  // The manager holds no payroll permission at all, so this is a plain refusal.
  check("a manager without payroll permission cannot read a run", payrollReader.status === 403, payrollReader.status);

  // ================= THE REMAINING SCREENS =================
  const morePages = [
    "/dashboard/leave",
    "/dashboard/leave?status=APPROVED",
    "/dashboard/holidays",
    `/dashboard/holidays?year=${YEAR}`,
    "/dashboard/payroll",
    `/dashboard/payroll/${runId}`,
    "/dashboard/payslips",
    `/dashboard/payslips/${payslipId}`,
  ];

  let moreRendered = 0;
  for (const pathname of morePages) {
    const result = await page(pathname, admin.cookie);
    if (result.status === 200) moreRendered += 1;
    else check(`page renders: ${pathname}`, false, { status: result.status, location: result.location });
  }
  check(`every leave and payroll page renders (${moreRendered}/${morePages.length})`, moreRendered === morePages.length, moreRendered);

  const leavePage = await page("/dashboard/leave", mgr.cookie);
  check("the leave page renders for a scoped manager", leavePage.status === 200, leavePage.status);
  check("and shows none of another branch's leave", !leavePage.html.includes("Bilal"), leavePage.status);

  // ================= a shift that has been worked is frozen =================
  const retime = await api(`/admin/shifts/${ourShift.body.data.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { startTime: "20:00", endTime: "04:00" },
  });
  check("a shift already worked cannot be retimed", retime.status === 409, retime.status);
  const rename = await api(`/admin/shifts/${ourShift.body.data.id}`, {
    method: "PATCH",
    token: adminToken,
    body: { name: `Renamed ${short}` },
  });
  check("but it can still be renamed", rename.status === 200, rename.body?.error);
  check("and the page says how many days are riding on it", rename.body?.data?.workedDays > 0, rename.body?.data?.workedDays);
}

async function cleanup() {
  const employeeIds = (
    await prisma.employee.findMany({ where: { branchId: { in: [...created.branchIds] } }, select: { id: true } })
  ).map((row) => row.id);

  const periods = await prisma.payrollPeriod.findMany({
    where: { OR: [{ branchId: { in: [...created.branchIds] } }, { name: { contains: String(short) } }] },
    select: { id: true },
  });
  const periodIds = periods.map((row) => row.id);
  await prisma.journalLine.deleteMany({ where: { entry: { branchId: { in: [...created.branchIds] } } } });
  await prisma.journalEntry.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.payslipLine.deleteMany({ where: { payslip: { periodId: { in: periodIds } } } });
  await prisma.payslip.deleteMany({ where: { periodId: { in: periodIds } } });
  await prisma.payrollPeriod.deleteMany({ where: { id: { in: periodIds } } });
  await prisma.accountingPeriod.deleteMany({ where: { fiscalYear: { name: { contains: String(short) } } } });
  await prisma.fiscalYear.deleteMany({ where: { name: { contains: String(short) } } });
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.leaveBalance.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.leaveType.deleteMany({ where: { name: { contains: String(short) } } });
  await prisma.holiday.deleteMany({ where: { name: { contains: String(short) } } });
  await prisma.employeeSalaryComponent.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.outboxEvent.deleteMany({});
  await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.attendancePunch.deleteMany({ where: { device: { branchId: { in: [...created.branchIds] } } } });
  await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.attendanceDevice.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.shift.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  await prisma.department.deleteMany({ where: { id: { in: [...created.deptIds].filter(Boolean) } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...created.userIds] } } });
  await prisma.auditLog.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.numberSequence.deleteMany({ where: { branchId: { in: [...created.branchIds] } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.credentialToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.userDevice.deleteMany({ where: { userId: { in: [...created.userIds] } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.role.deleteMany({ where: { id: { in: [...created.roleIds].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [...created.userIds] } } });
  await prisma.branch.deleteMany({ where: { id: { in: [...created.branchIds] } } });

  const remaining = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    employees: await prisma.employee.count(),
    departments: await prisma.department.count(),
    shifts: await prisma.shift.count(),
    assignments: await prisma.shiftAssignment.count(),
    devices: await prisma.attendanceDevice.count(),
    punches: await prisma.attendancePunch.count(),
    attendanceDays: await prisma.attendanceDay.count(),
    roles: await prisma.role.count(),
    leaveTypes: await prisma.leaveType.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    holidays: await prisma.holiday.count(),
    payrollPeriods: await prisma.payrollPeriod.count(),
    payslips: await prisma.payslip.count(),
    fiscalYears: await prisma.fiscalYear.count(),
  };
  console.log("Database after cleanup:", JSON.stringify(remaining));
  return remaining;
}

try {
  await main();
} catch (error) {
  failures.push(`threw: ${error.message}`);
  console.log("THREW", error);
} finally {
  await cleanup().catch((error) => console.log("cleanup failed", error.message));
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
