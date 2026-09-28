import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { ref, onValue, off, get } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { useAuth } from "@/modules/auth/context/AuthContext";
import type { Company, Membership, FinancialYear } from "../types";
import { hasCapability, type Capability } from "@/modules/auth/permissions";
import { ensureActiveFinancialYearServerFn } from "@/functions/ensureFinancialYearFn";
import { db } from "@/lib/db";
import { outboxManager } from "@/modules/sync/outboxManager";

export interface CompanySummary {
  id: string;
  name: string;
  legalName?: string;
  role: string;
  organizationType?: "NORMAL" | "DEMO";
  isDemo?: boolean;
  demoExpiresAt?: number;
}

export interface ActiveCompanyContextValue {
  companies: CompanySummary[];
  activeCompany: Company | null;
  activeMembership: Membership | null;
  financialYears: FinancialYear[];
  activeFinancialYear: FinancialYear | null;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  isDemo: boolean;
  isDemoExpired: boolean;
  can: (capability: string) => boolean;
  switchCompany: (companyId: string) => void;
  switchFinancialYear: (financialYearId: string) => void;
  refreshCompanyData: () => Promise<void>;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | undefined>(undefined);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const { user, registerLogoutCleanup } = useAuth();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [activeMembership, setActiveMembership] = useState<Membership | null>(null);
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([]);
  const [activeFinancialYearId, setActiveFinancialYearId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repairingFinancialYearRef = useRef<Set<string>>(new Set());

  // Register cleanup on canonical logout (PRD § 10)
  useEffect(() => {
    return registerLogoutCleanup(async () => {
      setCompanies([]);
      setActiveCompanyId(null);
      setActiveCompany(null);
      setActiveMembership(null);
      setFinancialYears([]);
      setActiveFinancialYearId(null);
      setLoading(false);
      setResolvedUserId(null);
      setError(null);
      if (typeof window !== "undefined") {
        try {
          await Promise.all([
            db().invoices.clear(),
            db().quotations.clear(),
            db().purchases.clear(),
            db().receipts.clear(),
            db().payments.clear(),
            db().parties.clear(),
            db().customers.clear(),
            db().suppliers.clear(),
            db().productSizes.clear(),
            db().sizes.clear(),
            db().companySettings.clear(),
          ]);
        } catch {}
      }
    });
  }, [registerLogoutCleanup]);

  // Synchronize active company to outbox manager for company-scoped queuing (PRD § 10)
  useEffect(() => {
    outboxManager.setActiveCompany(activeCompanyId);
  }, [activeCompanyId]);

  // 1. Listen for user's assigned companies at /userCompanies/{uid}
  useEffect(() => {
    if (!user || !firebaseDb) {
      setCompanies([]);
      setActiveCompanyId(null);
      setActiveCompany(null);
      setActiveMembership(null);
      setFinancialYears([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setResolvedUserId(null);
    const userCompaniesRef = ref(firebaseDb, `userCompanies/${user.uid}`);

    const onUserCompaniesChange = async (snapshot: any) => {
      const val = snapshot.val();
      if (!val) {
        setCompanies([]);
        setActiveCompanyId(null);
        setActiveCompany(null);
        setActiveMembership(null);
        setFinancialYears([]);
        setLoading(false);
        setResolvedUserId(user.uid);
        return;
      }

      const companyIds = Object.keys(val);
      const summaries: CompanySummary[] = [];

      for (const cId of companyIds) {
        try {
          const compSnap = await get(ref(firebaseDb!, `companies/${cId}`));
          const memSnap = await get(ref(firebaseDb!, `memberships/${cId}/${user.uid}`));
          if (compSnap.exists() && memSnap.exists()) {
            const compData = compSnap.val();
            const memData = memSnap.val();
            const isDemo = Boolean(compData.isDemo || compData.organizationType === "DEMO");
            summaries.push({
              id: cId,
              name: compData.name || "Unnamed Company",
              legalName: compData.legalName,
              role: memData.role || "viewer",
              organizationType: isDemo ? "DEMO" : "NORMAL",
              isDemo,
              demoExpiresAt: compData.demoExpiresAt,
            });
          } else {
            // Fallback to companySummaries
            const sumSnap = await get(ref(firebaseDb!, `companySummaries/${cId}`));
            if (sumSnap.exists()) {
              const sumData = sumSnap.val();
              const isDemo = Boolean(sumData.isDemo || sumData.organizationType === "DEMO");
              summaries.push({
                id: cId,
                name: sumData.name || "Unnamed Company",
                role: "viewer",
                organizationType: isDemo ? "DEMO" : "NORMAL",
                isDemo,
                demoExpiresAt: sumData.demoExpiresAt,
              });
            }
          }
        } catch (e) {
          console.warn(`Could not load summary for company ${cId}:`, e);
        }
      }

      setCompanies(summaries);

      // Auto-select if only 1 company or keep existing selection if still valid
      if (summaries.length > 0) {
        setActiveCompanyId((prev) => {
          if (prev && summaries.some((s) => s.id === prev)) {
            return prev;
          }
          return summaries[0].id;
        });
      } else {
        setActiveCompanyId(null);
      }
      setLoading(false);
      setResolvedUserId(user.uid);
    };

    onValue(userCompaniesRef, onUserCompaniesChange, (err) => {
      console.warn("Failed to listen to userCompanies:", err);
      setCompanies([]);
      setActiveCompanyId(null);
      setLoading(false);
      setResolvedUserId(user.uid);
    });

    return () => {
      off(userCompaniesRef, "value", onUserCompaniesChange);
    };
  }, [user]);

  // 2. Listen to active company data, membership, and financial years
  useEffect(() => {
    if (!user || !activeCompanyId || !firebaseDb) {
      setActiveCompany(null);
      setActiveMembership(null);
      setFinancialYears([]);
      return;
    }

    const compRef = ref(firebaseDb, `companies/${activeCompanyId}`);
    const memRef = ref(firebaseDb, `memberships/${activeCompanyId}/${user.uid}`);
    const fyRef = ref(firebaseDb, `companyData/${activeCompanyId}/financialYears`);

    const onCompChange = (snap: any) => {
      if (snap.exists()) {
        const c = snap.val();
        setActiveCompany(c);
        if (c.currentFinancialYearId) {
          setActiveFinancialYearId(c.currentFinancialYearId);
        }
        if (typeof window !== "undefined") {
          db().companySettings.put({ ...c, id: activeCompanyId }).catch(() => {});
          db().companySettings.put({ ...c, id: "singleton" }).catch(() => {});
          window.dispatchEvent(
            new CustomEvent("bms:company-settings-updated", {
              detail: { companyId: activeCompanyId, company: c },
            })
          );
        }
      } else {
        setActiveCompany(null);
      }
    };

    const onMemChange = (snap: any) => {
      if (snap.exists()) {
        setActiveMembership(snap.val());
      } else {
        setActiveMembership(null);
      }
    };

    const onFyChange = (snap: any) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: FinancialYear[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          ...val,
          id,
        }));
        setFinancialYears(list);
        if (!activeFinancialYearId && list.length > 0) {
          setActiveFinancialYearId(list[0].id);
        }
      } else {
        setFinancialYears([]);
      }
    };

    onValue(compRef, onCompChange);
    onValue(memRef, onMemChange);
    onValue(fyRef, onFyChange);

    return () => {
      off(compRef, "value", onCompChange);
      off(memRef, "value", onMemChange);
      off(fyRef, "value", onFyChange);
    };
  }, [user, activeCompanyId, activeFinancialYearId]);

