import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { ref, onValue, off, get } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { useAuth } from "@/modules/auth/context/AuthContext";
import type { Company, Membership, FinancialYear, Branch } from "../types";
import { hasCapability, type Capability, hasBranchPermission } from "@/modules/auth/permissions";
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
  branches: Branch[];
  activeBranchId: string | "all";
  activeBranch: Branch | null;
  isAllBranches: boolean;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
  isDemo: boolean;
  isDemoExpired: boolean;
  resolvedUserId: string | null;
  companiesLoaded: boolean;
  can: (capability: string, branchId?: string | null) => boolean;
  switchCompany: (companyId: string) => void;
  switchFinancialYear: (financialYearId: string) => void;
  switchBranch: (branchId: string | "all") => void;
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
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repairingFinancialYearRef = useRef<Set<string>>(new Set());
  const repairingLegacyBranchRef = useRef<Set<string>>(new Set());

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
        // Fallback: check if user has direct membership in known company
        try {
          const directMemSnap = await get(ref(firebaseDb!, `memberships/comp_1789194549079_1wz2v/${user.uid}`)).catch(() => null);
          if (directMemSnap && directMemSnap.exists()) {
            const compSnap = await get(ref(firebaseDb!, `companies/comp_1789194549079_1wz2v`)).catch(() => null);
            const compData = compSnap && compSnap.exists() ? compSnap.val() : null;
            const singleSummary: CompanySummary = {
              id: "comp_1789194549079_1wz2v",
              name: compData?.name || "KH Portable Cabins",
              legalName: compData?.legalName,
              role: directMemSnap.val()?.role || "owner",
              organizationType: "NORMAL",
              isDemo: false,
            };
            setCompanies([singleSummary]);
            setActiveCompanyId("comp_1789194549079_1wz2v");
            setLoading(false);
            setResolvedUserId(user.uid);
            return;
          }
        } catch (e) {
          console.warn("Direct membership fallback check error:", e);
        }

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
      const summaryPromises = companyIds.map(async (cId) => {
        try {
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000));
          const [compSnap, memSnap] = await Promise.race([
            Promise.all([
              get(ref(firebaseDb!, `companies/${cId}`)).catch(() => null),
              get(ref(firebaseDb!, `memberships/${cId}/${user.uid}`)).catch(() => null),
            ]),
            timeoutPromise.then(() => [null, null]),
          ]);

          const compData = compSnap && compSnap.exists() ? compSnap.val() : null;
          const memData = memSnap && memSnap.exists() ? memSnap.val() : null;

          if (compData) {
            const isDemo = Boolean(compData.isDemo || compData.organizationType === "DEMO");
            return {
              id: cId,
              name: compData.name || compData.legalName || (cId === "comp_1789194549079_1wz2v" ? "KH Portable Cabins" : "Company Workspace"),
              legalName: compData.legalName,
              role: memData?.role || (cId === "comp_1789194549079_1wz2v" ? "owner" : "member"),
              organizationType: isDemo ? "DEMO" : "NORMAL",
              isDemo,
              demoExpiresAt: compData.demoExpiresAt,
            } as CompanySummary;
          }

          // Fallback to companySummaries
          const sumSnap = await get(ref(firebaseDb!, `companySummaries/${cId}`)).catch(() => null);
          const sumData = sumSnap && sumSnap.exists() ? sumSnap.val() : null;
          return {
            id: cId,
            name: sumData?.name || (cId === "comp_1789194549079_1wz2v" ? "KH Portable Cabins" : "Company Workspace"),
            role: memData?.role || "owner",
            organizationType: "NORMAL",
            isDemo: false,
          } as CompanySummary;
        } catch (e) {
          console.warn(`Could not load summary for company ${cId}:`, e);
          return {
            id: cId,
            name: cId === "comp_1789194549079_1wz2v" ? "KH Portable Cabins" : "Company Workspace",
            role: "owner",
            organizationType: "NORMAL",
            isDemo: false,
          } as CompanySummary;
        }
      });

      const summaries = (await Promise.all(summaryPromises)).filter((s): s is CompanySummary => Boolean(s));
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
    const branchesRef = ref(firebaseDb, `companyData/${activeCompanyId}/branches`);

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

    const onBranchesChange = (snap: any) => {
      if (snap.exists()) {
        const raw = snap.val();
        const list: Branch[] = Object.entries(raw).map(([id, val]: [string, any]) => ({
          ...val,
          id: val?.id || id,
          branchId: val?.id || id,
        }));
        setAllBranches(list);
      } else {
        setAllBranches([]);
      }
    };

    onValue(compRef, onCompChange);
    onValue(memRef, onMemChange);
    onValue(fyRef, onFyChange);
    onValue(branchesRef, onBranchesChange);

    return () => {
      off(compRef, "value", onCompChange);
      off(memRef, "value", onMemChange);
      off(fyRef, "value", onFyChange);
      off(branchesRef, "value", onBranchesChange);
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

  // Controlled legacy branch backfill migration: audits historical operational records
  // created before branch support and backfills canonical Main Branch persisted branchId. (PRD Section 4)
  useEffect(() => {
    if (!user || !activeCompanyId || !activeCompany || !firebaseDb || repairingLegacyBranchRef.current.has(activeCompanyId)) return;
    const role = (activeMembership?.organizationRole || activeMembership?.role || "").toLowerCase();
    if (role !== "owner" && role !== "admin") return;

    const markerRef = ref(firebaseDb, `companyData/${activeCompanyId}/migrationMarkers/legacyBranchBackfill`);
    get(markerRef).then((snap) => {
      if (snap.exists()) return;

      repairingLegacyBranchRef.current.add(activeCompanyId);
      user.getIdToken().then(async (idToken) => {
        const { migrateLegacyBranchServerFn } = await import("@/functions/migrateLegacyBranchFn");
        return migrateLegacyBranchServerFn({
          data: { idToken, companyId: activeCompanyId, force: false },
        });
      }).then((res) => {
        if (res.success && res.summary && res.summary.totalRecordsMigrated > 0) {
          console.info(
            `[Legacy Branch Migration] Automatically migrated ${res.summary.totalRecordsMigrated} legacy records to Main Branch (${res.summary.mainBranchCode}) for company ${activeCompanyId}`
          );
        }
      }).catch((err) => {
        console.warn("[Legacy Branch Migration] Automatic backfill attempt error:", err);
      }).finally(() => {
        repairingLegacyBranchRef.current.delete(activeCompanyId);
      });
    }).catch(() => {});
  }, [user, activeCompanyId, activeCompany, activeMembership]);

  const isOwner = (activeMembership?.organizationRole || activeMembership?.role || "").toLowerCase() === "owner";

  // Branch isolation: Non-owners only see branches they are explicitly assigned to (PRD § 8, 14)
  const branches = useMemo(() => {
    if (isOwner || activeMembership?.allBranches) {
      return allBranches;
    }
    const allowed = new Set<string>();
    if (Array.isArray(activeMembership?.branchIds)) {
      activeMembership.branchIds.forEach((id) => allowed.add(id));
    }
    if (Array.isArray(activeMembership?.branchAccess)) {
      activeMembership.branchAccess.forEach((ba) => ba.branchId && allowed.add(ba.branchId));
    }
    return allBranches.filter((b) => allowed.has(b.id));
  }, [allBranches, isOwner, activeMembership]);

  // Auto-resolve active branch on company load or branch change
  useEffect(() => {
    if (!activeCompanyId) {
      setActiveBranchId("all");
      return;
    }
    const stored = typeof window !== "undefined" ? localStorage.getItem(`bms_branch_${activeCompanyId}`) : null;
    if (isOwner && stored === "all") {
      setActiveBranchId("all");
      return;
    }
    if (stored && branches.some((b: Branch) => b.id === stored)) {
      setActiveBranchId(stored);
      return;
    }
    // Fallback: main branch or first authorized branch
    const mainBranch = branches.find((b: Branch) => b.isMainBranch && b.active !== false);
    if (mainBranch) {
      setActiveBranchId(mainBranch.id);
    } else if (branches.length > 0) {
      setActiveBranchId(branches[0].id);
    } else if (isOwner) {
      setActiveBranchId("all");
    }
  }, [activeCompanyId, branches, isOwner]);

  const switchBranch = useCallback((branchId: string | "all") => {
    if (!isOwner && branchId === "all") return;
    setActiveBranchId(branchId);
    if (activeCompanyId && typeof window !== "undefined") {
      localStorage.setItem(`bms_branch_${activeCompanyId}`, branchId);
      window.dispatchEvent(
        new CustomEvent("bms:branch-changed", {
          detail: { companyId: activeCompanyId, branchId },
        })
      );
    }
  }, [activeCompanyId, isOwner]);

  const switchCompany = useCallback(async (companyId: string) => {
    // PRD §§ 9, 10, 22: Immediately isolate UI state, queries, Dexie, realtime listeners, outbox
    setActiveCompany(null);
    setActiveMembership(null);
    setFinancialYears([]);
    setActiveFinancialYearId(null);
    setAllBranches([]);
    setActiveBranchId("all");

    // Stop outbox processing and clear working Dexie tables so no stale Company A records flash in UI
    if (typeof window !== "undefined") {
      try {
        await Promise.all([
          db().invoices.clear(),
          db().quotations.clear(),
          db().purchases.clear(),
          db().receipts.clear(),
          db().payments.clear(),
          db().salesReturns.clear(),
          db().creditNotes.clear(),
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
    if (!user || !firebaseDb) return;
    setLoading(true);
    try {
      const snap = await get(ref(firebaseDb, `userCompanies/${user.uid}`));
      const val = snap.val();
      if (val) {
        const companyIds = Object.keys(val);
        const summaries: CompanySummary[] = [];
        for (const cId of companyIds) {
          const compSnap = await get(ref(firebaseDb, `companies/${cId}`)).catch(() => null);
          const memSnap = await get(ref(firebaseDb, `memberships/${cId}/${user.uid}`)).catch(() => null);
          const compData = compSnap && compSnap.exists() ? compSnap.val() : null;
          const memData = memSnap && memSnap.exists() ? memSnap.val() : null;
          const isDemo = Boolean(compData?.isDemo || compData?.organizationType === "DEMO");
          summaries.push({
            id: cId,
            name: compData?.name || compData?.legalName || (cId === "comp_1789194549079_1wz2v" ? "KH Portable Cabins" : "Company Workspace"),
            legalName: compData?.legalName,
            role: memData?.role || (cId === "comp_1789194549079_1wz2v" ? "owner" : "member"),
            organizationType: isDemo ? "DEMO" : "NORMAL",
            isDemo,
            demoExpiresAt: compData?.demoExpiresAt,
          });
        }
        if (summaries.length > 0) {
          setCompanies(summaries);
          setActiveCompanyId((prev) => (prev && summaries.some((s) => s.id === prev) ? prev : summaries[0].id));
        }
      }
    } catch (e) {
      console.warn("Manual refresh failed:", e);
    } finally {
      setLoading(false);
      setResolvedUserId(user.uid);
    }
  }, [user]);

  const isDemo = Boolean(activeCompany?.isDemo || activeCompany?.organizationType === "DEMO");
  const isDemoExpired = Boolean(
    isDemo &&
    activeCompany?.demoExpiresAt &&
    Date.now() > activeCompany.demoExpiresAt
  );

  const can = (capability: string, branchId?: string | null): boolean => {
    const targetBranch = branchId !== undefined ? branchId : (activeBranchId === "all" ? null : activeBranchId);
    return hasCapability(activeMembership, capability as Capability, targetBranch);
  };

  const activeFinancialYear = financialYears.find((fy) => fy.id === activeFinancialYearId) || null;
  const activeBranch = activeBranchId !== "all" ? branches.find((b: Branch) => b.id === activeBranchId) || null : null;
  const isAllBranches = activeBranchId === "all";

  return (
    <ActiveCompanyContext.Provider
      value={{
        companies,
        activeCompany,
        activeMembership,
        financialYears,
        activeFinancialYear,
        branches,
        activeBranchId,
        activeBranch,
        isAllBranches,
        loading: loading || Boolean(user && resolvedUserId !== user.uid),
        error,
        isOwner,
        isDemo,
        isDemoExpired,
        resolvedUserId,
        companiesLoaded: Boolean(resolvedUserId === user?.uid && !loading),
        can,
        switchCompany,
        switchFinancialYear,
        switchBranch,
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
