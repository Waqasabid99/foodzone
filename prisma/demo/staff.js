/**
 * The people, and the box on the wall that watches them arrive.
 *
 * Attendance is the module a restaurant owner tests hardest on a demo, because
 * it is the one they already do badly on paper. It needs three things to be
 * worth showing: employees with biometric ids, a terminal registered to each
 * branch, and punches that look like a shift rather than a straight line.
 */

export const DEPARTMENTS = [
  { code: "KIT", name: "Kitchen" },
  { code: "FOH", name: "Front of house" },
  { code: "DEL", name: "Delivery" },
];

/**
 * `biometricId` is the number the terminal knows somebody by — on a real
 * ZKTeco it is the enrolment id on the device, not anything from this system.
 * Matching punches to people happens on that number, which is why an employee
 * who was never enrolled produces "unmatched" punches rather than silence.
 */
export const EMPLOYEES = [
  { code: "EMP-001", first: "Imran", last: "Shah", department: "KIT", designation: "Head chef", biometricId: "1001", branch: 0, salary: 145000 },
  { code: "EMP-002", first: "Adeel", last: "Hussain", department: "KIT", designation: "Line cook", biometricId: "1002", branch: 0, salary: 68000 },
  { code: "EMP-003", first: "Sana", last: "Javed", department: "KIT", designation: "Prep cook", biometricId: "1003", branch: 0, salary: 52000 },
  { code: "EMP-004", first: "Bilal", last: "Anwar", department: "FOH", designation: "Shift supervisor", biometricId: "1004", branch: 0, salary: 85000 },
  { code: "EMP-005", first: "Hira", last: "Saleem", department: "FOH", designation: "Cashier", biometricId: "1005", branch: 0, salary: 55000 },
  { code: "EMP-006", first: "Kashif", last: "Mehmood", department: "DEL", designation: "Rider", biometricId: "1006", branch: 0, salary: 48000 },
  { code: "EMP-007", first: "Nadia", last: "Aslam", department: "FOH", designation: "Branch manager", biometricId: "2001", branch: 1, salary: 125000 },
  { code: "EMP-008", first: "Faisal", last: "Iqbal", department: "KIT", designation: "Line cook", biometricId: "2002", branch: 1, salary: 66000 },
  { code: "EMP-009", first: "Rabia", last: "Noor", department: "FOH", designation: "Cashier", biometricId: "2003", branch: 1, salary: 54000 },
  { code: "EMP-010", first: "Danish", last: "Raza", department: "DEL", designation: "Rider", biometricId: "2004", branch: 1, salary: 47000 },
];

/**
 * One terminal per branch, named the way they are named on a wall.
 *
 * The vendor is recorded because it decides how punches reach us: these are
 * the two common in Pakistan, and neither speaks our HTTP endpoint natively —
 * see `scripts/attendance-terminal.mjs`.
 */
export const DEVICES = [
  { serial: "ZK-CLF-0001", name: "Clifton staff entrance", vendor: "ZKTeco", model: "K40", branch: 0 },
  { serial: "ZK-GLS-0001", name: "Gulshan back door", vendor: "eSSL", model: "X990", branch: 1 },
];
