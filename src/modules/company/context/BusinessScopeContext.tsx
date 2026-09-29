import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useActiveCompany } from "./ActiveCompanyContext";
import {
  buildBusinessScope,
  resolveDatePreset,
  resolveComparisonRange,
  type BusinessScope,
  type DatePreset,
  type ComparisonMode,
  type DateRange,
} from "@/modules/accounting/services/reportingScope";
import type { Branch, FinancialYear } from "../types";

export interface BusinessScopeContextValue {
  scope: BusinessScope;
  // Branch dimensions
  branches: Branch[];
  activeBranchId: string | "all";
  activeBranch: Branch | null;
  isAllBranches: boolean;
  isOwner: boolean;
  switchBranch: (branchId: string | "all") => void;
  // Financial Year dimensions
  financialYears: FinancialYear[];
  activeFinancialYear: FinancialYear | null;
  switchFinancialYear: (fyId: string) => void;
  // Date dimensions
  datePreset: DatePreset;
  dateRange: DateRange;
  customFrom: string;
  customTo: string;
  setDatePreset: (preset: DatePreset) => void;
  setCustomDateRange: (from: string, to: string) => void;
  // Comparison dimensions
  comparisonMode: ComparisonMode;
  comparisonRange: DateRange | null;
  setComparisonMode: (mode: ComparisonMode) => void;
  // Record filter helper
  filterRecords: <T extends { branchId?: string; companyId?: string; date?: any; createdAt?: number }>(
    records: T[],
    dateField?: keyof T,
    options?: { ignoreDateRange?: boolean }
  ) => T[];
}

const BusinessScopeContext = createContext<BusinessScopeContextValue | undefined>(undefined);

export function BusinessScopeProvider({ children }: { children: ReactNode }) {
  const {
    activeCompany,
    activeBranchId,
    activeBranch,
    branches,
    isOwner,
    isAllBranches,
    switchBranch,
    financialYears,
    activeFinancialYear,
    switchFinancialYear,
  } = useActiveCompany();

  // Storage key for date preset preference
  const datePresetStorageKey = activeCompany?.id ? `bms_date_preset_${activeCompany.id}` : null;

  const [datePreset, setDatePresetState] = useState<DatePreset>(() => {
    if (typeof window !== "undefined" && datePresetStorageKey) {
      const saved = localStorage.getItem(datePresetStorageKey) as DatePreset;
      if (saved) return saved;
    }
    return "this_fy";
  });

  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("none");

  // Sync date preset on company switch
  useEffect(() => {
    if (!datePresetStorageKey || typeof window === "undefined") return;
    const saved = localStorage.getItem(datePresetStorageKey) as DatePreset;
    if (saved && saved !== datePreset) {
      setDatePresetState(saved);
    }
  }, [datePresetStorageKey]);

  const setDatePreset = useCallback(
    (preset: DatePreset) => {
      setDatePresetState(preset);
      if (datePresetStorageKey && typeof window !== "undefined") {
        localStorage.setItem(datePresetStorageKey, preset);
      }
    },
    [datePresetStorageKey]
  );

  const setCustomDateRange = useCallback((from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setDatePresetState("custom");
  }, []);

  const authorizedBranchIds = useMemo(() => branches.map((b) => b.id), [branches]);

  const scope = useMemo<BusinessScope>(() => {
    return buildBusinessScope({
      companyId: activeCompany?.id || "default",
      activeBranchId,
      authorizedBranchIds,
      financialYearId: activeFinancialYear?.id,
      financialYear: activeFinancialYear
        ? {
            id: activeFinancialYear.id,
            name: activeFinancialYear.name,
            startDate: activeFinancialYear.startDate,
            endDate: activeFinancialYear.endDate,
          }
        : undefined,
      datePreset,
      customFrom,
      customTo,
      comparisonMode,
    });
  }, [
    activeCompany?.id,
    activeBranchId,
    authorizedBranchIds,
    activeFinancialYear,
    datePreset,
    customFrom,
    customTo,
    comparisonMode,
  ]);

  const dateRange = scope.dateRange;

  const comparisonRange = useMemo(() => {
    return resolveComparisonRange(dateRange, comparisonMode, {
      fyStart: activeFinancialYear?.startDate,
      fyEnd: activeFinancialYear?.endDate,
    });
  }, [dateRange, comparisonMode, activeFinancialYear]);

  const filterRecords = useCallback(
    <T extends { branchId?: string; companyId?: string; date?: any; createdAt?: number }>(
      records: T[],
      dateField?: keyof T,
      options?: { ignoreDateRange?: boolean }
    ): T[] => {
      if (!Array.isArray(records)) return [];
      return records.filter((r) => {
        // 1. Strict Branch Isolation
        if (scope.scopeMode === "BRANCH") {
          if (r.branchId !== scope.activeBranchId) {
            return false;
          }
        }

        // 2. Date Filtering (bypassed if ignoreDateRange is true)
        if (!options?.ignoreDateRange && scope.dateRange.preset !== "all_time") {
          const rawDate = dateField ? r[dateField] : (r.date ?? r.createdAt);
          if (rawDate !== undefined && rawDate !== null) {
            const time =
              typeof rawDate === "number"
                ? rawDate
                : typeof rawDate === "string" && rawDate.length === 10
                ? new Date(`${rawDate}T00:00:00.000`).getTime()
                : new Date(rawDate).getTime();

            if (!isNaN(time)) {
              if (time < scope.dateRange.fromTimestamp || time > scope.dateRange.toTimestamp) {
                return false;
              }
            }
          }
        }

        return true;
      });
    },
    [scope]
  );

  const value = useMemo<BusinessScopeContextValue>(
    () => ({
      scope,
      branches,
      activeBranchId,
      activeBranch,
      isAllBranches,
      isOwner,
      switchBranch,
      financialYears,
      activeFinancialYear,
      switchFinancialYear,
      datePreset,
      dateRange,
      customFrom,
      customTo,
      setDatePreset,
      setCustomDateRange,
      comparisonMode,
      comparisonRange,
      setComparisonMode,
      filterRecords,
    }),
    [
      scope,
      branches,
      activeBranchId,
      activeBranch,
      isAllBranches,
      isOwner,
      switchBranch,
      financialYears,
      activeFinancialYear,
      switchFinancialYear,
      datePreset,
      dateRange,
      customFrom,
      customTo,
      setDatePreset,
      setCustomDateRange,
      comparisonMode,
      comparisonRange,
      filterRecords,
    ]
  );

  return <BusinessScopeContext.Provider value={value}>{children}</BusinessScopeContext.Provider>;
}

export function useBusinessScope() {
  const ctx = useContext(BusinessScopeContext);
  if (!ctx) {
    throw new Error("useBusinessScope must be used within a BusinessScopeProvider");
  }
  return ctx;
}
