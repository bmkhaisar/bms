import { z } from "zod";

export const accountNatureSchema = z.enum(["asset", "liability", "equity", "income", "expense"]);

export const normalBalanceSchema = z.enum(["debit", "credit"]);

export const voucherTypeSchema = z.enum(["journal", "payment", "receipt", "contra"]);

export const voucherStatusSchema = z.enum(["draft", "posted", "reversed", "cancelled"]);

export const partyTypeSchema = z.enum(["customer", "supplier", "bank", "cash", "general"]);

export const postVoucherLineSchema = z.object({
  ledgerId: z.string().min(1, "Ledger ID is required"),
  debit: z.number().min(0, "Debit cannot be negative"),
  credit: z.number().min(0, "Credit cannot be negative"),
  description: z.string().optional(),
  costCentreId: z.string().optional(),
  partyType: partyTypeSchema.optional(),
  partyId: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
});

export const postVoucherInputSchema = z.object({
  idToken: z.string().min(1, "Auth token required"),
  companyId: z.string().min(1, "Company ID required"),
  financialYearId: z.string().min(1, "Financial Year ID required"),
  branchId: z.string().default("br_main"),
  voucherType: voucherTypeSchema,
  date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number()]),
  reference: z.string().optional(),
  narration: z.string().min(1, "Narration is required"),
  lines: z.array(postVoucherLineSchema).min(2, "A double-entry voucher requires at least two lines"),
  clientMutationId: z.string().min(1, "clientMutationId required for idempotency"),
  amountsInRupees: z.boolean().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  sourceNumber: z.string().optional(),
});

export const reverseVoucherInputSchema = z.object({
  idToken: z.string().min(1, "Auth token required"),
  companyId: z.string().min(1, "Company ID required"),
  voucherId: z.string().min(1, "Voucher ID required"),
  reversalReason: z.string().min(1, "Reversal reason required"),
  reversalDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number()]).optional(),
  clientMutationId: z.string().min(1, "clientMutationId required for idempotency"),
});

export const manageLedgerInputSchema = z.object({
  idToken: z.string().min(1, "Auth token required"),
  companyId: z.string().min(1, "Company ID required"),
  ledgerId: z.string().optional(),
  name: z.string().min(1, "Ledger name required"),
  code: z.string().optional(),
  groupId: z.string().min(1, "Account group ID required"),
  openingBalance: z.number().min(0).optional(),
  openingBalanceType: z.enum(["dr", "cr"]).optional(),
  amountsInRupees: z.boolean().optional(),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  partyType: partyTypeSchema.optional(),
  partyId: z.string().optional(),
  bankDetails: z
    .object({
      accountNumber: z.string().optional(),
      ifsc: z.string().optional(),
      bankName: z.string().optional(),
      branchName: z.string().optional(),
      upiId: z.string().optional(),
    })
    .optional(),
  active: z.boolean().optional(),
});

export const manageGroupInputSchema = z.object({
  idToken: z.string().min(1, "Auth token required"),
  companyId: z.string().min(1, "Company ID required"),
  groupId: z.string().optional(),
  name: z.string().min(1, "Group name required"),
  parentGroupId: z.string().min(1, "Parent group ID required to inherit accounting nature"),
});
