import type {
  Company,
  CompanySnapshot,
  SignatoryConfig,
  SignatorySnapshot,
  SignatureDateMode,
  SignatureMode,
  TypedSignatureStyle,
} from "@/modules/company/types";
import { formatDate } from "@/lib/format";

/**
 * Open-Source SIL OFL 1.1 fonts for Typed Signature.
 * - Dancing Script (Impallari Type, SIL Open Font License 1.1)
 * - Great Vibes (TypeSETit, SIL Open Font License 1.1)
 * - Caveat (Pablo Impallari, SIL Open Font License 1.1)
 *
 * Strictly avoids proprietary/system fonts (Brush Script MT, Segoe Script, Lucida Handwriting).
 * Settings Preview, Print Window, and Vector PDF all visually match this exact typography.
 */
export const TYPED_SIGNATURE_STYLES: Record<
  TypedSignatureStyle,
  { label: string; fontFamily: string; slant: string; weight: string; letterSpacing: string }
> = {
  style_1: {
    label: "Style 1 (Flowing Script)",
    fontFamily: "'Dancing Script', cursive",
    slant: "italic",
    weight: "600",
    letterSpacing: "0.5px",
  },
  style_2: {
    label: "Style 2 (Executive Flourish)",
    fontFamily: "'Great Vibes', cursive",
    slant: "italic",
    weight: "500",
    letterSpacing: "1px",
  },
  style_3: {
    label: "Style 3 (Modern Casual)",
    fontFamily: "'Caveat', cursive",
    slant: "normal",
    weight: "700",
    letterSpacing: "0.2px",
  },
};

/**
 * Renders high-resolution (300+ DPI vector equivalent) cursive typed signature
 * to a PNG data URL for embedding into jsPDF vector documents.
 * Ensures that Settings Preview, Print Window, and Vector PDF visually match identically.
 */
