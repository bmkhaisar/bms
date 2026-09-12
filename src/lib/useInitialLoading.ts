import { useEffect, useState } from "react";

/** Very short skeleton flash — only shows if the tab genuinely needs time. */
export function useInitialLoading(ms = 120): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const t = window.setTimeout(() => setLoading(false), ms);
      (window as any).__bmsSkelTimer = t;
    });
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout((window as any).__bmsSkelTimer);
    };
  }, [ms]);
  return loading;
}
