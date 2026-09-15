import test from "node:test";
import assert from "node:assert/strict";

// Create in-memory mock for localStorage
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

globalThis.window = {
  localStorage: new MockLocalStorage(),
};

const {
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  checkLoginLockout,
  recordFailedLogin,
  resetLoginLockout,
  formatLockoutRemainingTime,
} = await import("../src/modules/auth/loginLockout.ts");

test("MAX_LOGIN_ATTEMPTS is 5 and LOCKOUT_DURATION_MS is 5 hours (18,000,000 ms)", () => {
  assert.equal(MAX_LOGIN_ATTEMPTS, 5);
  assert.equal(LOCKOUT_DURATION_MS, 5 * 60 * 60 * 1000);
});

test("formatLockoutRemainingTime properly formats remaining duration", () => {
  assert.equal(formatLockoutRemainingTime(5 * 3600 * 1000), "5h 0m 0s");
  assert.equal(formatLockoutRemainingTime(4 * 3600 * 1000 + 35 * 60 * 1000 + 20 * 1000), "4h 35m 20s");
  assert.equal(formatLockoutRemainingTime(45 * 1000), "45s");
  assert.equal(formatLockoutRemainingTime(0), "0s");
});

test("failed attempts increment counter and trigger 5-hour lockout on 5th failure", () => {
  globalThis.window.localStorage.clear();
  const testEmail = "test@company.com";
  const baseTime = 1000000;

  // Attempts 1 to 4 should NOT lock
  for (let i = 1; i <= 4; i++) {
    const status = recordFailedLogin(testEmail, baseTime + i * 1000);
    assert.equal(status.isLocked, false);
    assert.equal(status.failedAttempts, i);
    assert.equal(status.attemptsRemaining, 5 - i);
  }

  // 5th attempt MUST lock
  const lockedStatus = recordFailedLogin(testEmail, baseTime + 5000);
  assert.equal(lockedStatus.isLocked, true);
  assert.equal(lockedStatus.failedAttempts, 5);
  assert.equal(lockedStatus.attemptsRemaining, 0);
  assert.equal(lockedStatus.remainingMs, LOCKOUT_DURATION_MS);
  assert.equal(lockedStatus.lockedUntil, baseTime + 5000 + LOCKOUT_DURATION_MS);

  // Subsequent checkLoginLockout retains locked state
  const checkStatus = checkLoginLockout(testEmail, baseTime + 5000 + 10000); // 10s later
  assert.equal(checkStatus.isLocked, true);
  assert.equal(checkStatus.remainingMs, LOCKOUT_DURATION_MS - 10000);
});

test("lockout expires automatically after 5 hours", () => {
  globalThis.window.localStorage.clear();
  const testEmail = "user2@bms.com";
  const baseTime = 2000000;

  // Trigger lockout
  for (let i = 1; i <= 5; i++) {
    recordFailedLogin(testEmail, baseTime);
  }

  const lockedStatus = checkLoginLockout(testEmail, baseTime);
  assert.equal(lockedStatus.isLocked, true);

  // Time traveling 5 hours + 1 ms into future
  const futureTime = baseTime + LOCKOUT_DURATION_MS + 1;
  const expiredStatus = checkLoginLockout(testEmail, futureTime);
  assert.equal(expiredStatus.isLocked, false);
  assert.equal(expiredStatus.failedAttempts, 0);
  assert.equal(expiredStatus.attemptsRemaining, 5);
});

test("resetLoginLockout clears failed attempts on successful login", () => {
  globalThis.window.localStorage.clear();
  const testEmail = "user3@bms.com";
  const baseTime = 3000000;

  recordFailedLogin(testEmail, baseTime);
  recordFailedLogin(testEmail, baseTime + 1000);
  recordFailedLogin(testEmail, baseTime + 2000);

  const statusBefore = checkLoginLockout(testEmail, baseTime + 3000);
  assert.equal(statusBefore.failedAttempts, 3);
  assert.equal(statusBefore.attemptsRemaining, 2);

  // Successful login occurs
  resetLoginLockout(testEmail);

  const statusAfter = checkLoginLockout(testEmail, baseTime + 4000);
  assert.equal(statusAfter.isLocked, false);
  assert.equal(statusAfter.failedAttempts, 0);
  assert.equal(statusAfter.attemptsRemaining, 5);
});
