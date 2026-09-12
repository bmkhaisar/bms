import { useEffect, useRef } from "react";

const PREFIX = "bms_draft_";

export function saveDraft<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (e) {
    console.warn("[DraftAutosave] Failed to save draft:", e);
  }
}

export function loadDraft<T>(key: string): { data: T; savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[DraftAutosave] Failed to parse draft:", e);
    return null;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch (e) {}
}

export function hasDraft(key: string): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem(PREFIX + key);
}

/**
 * Hook to automatically persist form drafts and warn on unsaved navigation.
 */
export function useDraftAutosave<T>(
  key: string,
  data: T | null,
  isDirty: boolean,
  intervalMs = 4000
) {
  const dataRef = useRef(data);
  dataRef.current = data;

  // Periodic autosave
  useEffect(() => {
    if (!isDirty || !data) return;

    const timer = setInterval(() => {
      if (dataRef.current && isDirty) {
        saveDraft(key, dataRef.current);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [key, isDirty, intervalMs]);

  // Warn on accidental tab close / reload when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
