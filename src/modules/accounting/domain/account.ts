/**
 * Account Group and Nature Domain Models.
 */

export type AccountNature = "asset" | "liability" | "equity" | "income" | "expense";

export type NormalBalance = "debit" | "credit";

/**
 * Returns the normal balance for any fundamental accounting nature.
 * Structural metadata drives reports, never inferring from names.
 */
export function getNormalBalance(nature: AccountNature): NormalBalance {
  switch (nature) {
    case "asset":
    case "expense":
      return "debit";
    case "liability":
    case "equity":
    case "income":
      return "credit";
  }
}

/**
 * Financial Statement Classification.
 */
export function getStatementType(nature: AccountNature): "balance_sheet" | "profit_and_loss" {
  switch (nature) {
    case "asset":
    case "liability":
    case "equity":
      return "balance_sheet";
    case "income":
    case "expense":
      return "profit_and_loss";
  }
}

export interface AccountGroup {
  id: string;
  companyId: string;
  name: string;
  parentGroupId?: string | null;
  nature: AccountNature;
  normalBalance: NormalBalance;
  isSystem: boolean;
  isLiquidity?: boolean; // True for Cash & Bank groups (eligible for Contra)
  sortOrder?: number;
  createdAt?: number;
}

/**
 * Validates group hierarchy and prevents circular references (A -> B -> A).
 * Returns true if setting parentGroupId on targetGroupId would create a cycle.
 */
export function detectGroupCycle(
  existingGroups: { id: string; parentGroupId?: string | null }[],
  targetGroupId: string,
  newParentGroupId: string | null | undefined
): boolean {
  if (!newParentGroupId) return false;
  if (targetGroupId === newParentGroupId) return true;

  const parentLookup = new Map<string, string | null | undefined>();
  for (const g of existingGroups) {
    parentLookup.set(g.id, g.parentGroupId);
  }

  let current: string | null | undefined = newParentGroupId;
  const visited = new Set<string>();

  while (current) {
    if (current === targetGroupId) {
      return true; // Cycle detected: new parent is a descendant of target
    }
    if (visited.has(current)) {
      return true; // Existing cycle encountered
    }
    visited.add(current);
    current = parentLookup.get(current);
  }

  return false;
}
