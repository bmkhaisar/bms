import type { Quotation, BankAccount, TechSpecSection } from "@/lib/db";
import { createCompanySnapshot } from "@/modules/company/types";
import { createSignatorySnapshot } from "@/modules/company/signatoryHelper";
import { extractTableRowsFromMarkdown, extractTermsFromMarkdown } from "@/lib/markdownDoc";
import { resolveGeneralInfoFields } from "@/lib/cabinConfiguration";
import { resolveTechSpecSections } from "@/lib/techSpecResolution";

/**
 * Freezes immutable master snapshots at Quotation Issue/Finalization (PRD §§ 7-9, 28, 78-82)
 * Ensures historical quotation reprints never depend on current Company Settings.
 */
export function freezeQuotationSnapshots(
  quotation: Quotation,
  company?: any,
  banks?: BankAccount[],
  force = false
): Quotation {
  const isFinalized = force || Boolean(quotation.status && quotation.status !== "draft");
  if (!isFinalized) {
    return quotation;
  }

  const comp = quotation.companySnapshot || company;
  const defaultBank =
    banks && banks.length > 0
      ? banks.find((b) => b.isDefault) || banks[0]
      : undefined;

  const rawResolvedBank =
    quotation.bankDetailsSnapshot ||
    quotation.bankSnapshot ||
    defaultBank ||
    (comp && comp.bankName
      ? {
          id: comp.bankAccountId || "comp_bank",
          bankName: comp.bankName,
          accountHolderName:
            comp.accountHolderName ||
            comp.bankAccountHolderName ||
            comp.legalName ||
            comp.name ||
            "Business Entity",
          accountName:
            comp.accountHolderName ||
            comp.bankAccountHolderName ||
            comp.legalName ||
            comp.name ||
            "Business Entity",
          accountNo: comp.bankAccount || comp.bankAccountNo || "—",
          ifsc: comp.bankIfsc || "—",
          branch: comp.bankBranch,
          accountType: comp.bankAccountType,
          upi: comp.upiId,
          swift: comp.bankSwiftCode,
          createdAt: Date.now(),
        }
      : undefined);
  const resolvedBank = rawResolvedBank ? {
    ...rawResolvedBank,
    accountHolderName: (rawResolvedBank as any).accountHolderName || (rawResolvedBank as any).accountName || comp?.accountHolderName || comp?.bankAccountHolderName || comp?.legalName || comp?.name,
    accountName: (rawResolvedBank as any).accountName || (rawResolvedBank as any).accountHolderName || comp?.accountHolderName || comp?.bankAccountHolderName || comp?.legalName || comp?.name,
    accountNo: (rawResolvedBank as any).accountNo || (rawResolvedBank as any).bankAccountNo || (rawResolvedBank as any).accountNumber || (rawResolvedBank as any).bankAccount || (rawResolvedBank as any).bankAccountNumber || comp?.bankAccountNo || comp?.bankAccount || "—",
    bankName: (rawResolvedBank as any).bankName || comp?.bankName || "—",
    ifsc: (rawResolvedBank as any).ifsc || (rawResolvedBank as any).bankIfsc || comp?.bankIfsc || "—",
  } : undefined;

  const resolvedTerms =
    quotation.termsSnapshot ||
    (quotation.terms
      ? quotation.terms
          .split(/\r?\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
      : comp?.quotationTermsMarkdown
      ? extractTermsFromMarkdown(comp.quotationTermsMarkdown)
      : comp?.terms
      ? comp.terms
          .split(/\r?\n+/)
          .map((l: string) => l.trim())
          .filter(Boolean)
      : undefined);

  const resolvedStructuredTerms =
    quotation.structuredTermsSnapshot ||
    (quotation.structuredTerms && quotation.structuredTerms.length > 0
      ? [{ title: "Terms & Conditions", format: "numbered", items: quotation.structuredTerms }]
      : undefined);

  const resolvedGeneralInfo = resolveGeneralInfoFields({
    companyFields: comp?.generalInfoFields,
    companyMarkdown: comp?.quotationGeneralInfoMarkdown,
    items: quotation.items,
    documentOverride: quotation.generalInformationSnapshot || quotation.generalInfoSnapshot,
    cabinOverride: quotation.cabinConfigurationOverride,
    isCabinConfigCustom: quotation.isCabinConfigCustom,
    isIssuedOrFrozen: true,
    frozenSnapshot: quotation.generalInformationSnapshot || quotation.generalInfoSnapshot,
  });

  const resolvedTechSpecs: TechSpecSection[] | undefined = resolveTechSpecSections({
    companyMarkdown: comp?.quotationTechnicalSpecsMarkdown,
    documentOverride: (quotation.structuredSections && quotation.structuredSections.length > 0)
      ? quotation.structuredSections
      : (quotation.technicalSpecificationSnapshot && quotation.technicalSpecificationSnapshot.length > 0)
        ? quotation.technicalSpecificationSnapshot
        : quotation.techSpecSnapshot,
    isIssuedOrFrozen: true,
    frozenSnapshot: quotation.technicalSpecificationSnapshot || quotation.techSpecSnapshot,
  });

  const resolvedVisibility =
    quotation.visibilitySnapshot || {
      showGeneralInfo:
        quotation.includeGeneralInfo ?? (comp?.showQuotationGeneralInfo !== false),
      showTechSpecs:
        quotation.includeTechSpecs ?? (comp?.showQuotationTechnicalSpecs !== false),
      showTerms:
        quotation.includeTerms ?? (comp?.showQuotationTerms !== false),
      showBankDetails:
        quotation.includeBankDetails ?? (comp?.showQuotationBankDetails !== false),
    };

  return {
    ...quotation,
    companySnapshot: quotation.companySnapshot || (comp ? createCompanySnapshot(comp) : undefined),
    signatorySnapshot:
      quotation.signatorySnapshot ||
      (comp
        ? createSignatorySnapshot(comp, quotation.signatoryOverride, quotation.date)
        : undefined),
    bankDetailsSnapshot: resolvedBank,
    bankSnapshot: quotation.bankSnapshot || (resolvedBank as any),
    termsSnapshot: resolvedTerms,
    structuredTermsSnapshot: resolvedStructuredTerms,
    generalInformationSnapshot: resolvedGeneralInfo,
    technicalSpecificationSnapshot: resolvedTechSpecs,
    visibilitySnapshot: resolvedVisibility,
  };
}
