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

export function useAccounting() {
  const { user } = useAuth();
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const companyId = activeCompany?.id;

  const [vouchersMap, setVouchersMap] = useState<Record<string, Voucher>>({});
  const [ledgersMap, setLedgersMap] = useState<Record<string, Ledger>>({});
  const [customGroupsMap, setCustomGroupsMap] = useState<Record<string, AccountGroup>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe in realtime to company accounting data
  useEffect(() => {
    if (!firebaseDb || !companyId) {
      setVouchersMap({});
      setLedgersMap({});
      setCustomGroupsMap({});
      setLoading(false);
      return;
    }

    setLoading(true);

    const vouchersRef = ref(firebaseDb, `companyData/${companyId}/vouchers`);
    const ledgersRef = ref(firebaseDb, `companyData/${companyId}/ledgers`);
    const groupsRef = ref(firebaseDb, `companyData/${companyId}/accountGroups`);

    const unsubs: (() => void)[] = [];

    const unsubVouchers = onValue(
      vouchersRef,
      (snap) => {
        if (snap.exists()) {
          setVouchersMap(snap.val() || {});
        } else {
          setVouchersMap({});
        }
      },
      (err) => {
        console.error("Vouchers listener error:", err);
      }
    );
    unsubs.push(() => off(vouchersRef, "value", unsubVouchers));

    const unsubLedgers = onValue(
      ledgersRef,
      (snap) => {
        if (snap.exists()) {
          setLedgersMap(snap.val() || {});
        } else {
          setLedgersMap({});
        }
      },
      (err) => {
        console.error("Ledgers listener error:", err);
      }
    );
    unsubs.push(() => off(ledgersRef, "value", unsubLedgers));

    const unsubGroups = onValue(
      groupsRef,
      (snap) => {
        if (snap.exists()) {
          setCustomGroupsMap(snap.val() || {});
        } else {
          setCustomGroupsMap({});
        }
        setLoading(false);
      },
      (err) => {
        console.error("Account groups listener error:", err);
        setLoading(false);
      }
    );
    unsubs.push(() => off(groupsRef, "value", unsubGroups));

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [companyId]);

  // Derived lists
  const vouchers = useMemo(() => {
    return Object.values(vouchersMap).sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
  }, [vouchersMap]);

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

  // Post Voucher action
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

      return await postVoucherServerFn({
        data: {
          ...input,
          idToken,
          companyId,
          financialYearId: fyId,
          clientMutationId,
        },
      });
    },
    [user, companyId, activeFinancialYear]
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
