/**
 * DEPRECATED: Legacy Session Manager
 * Superseded by Firebase Authentication + strict 2-hour session lifetime.
 * Kept only for backwards compatibility without storing hardcoded credentials.
 */

export function login(): boolean {
  console.warn("Legacy session.login is deprecated and disabled. Use useAuth().signIn().");
  return false;
}

export function logout(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("bms_session_v1");
    } catch {
      // Ignore
    }
  }
}

export function getSession(): null {
  return null;
}

export function isAuthenticated(): boolean {
  return false;
}
