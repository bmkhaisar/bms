/**
 * BMS NEXT — Startup Experience Coordinator
 *
 * Architecture:
 * - Client/Window-Scoped: uses `window.__BMS_STARTUP_COMPLETED__` to prevent SSR leakage.
 * - Idempotent: safe with React Strict Mode remounts.
 * - Choreography: coordinates 4.0s "The Balanced Ledger" visual presentation with
 *   concurrent Firebase Auth, claims, company resolution, and Dexie loading.
 * - Non-replaying: internal client-side route navigations never replay the startup screen.
 * - Bounded Recovery: handles slow connections gracefully after 12s without infinite trapping.
 */

export type StartupPhase =
  | "active"        // Running 4-second animation sequence
  | "ready"         // Backend resolved and 4s animation gate reached
  | "extended"      // Backend taking > 4s ("Preparing your workspace…")
  | "timeout"       // Backend taking > 12s (bounded recovery with "Retry")
  | "completed";    // Fully dismissed and unmounted

declare global {
  interface Window {
    __BMS_STARTUP_COMPLETED__?: boolean;
  }
}

type StartupListener = (phase: StartupPhase) => void;

class StartupStateManager {
  private phase: StartupPhase = "completed";
  private backendReady: boolean = false;
  private startTime: number = 0;
  private durationMs: number = 4000;
  private timeoutMs: number = 12000;
  private listeners: Set<StartupListener> = new Set();
  private durationTimer: any = null;
  private timeoutTimer: any = null;

  constructor() {
    this.init();
  }

  public init() {
    if (typeof window === "undefined") {
      this.phase = "completed";
      return;
    }

    // Window-scoped check: if already completed in this client session, skip completely
    if (window.__BMS_STARTUP_COMPLETED__) {
      this.phase = "completed";
      return;
    }

    this.clearTimers();
    this.startTime = Date.now();
    this.phase = "active";
    this.backendReady = false;

    // 4.0s animation gate timer
    this.durationTimer = setTimeout(() => {
      if (this.backendReady) {
        this.transitionTo("ready");
      } else {
        this.transitionTo("extended");
      }
    }, this.durationMs);

    // 12.0s bounded recovery timeout
    this.timeoutTimer = setTimeout(() => {
      if (this.phase === "extended" && !this.backendReady) {
        this.transitionTo("timeout");
      }
    }, this.timeoutMs);
  }

  /**
   * Called concurrently when Firebase auth, claims, and active company resolve.
   */
  public markBackendReady() {
    if (this.backendReady) return;
    this.backendReady = true;

    if (typeof window === "undefined") {
      this.phase = "completed";
      return;
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.durationMs) {
      this.transitionTo("ready");
    }
  }

  /**
   * Called when exit transition finishes and destination is revealed.
   */
  public markCompleted() {
    this.transitionTo("completed");
    this.clearTimers();
    if (typeof window !== "undefined") {
      window.__BMS_STARTUP_COMPLETED__ = true;
    }
  }

  public getPhase(): StartupPhase {
    return this.phase;
  }

  public isStartupActive(): boolean {
    return this.phase !== "completed";
  }

  public subscribe(listener: StartupListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private transitionTo(newPhase: StartupPhase) {
    if (this.phase === newPhase) return;
    this.phase = newPhase;
    this.notify();
  }

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.phase);
      } catch (err) {
        console.warn("[StartupState] Listener notification error:", err);
      }
    });
  }

  private clearTimers() {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer);
      this.durationTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * Test harness helper for deterministic unit testing.
   */
  public resetForTesting(durationMs = 4000, timeoutMs = 12000) {
    this.clearTimers();
    if (typeof window !== "undefined") {
      delete window.__BMS_STARTUP_COMPLETED__;
    }
    this.durationMs = durationMs;
    this.timeoutMs = timeoutMs;
    this.init();
  }
}

export const startupState = new StartupStateManager();
