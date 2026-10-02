import { useEffect, useState, useCallback, useMemo } from "react";
import { ref, onValue, off } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import type {
  Voucher,
  Ledger,
  AccountGroup,
  PostVoucherInput,
  PostVoucherResult,
  ReverseVoucherResult,
  ManageLedgerInput,
  ManageLedgerResult,
} from "./types";
import { SYSTEM_ACCOUNT_GROUPS } from "./defaultGroups";
import { postVoucherServerFn } from "@/functions/postVoucherFn";
import { reverseVoucherServerFn } from "@/functions/reverseVoucherFn";
import { manageLedgerServerFn } from "@/functions/manageLedgerFn";
import { manageGroupServerFn } from "@/functions/manageGroupFn";
import { initChartOfAccountsServerFn } from "@/functions/initChartOfAccountsFn";

import { db } from "@/lib/db";

interface AccountingCacheState {
  vouchersMap: Record<string, Voucher>;
  ledgersMap: Record<string, Ledger>;
  customGroupsMap: Record<string, AccountGroup>;
  timestamp: number;
}

const memoryCache: Record<string, AccountingCacheState> = {};

export function useAccounting() {
  const { user } = useAuth();
  const { activeCompany, activeFinancialYear, activeBranchId } = useActiveCompany();
  const companyId = activeCompany?.id;

  // Initialize immediately from memory cache if available for 0ms transition
  const cached = companyId ? memoryCache[companyId] : undefined;
  const [vouchersMap, setVouchersMap] = useState<Record<string, Voucher>>(() => cached?.vouchersMap || {});
  const [ledgersMap, setLedgersMap] = useState<Record<string, Ledger>>(() => cached?.ledgersMap || {});
  const [customGroupsMap, setCustomGroupsMap] = useState<Record<string, AccountGroup>>(() => cached?.customGroupsMap || {});
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  // Fast offline/local Dexie hydration on mount or company change
  useEffect(() => {
    if (!companyId) return;

    let isCancelled = false;
    async function hydrateFromLocalDexie() {
      try {
        const [dexieVouchers, dexieLedgers, dexieGroups] = await Promise.all([
          db().vouchers.toArray(),
          db().ledgers.toArray(),
          db().accountGroups.toArray(),
        ]);

        if (isCancelled) return;

        if (dexieVouchers.length > 0 || dexieLedgers.length > 0) {
          const vMap: Record<string, Voucher> = {};
          for (const v of dexieVouchers) {
            if ((v as any).companyId === companyId || !(v as any).companyId) {
              vMap[v.id] = v;
            }
          }

          const lMap: Record<string, Ledger> = {};
          for (const l of dexieLedgers) {
            if (l.companyId === companyId || !l.companyId) {
              lMap[l.id] = l;
            }
          }

          const gMap: Record<string, AccountGroup> = {};
          for (const g of dexieGroups) {
            if (g.companyId === companyId || !g.companyId) {
              gMap[g.id] = g;
            }
          }

          setVouchersMap((prev) => (Object.keys(prev).length === 0 ? vMap : { ...vMap, ...prev }));
          setLedgersMap((prev) => (Object.keys(prev).length === 0 ? lMap : { ...lMap, ...prev }));
          setCustomGroupsMap((prev) => (Object.keys(prev).length === 0 ? gMap : { ...gMap, ...prev }));
          setLoading(false);

          if (companyId) {
            memoryCache[companyId] = {
              vouchersMap: vMap,
              ledgersMap: lMap,
              customGroupsMap: gMap,
              timestamp: Date.now(),
            };
          }
        }
      } catch (err) {
        console.warn("[useAccounting] Dexie hydration skipped:", err);
      }
    }

    hydrateFromLocalDexie();
    return () => {
      isCancelled = true;
    };
  }, [companyId]);

  // Subscribe in realtime to company accounting data
  useEffect(() => {
    if (!firebaseDb || !companyId) {
      if (!companyId) {
        setVouchersMap({});
        setLedgersMap({});
        setCustomGroupsMap({});
        setLoading(false);
      }
      return;
    }

    const vouchersRef = ref(firebaseDb, `companyData/${companyId}/vouchers`);
    const ledgersRef = ref(firebaseDb, `companyData/${companyId}/ledgers`);
    const groupsRef = ref(firebaseDb, `companyData/${companyId}/accountGroups`);

    let vouchersLoaded = false;
    let ledgersLoaded = false;
    let groupsLoaded = false;

    // Safety timeout: Ensure loading never hangs indefinitely if RTDB connection lags or reconnects
    const fallbackTimer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    const checkAllLoaded = () => {
      if (vouchersLoaded && ledgersLoaded && groupsLoaded) {
        clearTimeout(fallbackTimer);
        setLoading(false);
      }
    };

    const unsubs: (() => void)[] = [];

    const unsubVouchers = onValue(
      vouchersRef,
      (snap) => {
        const val = snap.exists() ? snap.val() || {} : {};
        setVouchersMap(val);
        vouchersLoaded = true;
        checkAllLoaded();

        // Update memory cache
        if (!memoryCache[companyId]) {
          memoryCache[companyId] = { vouchersMap: {}, ledgersMap: {}, customGroupsMap: {}, timestamp: Date.now() };
        }
        memoryCache[companyId].vouchersMap = val;

        // Persist to local Dexie in background
        const vList = Object.values(val) as Voucher[];
        if (vList.length > 0) {
          db().vouchers.bulkPut(vList).catch(() => {});
        }
      },
      (err) => {
        console.error("Vouchers listener error:", err);
        vouchersLoaded = true;
        checkAllLoaded();
      }
    );
    unsubs.push(() => off(vouchersRef, "value", unsubVouchers));

    const unsubLedgers = onValue(
      ledgersRef,
      (snap) => {
        const val = snap.exists() ? snap.val() || {} : {};
        setLedgersMap(val);
        ledgersLoaded = true;
        checkAllLoaded();

        // Update memory cache
        if (!memoryCache[companyId]) {
          memoryCache[companyId] = { vouchersMap: {}, ledgersMap: {}, customGroupsMap: {}, timestamp: Date.now() };
        }
        memoryCache[companyId].ledgersMap = val;

        // Persist to local Dexie in background
        const lList = Object.values(val) as Ledger[];
        if (lList.length > 0) {
          db().ledgers.bulkPut(lList).catch(() => {});
        }
      },
      (err) => {
        console.error("Ledgers listener error:", err);
        ledgersLoaded = true;
        checkAllLoaded();
      }
    );
    unsubs.push(() => off(ledgersRef, "value", unsubLedgers));

    const unsubGroups = onValue(
      groupsRef,
      (snap) => {
        const val = snap.exists() ? snap.val() || {} : {};
        setCustomGroupsMap(val);
        groupsLoaded = true;
        checkAllLoaded();

        // Update memory cache
        if (!memoryCache[companyId]) {
          memoryCache[companyId] = { vouchersMap: {}, ledgersMap: {}, customGroupsMap: {}, timestamp: Date.now() };
        }
        memoryCache[companyId].customGroupsMap = val;

        // Persist to local Dexie in background
        const gList = Object.values(val) as AccountGroup[];
        if (gList.length > 0) {
          db().accountGroups.bulkPut(gList).catch(() => {});
        }
      },
      (err) => {
        console.error("Account groups listener error:", err);
        groupsLoaded = true;
        checkAllLoaded();
      }
    );
    unsubs.push(() => off(groupsRef, "value", unsubGroups));

    return () => {
      clearTimeout(fallbackTimer);
      unsubs.forEach((u) => u());
    };
  }, [companyId]);

  // Derived lists with branch isolation (PRD § 9, 10)
  const vouchers = useMemo(() => {
    const list = Object.values(vouchersMap).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
    if (activeBranchId && activeBranchId !== "all") {
      return list.filter((v) => (v as any).branchId === activeBranchId);
    }
    return list;
  }, [vouchersMap, activeBranchId]);

  const ledgers = useMemo(() => {
    return Object.values(ledgersMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [ledgersMap]);

  const accountGroups = useMemo((): AccountGroup[] => {
    const all: AccountGroup[] = SYSTEM_ACCOUNT_GROUPS.map((g) => ({
      id: g.id,
      name: g.name,
      nature: g.nature,
      isSystem: g.isSystem,
      isLiquidity: g.isLiquidity,
      companyId: companyId || "",
      parentGroupId: g.parentGroupId || null,
      createdAt: 0,
    }));
    for (const cg of Object.values(customGroupsMap)) {
      if (!all.some((g) => g.id === cg.id)) {
        all.push(cg);
      }
    }
    return all;
  }, [customGroupsMap, companyId]);

  // Post Voucher action with optimistic local write
  const postVoucher = useCallback(
    async (
      input: Omit<PostVoucherInput, "idToken" | "companyId" | "financialYearId" | "clientMutationId"> & {
        financialYearId?: string;
        clientMutationId?: string;
      }
    ): Promise<PostVoucherResult> => {
      if (!user) {
        return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
      }
      if (!companyId) {
        return { success: false, error: "No active company selected", code: "INVALID_INPUT" };
      }
      const fyId = input.financialYearId || activeFinancialYear?.id;
      if (!fyId) {
        return { success: false, error: "No active financial year selected", code: "INVALID_INPUT" };
      }

      const idToken = await user.getIdToken();
      const clientMutationId = input.clientMutationId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `mut_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);

      // 1. Instant optimistic local write
      const localVoucherId = `v_loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const prefix = input.voucherType.toUpperCase().slice(0, 3);
      const localVoucherNumber = `${prefix}/${activeFinancialYear?.name || "2026-27"}/${Date.now().toString().slice(-4)}`;
      const totalDebit = input.lines.reduce((s, l) => s + (input.amountsInRupees ? Math.round(l.debit * 100) : l.debit), 0);
      const totalCredit = input.lines.reduce((s, l) => s + (input.amountsInRupees ? Math.round(l.credit * 100) : l.credit), 0);

      const optimisticVoucher: Voucher = {
        id: localVoucherId,
        companyId,
        financialYearId: fyId,
        branchId: input.branchId || activeBranchId || "br_main",
        voucherType: input.voucherType,
        voucherNumber: localVoucherNumber,
        date: typeof input.date === "string" ? new Date(input.date).getTime() : input.date,
        reference: input.reference,
        narration: input.narration,
        status: "posted",
        lines: input.lines.map((l, idx) => ({
          id: `line_${idx}`,
          ledgerId: l.ledgerId,
          debit: input.amountsInRupees ? Math.round(l.debit * 100) : l.debit,
          credit: input.amountsInRupees ? Math.round(l.credit * 100) : l.credit,
          description: l.description,
        })),
        totalDebit,
        totalCredit,
        clientMutationId,
        createdBy: user.uid,
        createdAt: Date.now(),
      };

      setVouchersMap((prev) => ({ ...prev, [localVoucherId]: optimisticVoucher }));
      db().vouchers.put(optimisticVoucher).catch(() => {});

      try {
        const result = await postVoucherServerFn({
          data: {
            ...input,
            idToken,
            companyId,
            financialYearId: fyId,
            clientMutationId,
          },
        });

        if (result.success && result.voucher) {
          setVouchersMap((prev) => {
            const next = { ...prev };
            delete next[localVoucherId];
            next[result.voucher!.id] = result.voucher!;
            return next;
          });
          db().vouchers.delete(localVoucherId).catch(() => {});
          db().vouchers.put(result.voucher).catch(() => {});
        } else if (!result.success) {
          // Revert optimistic voucher if server failed
          setVouchersMap((prev) => {
            const next = { ...prev };
            delete next[localVoucherId];
            return next;
          });
          db().vouchers.delete(localVoucherId).catch(() => {});
        }
        return result;
      } catch (err: any) {
        // Revert on unhandled network exception
        setVouchersMap((prev) => {
          const next = { ...prev };
          delete next[localVoucherId];
          return next;
        });
        db().vouchers.delete(localVoucherId).catch(() => {});
        return { success: false, error: err?.message || "Failed to post voucher" };
      }
    },
    [user, companyId, activeFinancialYear, activeBranchId]
  );

  // Reverse Voucher action
  const reverseVoucher = useCallback(
    async (voucherId: string, reversalReason: string): Promise<ReverseVoucherResult> => {
      if (!user) {
        return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
      }
      if (!companyId) {
        return { success: false, error: "No active company selected", code: "INVALID_STATE" };
      }

      const idToken = await user.getIdToken();
      const clientMutationId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `mut_rev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      return await reverseVoucherServerFn({
        data: {
          idToken,
          companyId,
          voucherId,
          reversalReason,
          clientMutationId,
        },
      });
    },
    [user, companyId]
  );

  // Manage Ledger action
  const manageLedger = useCallback(
    async (input: Omit<ManageLedgerInput, "idToken" | "companyId">): Promise<ManageLedgerResult> => {
      if (!user) {
        return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
      }
      if (!companyId) {
        return { success: false, error: "No active company selected", code: "INVALID_INPUT" };
      }

      const idToken = await user.getIdToken();
      return await manageLedgerServerFn({
        data: {
          ...input,
          idToken,
          companyId,
        },
      });
    },
    [user, companyId]
  );

  // Manage Custom Group action
  const manageGroup = useCallback(
    async (name: string, parentGroupId: string, groupId?: string) => {
      if (!user) {
        return { success: false, error: "Not authenticated" };
      }
      if (!companyId) {
        return { success: false, error: "No active company selected" };
      }

      const idToken = await user.getIdToken();
      return await manageGroupServerFn({
        data: {
          idToken,
          companyId,
          name,
          parentGroupId,
          groupId,
        },
      });
    },
    [user, companyId]
  );

  // Ensure Chart of Accounts exists action
  const initChart = useCallback(async () => {
    if (!user || !companyId) return { success: false };
    const idToken = await user.getIdToken();
    return await initChartOfAccountsServerFn({
      data: {
        idToken,
        companyId,
      },
    });
  }, [user, companyId]);

  return {
    vouchers,
    vouchersMap,
    ledgers,
    ledgersMap,
    accountGroups,
    loading,
    error,
    postVoucher,
    reverseVoucher,
    manageLedger,
    manageGroup,
    initChart,
    companyId,
    activeFinancialYear,
  };
}
