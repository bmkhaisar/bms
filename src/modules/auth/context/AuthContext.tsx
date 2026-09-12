import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { firebaseAuth } from "@/config/firebase";
import { purgeUserCache } from "@/modules/sync/dexieCache";
import { outboxManager } from "@/modules/sync/outboxManager";
import {
  MAX_SESSION_AGE_MS,
  SUPERSEDED_LEGACY_UID,
} from "@/config/publicConfig";
import { toast } from "sonner";

export type AuthResolutionState =
  | "initializingAuth"
  | "refreshingToken"
  | "loadingClaims"
  | "checkingPlatformAdminStatus"
  | "resolvingCompanies"
  | "ready";

export interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  authInitializing: boolean;
  claimsLoading: boolean;
  resolutionState: AuthResolutionState;
  setResolutionState: (state: AuthResolutionState) => void;
  isAuthenticated: boolean;
  isPlatformAdmin: boolean;
  sessionExpiresAt: number | null;
  refreshClaims: () => Promise<boolean>;
  signIn: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signOut: (reason?: "manual" | "expired" | "switch_account") => Promise<void>;
  logout: (reason?: "manual" | "expired" | "switch_account") => Promise<void>;
  signOutAndSwitchAccount: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  clearDeviceData: () => Promise<void>;
  registerLogoutCleanup: (cleanupFn: () => void) => () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [resolutionState, setResolutionState] = useState<AuthResolutionState>("initializingAuth");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const expiryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isExpiredRef = useRef(false);
  const cleanupCallbacksRef = useRef<Set<() => void>>(new Set());
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);

  const registerLogoutCleanup = useCallback((cleanupFn: () => void) => {
    cleanupCallbacksRef.current.add(cleanupFn);
    return () => {
      cleanupCallbacksRef.current.delete(cleanupFn);
    };
  }, []);

  const clearTimer = () => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  };

  /**
   * Canonical Authenticated Session Cleanup Pipeline (Single-flight & Idempotent)
   * 
   * 1. Clear session timers.
   * 2. Stop/pause Dexie outbox processing worker.
   * 3. Stop all registered Firebase realtime listeners & clear tenant context.
   * 4. Clear in-memory auth state.
   * 5. Await Firebase signOut(auth).
   * 6. Navigate with replace to /login (or hard fallback window.location.replace).
   */
  const performAuthenticatedSessionCleanup = useCallback(
    (reason: "manual" | "expired" | "switch_account" = "manual"): Promise<void> => {
      if (cleanupPromiseRef.current) {
        return cleanupPromiseRef.current;
      }

      cleanupPromiseRef.current = (async () => {
        clearTimer();
        setSessionExpiresAt(null);
        setIsPlatformAdmin(false);

        // Stop outbox sync worker immediately on sign out
        try {
          outboxManager.stop();
        } catch (e) {
          console.warn("Outbox stop warning:", e);
        }

        // Execute registered active listeners / context cleanups
        try {
          cleanupCallbacksRef.current.forEach((fn) => {
            try {
              fn();
            } catch (e) {
              console.warn("Cleanup callback error:", e);
            }
          });
        } catch (e) {
          console.warn("Error running logout cleanups:", e);
        }

        // Authoritative Firebase signOut
        if (firebaseAuth && firebaseAuth.currentUser) {
          try {
            await firebaseSignOut(firebaseAuth);
          } catch (e) {
            console.warn("Firebase signOut warning:", e);
          }
        }

        setUser(null);
        setClaimsLoading(false);

        if (reason === "expired") {
          toast.info("Your session expired. Sign in again to continue.");
        }

        // Hard replacement to /login prevents history bounce back to private screens
        if (typeof window !== "undefined") {
          if (window.location.pathname !== "/login") {
            window.location.replace("/login");
          }
        }
      })().finally(() => {
        setTimeout(() => {
          cleanupPromiseRef.current = null;
        }, 1000);
      });

      return cleanupPromiseRef.current;
    },
    []
  );

  const signOut = useCallback(
    async (reason: "manual" | "expired" | "switch_account" = "manual") => {
      await performAuthenticatedSessionCleanup(reason);
    },
    [performAuthenticatedSessionCleanup]
  );

  const signOutAndSwitchAccount = useCallback(async () => {
    await performAuthenticatedSessionCleanup("switch_account");
  }, [performAuthenticatedSessionCleanup]);

  const checkSessionExpiration = useCallback(
    (expiryMs: number | null) => {
      if (!expiryMs || !firebaseAuth?.currentUser) return false;
      const now = Date.now();
      if (now >= expiryMs) {
        if (!isExpiredRef.current) {
          isExpiredRef.current = true;
          signOut("expired");
        }
        return true;
      }
      return false;
    },
    [signOut]
  );

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthInitializing(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      async (currentUser) => {
        clearTimer();
        isExpiredRef.current = false;

        if (currentUser) {
          setUser(currentUser);
          setClaimsLoading(true);
          setResolutionState("refreshingToken");

          try {
            // Force refresh ID token and claims to prevent stale resolution
            await currentUser.getIdToken(true);
            setResolutionState("loadingClaims");
            const tokenResult = await currentUser.getIdTokenResult(true);
            // Strictly prevent superseded legacy UID from ever holding platform admin privilege
            const isClaimAdmin = currentUser.uid !== SUPERSEDED_LEGACY_UID && Boolean(tokenResult.claims.platformAdmin);
            setIsPlatformAdmin(isClaimAdmin);

            // Safe dev logging for authoritative platform admin inspection
            if (currentUser.uid === "BOkCLXp08tVmRHICTArgpReVh5Y2" || currentUser.email === "maaz@admin.com") {
              console.info("[Auth Resolution] Current user platform admin claims:", {
                uid: currentUser.uid,
                email: currentUser.email,
                platformAdmin: isClaimAdmin,
                auth_time: tokenResult.claims.auth_time || tokenResult.authTime,
              });
            }

            // PRD §§ 37-43: Persistent login policy - no hard fixed 2-hour session expiry
            // User remains authenticated as long as Firebase auth remains valid
            setSessionExpiresAt(null);
            clearTimer();
          } catch (e) {
            console.warn("Token inspection error:", e);
            setIsPlatformAdmin(false);
          } finally {
            setClaimsLoading(false);
            setResolutionState("ready");
          }
        } else {
          setUser(null);
          setIsPlatformAdmin(false);
          setSessionExpiresAt(null);
          setClaimsLoading(false);
        }
        setAuthInitializing(false);
      },
      (error) => {
        console.error("Firebase auth state error:", error);
        setUser(null);
        setIsPlatformAdmin(false);
        setSessionExpiresAt(null);
        setAuthInitializing(false);
        setClaimsLoading(false);
      }
    );

    return () => {
      clearTimer();
      unsubscribe();
    };
  }, [signOut]);

  // Check expiration on window focus and visibility change
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onFocusOrVisible = () => {
      if (sessionExpiresAt) {
        checkSessionExpiration(sessionExpiresAt);
      }
    };

    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [sessionExpiresAt, checkSessionExpiration]);

  const refreshClaims = async (): Promise<boolean> => {
    if (!user) return false;
    setClaimsLoading(true);
    setResolutionState("refreshingToken");
    try {
      await user.getIdToken(true);
      setResolutionState("loadingClaims");
      const res = await user.getIdTokenResult(true);
      const isClaimAdmin = Boolean(res.claims.platformAdmin);
      setIsPlatformAdmin(isClaimAdmin);

      if (isClaimAdmin && typeof window !== "undefined") {
        if (window.location.pathname !== "/system-admin") {
          window.location.replace("/system-admin");
        }
      }
      return isClaimAdmin;
    } catch (e) {
      console.warn("Failed to refresh token claims:", e);
      return false;
    } finally {
      setClaimsLoading(false);
      setResolutionState("ready");
    }
  };

  const signIn = async (email: string, pass: string) => {
    if (!firebaseAuth) {
      return { success: false, error: "Firebase Authentication is not configured." };
    }
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), pass);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in";
      return { success: false, error: formatAuthError(msg) };
    }
  };

  const resetPassword = async (email: string) => {
    if (!firebaseAuth) {
      return { success: false, error: "Firebase Authentication is not configured." };
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send password reset email";
      return { success: false, error: formatAuthError(msg) };
    }
  };

  const clearDeviceData = async () => {
    if (user?.uid) {
      await purgeUserCache(user.uid);
      toast.success("Local offline data cleared from this device.");
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing: authInitializing || claimsLoading,
        authInitializing,
        claimsLoading,
        resolutionState,
        setResolutionState,
        isAuthenticated: user !== null,
        isPlatformAdmin,
        sessionExpiresAt,
        refreshClaims,
        signIn,
        signOut,
        logout: signOut,
        signOutAndSwitchAccount,
        resetPassword,
        clearDeviceData,
        registerLogoutCleanup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

function formatAuthError(raw: string): string {
  if (raw.includes("user-not-found") || raw.includes("wrong-password") || raw.includes("invalid-credential")) {
    return "Invalid email or password.";
  }
  if (raw.includes("user-disabled")) {
    return "This user account has been disabled. Please contact support.";
  }
  if (raw.includes("too-many-requests")) {
    return "Too many failed attempts. Please try again later.";
  }
  if (raw.includes("network-request-failed")) {
    return "Network error. Please check your internet connection.";
  }
  return raw;
}
