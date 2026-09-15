/**
 * BMS NEXT — Login Security & Auto-Lockout Manager
 * 
 * Enforces client-side account and device protection:
 * - Locks sign-in after 5 consecutive failed login attempts.
 * - Lockout duration: 5 hours (18,000,000 ms).
 * - Disables the Sign In button and form submission.
 * - Resets failed attempt counter upon successful authentication.
 * - SSR safe (no-op / safe fallback when window/localStorage is unavailable).
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours in milliseconds
export const LOCKOUT_STORAGE_KEY = "bms_security_login_lockout_v1";

interface EmailLockoutRecord {
  attempts: number;
  lockedUntil: number | null;
  lastAttemptAt: number;
}

interface StoredLockoutData {
  deviceAttempts: number;
  deviceLockedUntil: number | null;
  lastAttemptAt: number;
  byEmail: Record<string, EmailLockoutRecord>;
}

function getSafeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadStorageData(): StoredLockoutData {
  const storage = getSafeStorage();
  const defaultData: StoredLockoutData = {
    deviceAttempts: 0,
    deviceLockedUntil: null,
    lastAttemptAt: 0,
    byEmail: {},
  };

  if (!storage) return defaultData;

  try {
    const raw = storage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return defaultData;
    const parsed = JSON.parse(raw);
    return {
      deviceAttempts: Number(parsed?.deviceAttempts) || 0,
      deviceLockedUntil: parsed?.deviceLockedUntil ? Number(parsed.deviceLockedUntil) : null,
      lastAttemptAt: Number(parsed?.lastAttemptAt) || 0,
      byEmail: typeof parsed?.byEmail === "object" && parsed?.byEmail !== null ? parsed.byEmail : {},
    };
  } catch {
    return defaultData;
  }
}

function saveStorageData(data: StoredLockoutData): void {
  const storage = getSafeStorage();
  if (!storage) return;
  try {
    storage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota or permission errors
  }
}

export interface LockoutStatus {
  isLocked: boolean;
  remainingMs: number;
  remainingTimeFormatted: string;
  failedAttempts: number;
  attemptsRemaining: number;
  lockedUntil: number | null;
}

export function formatLockoutRemainingTime(remainingMs: number): string {
  if (remainingMs <= 0) return "0s";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

/**
 * Check current lockout status for the given email (or overall device).
 */
export function checkLoginLockout(email?: string, now = Date.now()): LockoutStatus {
  const data = loadStorageData();
  const normalizedEmail = email?.trim().toLowerCase();

  // Check device lockout
  let deviceLocked = false;
  let deviceRemainingMs = 0;
  if (data.deviceLockedUntil) {
    if (data.deviceLockedUntil > now) {
      deviceLocked = true;
      deviceRemainingMs = data.deviceLockedUntil - now;
    } else {
      // Device lock has expired
      data.deviceLockedUntil = null;
      data.deviceAttempts = 0;
    }
  }

  // Check email lockout
  let emailLocked = false;
  let emailRemainingMs = 0;
  let emailRecord: EmailLockoutRecord | undefined;

  if (normalizedEmail && data.byEmail[normalizedEmail]) {
    emailRecord = data.byEmail[normalizedEmail];
    if (emailRecord.lockedUntil) {
      if (emailRecord.lockedUntil > now) {
        emailLocked = true;
        emailRemainingMs = emailRecord.lockedUntil - now;
      } else {
        // Email lock has expired
        emailRecord.lockedUntil = null;
        emailRecord.attempts = 0;
      }
    }
  }

  // Save if any expired lock was cleaned up
  saveStorageData(data);

  const isLocked = deviceLocked || emailLocked;
  const remainingMs = Math.max(deviceRemainingMs, emailRemainingMs);
  const activeLockedUntil = deviceLocked
    ? (data.deviceLockedUntil || null)
    : emailLocked
    ? (emailRecord?.lockedUntil || null)
    : null;

  const maxAttempts = Math.max(
    data.deviceAttempts,
    emailRecord?.attempts || 0
  );
  const attemptsRemaining = Math.max(0, MAX_LOGIN_ATTEMPTS - maxAttempts);

  return {
    isLocked,
    remainingMs,
    remainingTimeFormatted: formatLockoutRemainingTime(remainingMs),
    failedAttempts: maxAttempts,
    attemptsRemaining,
    lockedUntil: activeLockedUntil,
  };
}

/**
 * Record a failed login attempt. If failed attempts reach 5, trigger 5-hour lockout.
 */
export function recordFailedLogin(email?: string, now = Date.now()): LockoutStatus {
  const data = loadStorageData();
  const normalizedEmail = email?.trim().toLowerCase();

  // 1. Update device attempts
  if (data.deviceLockedUntil && data.deviceLockedUntil <= now) {
    data.deviceAttempts = 0;
    data.deviceLockedUntil = null;
  }
  data.deviceAttempts += 1;
  data.lastAttemptAt = now;

  let deviceLocked = false;
  let deviceRemainingMs = 0;
  if (data.deviceAttempts >= MAX_LOGIN_ATTEMPTS) {
    data.deviceLockedUntil = now + LOCKOUT_DURATION_MS;
    deviceLocked = true;
    deviceRemainingMs = LOCKOUT_DURATION_MS;
  }

  // 2. Update email attempts if provided
  let emailLocked = false;
  let emailRemainingMs = 0;
  let emailRecord: EmailLockoutRecord | undefined;

  if (normalizedEmail) {
    emailRecord = data.byEmail[normalizedEmail] || {
      attempts: 0,
      lockedUntil: null,
      lastAttemptAt: 0,
    };

    if (emailRecord.lockedUntil && emailRecord.lockedUntil <= now) {
      emailRecord.attempts = 0;
      emailRecord.lockedUntil = null;
    }

    emailRecord.attempts += 1;
    emailRecord.lastAttemptAt = now;

    if (emailRecord.attempts >= MAX_LOGIN_ATTEMPTS) {
      emailRecord.lockedUntil = now + LOCKOUT_DURATION_MS;
      emailLocked = true;
      emailRemainingMs = LOCKOUT_DURATION_MS;
    }

    data.byEmail[normalizedEmail] = emailRecord;
  }

  saveStorageData(data);

  const isLocked = deviceLocked || emailLocked;
  const remainingMs = Math.max(deviceRemainingMs, emailRemainingMs);
  const activeLockedUntil = deviceLocked
    ? data.deviceLockedUntil
    : emailLocked
    ? (emailRecord?.lockedUntil || null)
    : null;

  const currentAttempts = Math.max(data.deviceAttempts, emailRecord?.attempts || 0);
  const attemptsRemaining = Math.max(0, MAX_LOGIN_ATTEMPTS - currentAttempts);

  return {
    isLocked,
    remainingMs,
    remainingTimeFormatted: formatLockoutRemainingTime(remainingMs),
    failedAttempts: currentAttempts,
    attemptsRemaining,
    lockedUntil: activeLockedUntil,
  };
}

/**
 * Reset failed attempts on successful login.
 */
export function resetLoginLockout(email?: string): void {
  const data = loadStorageData();
  const normalizedEmail = email?.trim().toLowerCase();

  data.deviceAttempts = 0;
  data.deviceLockedUntil = null;

  if (normalizedEmail && data.byEmail[normalizedEmail]) {
    delete data.byEmail[normalizedEmail];
  }

  saveStorageData(data);
}