  // Permanence invariant: a usable company must always have a server-backed current financial year.
  useEffect(() => {
    if (!user || !activeCompanyId || !activeCompany || financialYears.length > 0 || repairingFinancialYearRef.current.has(activeCompanyId)) return;
    repairingFinancialYearRef.current.add(activeCompanyId);
    user.getIdToken().then((idToken) => ensureActiveFinancialYearServerFn({ data: { idToken, companyId: activeCompanyId } }))
      .then((result) => {
        if (!result.success) setError(result.error || "Could not initialize the current financial year.");
      })
      .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => repairingFinancialYearRef.current.delete(activeCompanyId));
  }, [user, activeCompanyId, activeCompany, financialYears.length]);

  const switchCompany = useCallback(async (companyId: string) => {
    // PRD §§ 9, 10, 22: Immediately isolate UI state, queries, Dexie, realtime listeners, outbox
    setActiveCompany(null);
    setActiveMembership(null);
    setFinancialYears([]);
    setActiveFinancialYearId(null);

    // Stop outbox processing and clear working Dexie tables so no stale Company A records flash in UI
    if (typeof window !== "undefined") {
      try {
        await Promise.all([
          db().invoices.clear(),
          db().quotations.clear(),
          db().purchases.clear(),
          db().receipts.clear(),
          db().payments.clear(),
          db().parties.clear(),
          db().customers.clear(),
          db().suppliers.clear(),
          db().productSizes.clear(),
          db().sizes.clear(),
          db().companySettings.clear(),
        ]);
      } catch (err) {
        console.warn("Failed to clear working Dexie tables on company switch:", err);
      }
    }

    setActiveCompanyId(companyId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("bms:company-settings-updated", {
          detail: { companyId },
        })
      );
    }
  }, []);

  const switchFinancialYear = useCallback((financialYearId: string) => {
    setActiveFinancialYearId(financialYearId);
  }, []);

  const refreshCompanyData = useCallback(async () => {
    // Reactive listeners automatically maintain freshest state
  }, []);

  const isOwner = activeMembership?.role === "owner";
  const isDemo = Boolean(activeCompany?.isDemo || activeCompany?.organizationType === "DEMO");
  const isDemoExpired = Boolean(
    isDemo &&
    activeCompany?.demoExpiresAt &&
    Date.now() > activeCompany.demoExpiresAt
  );

  const can = (capability: string): boolean => {
    return hasCapability(activeMembership, capability as Capability);
  };

  const activeFinancialYear = financialYears.find((fy) => fy.id === activeFinancialYearId) || null;

  return (
    <ActiveCompanyContext.Provider
      value={{
        companies,
        activeCompany,
        activeMembership,
        financialYears,
        activeFinancialYear,
        loading: loading || Boolean(user && resolvedUserId !== user.uid),
        error,
        isOwner,
        isDemo,
        isDemoExpired,
        can,
        switchCompany,
        switchFinancialYear,
        refreshCompanyData,
      }}
    >
      {children}
    </ActiveCompanyContext.Provider>
  );
}

export function useActiveCompany(): ActiveCompanyContextValue {
  const context = useContext(ActiveCompanyContext);
  if (!context) {
    throw new Error("useActiveCompany must be used within an ActiveCompanyProvider");
  }
  return context;
}
