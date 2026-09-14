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

export interface CompanySummary {
  id: string;
  name: string;
  legalName?: string;
  role: string;
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

  // Register cleanup on canonical logout
  useEffect(() => {
    return registerLogoutCleanup(() => {
      setCompanies([]);
      setActiveCompanyId(null);
      setActiveCompany(null);
      setActiveMembership(null);
      setFinancialYears([]);
      setActiveFinancialYearId(null);
      setLoading(false);
      setResolvedUserId(null);
      setError(null);
    });
  }, [registerLogoutCleanup]);

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
            summaries.push({
              id: cId,
              name: compData.name || "Unnamed Company",
              legalName: compData.legalName,
              role: memData.role || "viewer",
            });
          } else {
            // Fallback to companySummaries
            const sumSnap = await get(ref(firebaseDb!, `companySummaries/${cId}`));
            if (sumSnap.exists()) {
              const sumData = sumSnap.val();
              summaries.push({
                id: cId,
                name: sumData.name || "Unnamed Company",
                role: "viewer",
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

  const switchCompany = useCallback((companyId: string) => {
    // Immediately clear previous company state so child views never render stale records (PRD #62)
    setActiveCompany(null);
    setActiveMembership(null);
    setFinancialYears([]);
    setActiveFinancialYearId(null);
    setActiveCompanyId(companyId);
  }, []);

  const switchFinancialYear = useCallback((financialYearId: string) => {
    setActiveFinancialYearId(financialYearId);
  }, []);

  const refreshCompanyData = useCallback(async () => {
    // Reactive listeners automatically maintain freshest state
  }, []);

  const isOwner = activeMembership?.role === "owner";

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