export function createTypedSignatureDataUrl(
  text: string,
  style: TypedSignatureStyle = "style_1",
  color = "#1e293b"
): string | null {
  if (typeof document === "undefined") return null;
  try {
    const config = TYPED_SIGNATURE_STYLES[style] || TYPED_SIGNATURE_STYLES.style_1;
    const canvas = document.createElement("canvas");
    // High-resolution canvas: 600 x 180 for 300+ DPI crisp vector equivalent
    const width = 600;
    const height = 180;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, width, height);

    const len = (text || "").trim().length || 4;
    const pxSize = len > 24 ? 54 : len > 18 ? 64 : len > 12 ? 76 : 88;

    const fontStyle = config.slant === "italic" ? "italic" : "normal";
    const fontWeight = config.weight || "600";
    ctx.font = `${fontStyle} ${fontWeight} ${pxSize}px ${config.fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    ctx.fillText(text, width - 20, height / 2);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Resolves the visual signature date string based on configured mode.
 */
export function resolveSignatoryDate(
  mode?: SignatureDateMode,
  documentDate?: number | string | Date,
  customDate?: string | number
): string {
  const m = mode || "document_date";
  if (m === "hidden") return "";

  if (m === "today") {
    return formatDate(Date.now());
  }

  if (m === "custom") {
    if (!customDate) return formatDate(Date.now());
    const parsed = typeof customDate === "number" ? customDate : new Date(customDate).getTime();
    return isNaN(parsed) ? String(customDate) : formatDate(parsed);
  }

  // default: document_date
  if (documentDate) {
    const parsed = typeof documentDate === "number" ? documentDate : new Date(documentDate).getTime();
    return isNaN(parsed) ? String(documentDate) : formatDate(parsed);
  }

  return formatDate(Date.now());
}

export interface ResolvedSignatory {
  companyName: string;
  signatoryName: string;
  designation: string;
  signatureMode: SignatureMode;
  typedSignatureStyle: TypedSignatureStyle;
  signatureUrl?: string;
  stampUrl?: string;
  stampMode: "none" | "uploaded";
  showSignature: boolean;
  showStamp: boolean;
  showSignatoryName: boolean;
  showDesignation: boolean;
  showSignatureDate: boolean;
  signatureDateMode: SignatureDateMode;
  signatureDateText: string;
  isDateMismatched: boolean;
}

/**
 * Resolves effective signatory parameters for any document, honoring document overrides
 * or falling back to company defaults, and preserving immutable snapshots for posted docs.
 */
export function resolveDocumentSignatory(params: {
  company?: Partial<Company> | Partial<CompanySnapshot>;
  signatoryOverride?: Partial<SignatoryConfig> | null;
  signatorySnapshot?: Partial<SignatorySnapshot> | null;
  documentDate?: number | string | Date;
}): ResolvedSignatory {
  const { company = {}, signatoryOverride, signatorySnapshot, documentDate } = params;

  // 1. If document is posted/finalized with frozen snapshot, use snapshot unconditionally
  if (
    signatorySnapshot &&
    (signatorySnapshot.snapshotAt !== undefined ||
      signatorySnapshot.companyName !== undefined ||
      signatorySnapshot.authorizedSignatory !== undefined)
  ) {
    const s = signatorySnapshot;
    const dateText = s.resolvedDateText || resolveSignatoryDate(s.signatureDateMode, documentDate, s.customSignatureDate);
    return {
      companyName: s.companyName || "Business Entity",
      signatoryName: s.authorizedSignatory || "",
      designation: s.designation || "",
      signatureMode: s.signatureMode || (s.signatureUrl ? "uploaded" : "none"),
      typedSignatureStyle: s.typedSignatureStyle || "style_1",
      signatureUrl: s.signatureUrl,
      stampUrl: s.stampUrl,
      stampMode: s.stampMode || (s.stampUrl ? "uploaded" : "none"),
      showSignature: s.showSignature ?? (!!s.signatureUrl || s.signatureMode === "typed"),
      showStamp: s.showStamp ?? !!s.stampUrl,
      showSignatoryName: s.showSignatoryName ?? true,
      showDesignation: s.showDesignation ?? true,
      showSignatureDate: s.showSignatureDate ?? true,
      signatureDateMode: s.signatureDateMode || "document_date",
      signatureDateText: dateText,
      isDateMismatched: false,
    };
  }

  // 2. Otherwise compose from company default + optional document override
  const compName = company.legalName || company.name || "Business Entity";
  const override = signatoryOverride || null;

  const signatoryName = override?.authorizedSignatory !== undefined
    ? override.authorizedSignatory
    : company.authorizedSignatory || "";

  const designation = override?.designation !== undefined
    ? override.designation
    : company.designation || "";

  const signatureMode: SignatureMode = override?.signatureMode !== undefined
    ? override.signatureMode
    : company.signatureMode || (company.signatureUrl ? "uploaded" : "none");

  const typedSignatureStyle: TypedSignatureStyle = override?.typedSignatureStyle !== undefined
    ? override.typedSignatureStyle
    : company.typedSignatureStyle || "style_1";

  const signatureUrl = override?.signatureUrl !== undefined ? override.signatureUrl : company.signatureUrl;
  const stampUrl = override?.stampUrl !== undefined ? override.stampUrl : company.stampUrl;
  const stampMode = override?.stampMode !== undefined
    ? override.stampMode
    : company.stampMode || (stampUrl ? "uploaded" : "none");

  const showSignature = override?.showSignature !== undefined
    ? override.showSignature
    : company.showSignature ?? (signatureMode === "typed" || !!signatureUrl);

  const showStamp = override?.showStamp !== undefined
    ? override.showStamp
    : company.showStamp ?? (stampMode === "uploaded" && !!stampUrl);

  const showSignatoryName = override?.showSignatoryName !== undefined
    ? override.showSignatoryName
    : company.showSignatoryName ?? true;

  const showDesignation = override?.showDesignation !== undefined
    ? override.showDesignation
    : company.showDesignation ?? true;

  const showSignatureDate = override?.showSignatureDate !== undefined
    ? override.showSignatureDate
    : company.showSignatureDate ?? true;

  const signatureDateMode: SignatureDateMode = override?.signatureDateMode !== undefined
    ? override.signatureDateMode
    : company.signatureDateMode || "document_date";

  const customSignatureDate = override?.customSignatureDate !== undefined
    ? override.customSignatureDate
    : company.customSignatureDate;

  const signatureDateText = resolveSignatoryDate(signatureDateMode, documentDate, customSignatureDate);

  // Check date mismatch warning (if custom date chosen and differs from document date)
  let isDateMismatched = false;
  if (signatureDateMode === "custom" && documentDate && signatureDateText) {
    const docDateText = formatDate(typeof documentDate === "number" ? documentDate : new Date(documentDate).getTime());
    if (docDateText && docDateText !== signatureDateText) {
      isDateMismatched = true;
    }
  }

  return {
    companyName: compName,
    signatoryName,
    designation,
    signatureMode,
    typedSignatureStyle,
    signatureUrl,
    stampUrl,
    stampMode,
    showSignature,
    showStamp,
    showSignatoryName,
    showDesignation,
    showSignatureDate,
    signatureDateMode,
    signatureDateText,
    isDateMismatched,
  };
}

/**
 * Creates an immutable SignatorySnapshot to attach to an issued document.
 */
export function createSignatorySnapshot(
  company: Partial<Company> | Partial<CompanySnapshot>,
  override?: Partial<SignatoryConfig> | null,
  documentDate?: number | string | Date
): SignatorySnapshot {
  const resolved = resolveDocumentSignatory({
    company,
    signatoryOverride: override,
    documentDate,
  });

  return {
    companyName: resolved.companyName,
    authorizedSignatory: resolved.signatoryName,
    designation: resolved.designation,
    signatureMode: resolved.signatureMode,
    typedSignatureStyle: resolved.typedSignatureStyle,
    signatureUrl: resolved.signatureUrl,
    stampUrl: resolved.stampUrl,
    stampMode: resolved.stampMode,
    showSignature: resolved.showSignature,
    showStamp: resolved.showStamp,
    showSignatoryName: resolved.showSignatoryName,
    showDesignation: resolved.showDesignation,
    showSignatureDate: resolved.showSignatureDate,
    signatureDateMode: resolved.signatureDateMode,
    resolvedDateText: resolved.signatureDateText,
    snapshotAt: Date.now(),
  };
}
