import { getCacheDb } from "./dexieCache";
import type { OutboxMutation, NetworkStatus } from "./types";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off } from "firebase/database";

type StatusListener = (status: NetworkStatus, pendingCount: number) => void;

class OutboxSyncManager {
  private isProcessing = false;
  private networkStatus: NetworkStatus = "online";
  private statusListeners: Set<StatusListener> = new Set();
  private connectedRefUnsub: (() => void) | null = null;

  init(): () => void {
    if (typeof window === "undefined") return () => {};

    const handleOnline = () => {
      this.updateStatus("online");
      this.processOutbox();
    };

    const handleOffline = () => {
      this.updateStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Track Firebase Realtime Database connection status if initialized
    if (firebaseDb) {
      const connectedRef = ref(firebaseDb, ".info/connected");
      const listener = onValue(connectedRef, (snap) => {
        const isConnected = snap.val() === true;
        if (isConnected) {
          this.updateStatus("online");
          this.processOutbox();
        } else if (!navigator.onLine) {
          this.updateStatus("offline");
        }
      });

      this.connectedRefUnsub = () => off(connectedRef, "value", listener);
    }

    // Run initial queue check
    this.processOutbox();

    this.cleanupFn = () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (this.connectedRefUnsub) {
        this.connectedRefUnsub();
        this.connectedRefUnsub = null;
      }
    };

    return this.cleanupFn;
  }

  private cleanupFn: (() => void) | null = null;

  stop(): void {
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
    this.isProcessing = false;
    this.statusListeners.clear();
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    this.getPendingCount().then((count) => listener(this.networkStatus, count));
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async enqueue(mutation: Omit<OutboxMutation, "id" | "attemptCount" | "status" | "createdAt">): Promise<OutboxMutation> {
    const db = getCacheDb();
    const fullMutation: OutboxMutation = {
      ...mutation,
      id: crypto.randomUUID(),
      attemptCount: 0,
      status: "pending",
      createdAt: Date.now(),
    };

    await db.outbox.put(fullMutation);
    this.notifyStatus();

    if (this.networkStatus === "online") {
      this.processOutbox();
    }

    return fullMutation;
  }

  async processOutbox(): Promise<void> {
    if (this.isProcessing || typeof window === "undefined" || !navigator.onLine) return;
    this.isProcessing = true;
    this.updateStatus("syncing");

    try {
      const db = getCacheDb();
      const pendingMutations = await db.outbox
        .where("status")
        .equals("pending")
        .sortBy("createdAt");

      for (const m of pendingMutations) {
        if (!navigator.onLine) break;

        // Mark syncing
        await db.outbox.update(m.id, {
          status: "syncing",
          attemptCount: m.attemptCount + 1,
          lastAttemptAt: Date.now(),
        });

        try {
          // Attempt dispatch via server / Firebase
          await this.dispatchMutation(m);

          // Success: remove from outbox
          await db.outbox.delete(m.id);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const isConflict = errorMessage.includes("CONFLICT") || errorMessage.includes("version mismatch");

          await db.outbox.update(m.id, {
            status: isConflict ? "conflict" : "pending",
            lastError: errorMessage,
          });

          if (isConflict) {
            console.warn(`Mutation ${m.clientMutationId} encountered conflict:`, errorMessage);
          }
        }
      }
    } finally {
      this.isProcessing = false;
      this.updateStatus(navigator.onLine ? "online" : "offline");
    }
  }

  private async dispatchMutation(mutation: OutboxMutation): Promise<void> {
    // In Phase 1, dispatch master entity sync or server function
    // Privileged mutations must call server endpoints
    // Normal client-permitted updates go to Firebase RTDB
    // If Firebase Admin is not configured, server returns SERVER_CONFIG_REQUIRED
  }

  private async getPendingCount(): Promise<number> {
    if (typeof window === "undefined") return 0;
    try {
      const db = getCacheDb();
      return await db.outbox.where("status").equals("pending").count();
    } catch {
      return 0;
    }
  }

  private updateStatus(newStatus: NetworkStatus) {
    this.networkStatus = newStatus;
    this.notifyStatus();
  }

  private async notifyStatus() {
    const count = await this.getPendingCount();
    for (const listener of this.statusListeners) {
      listener(this.networkStatus, count);
    }
  }
}

export const outboxManager = new OutboxSyncManager();
