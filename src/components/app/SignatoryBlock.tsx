import React from "react";
import type { Company, CompanySnapshot, SignatoryConfig, SignatorySnapshot } from "@/modules/company/types";
import { resolveDocumentSignatory, TYPED_SIGNATURE_STYLES } from "@/modules/company/signatoryHelper";
import { AlertCircle } from "lucide-react";

export interface SignatoryBlockProps {
  company?: Partial<Company> | Partial<CompanySnapshot>;
  signatoryOverride?: Partial<SignatoryConfig> | null;
  signatorySnapshot?: Partial<SignatorySnapshot> | null;
  documentDate?: number | string | Date;
  className?: string;
  isSettingsPreview?: boolean;
}

export function SignatoryBlock({
  company,
  signatoryOverride,
  signatorySnapshot,
  documentDate,
  className = "",
  isSettingsPreview = false,
}: SignatoryBlockProps) {
  const resolved = resolveDocumentSignatory({
    company,
    signatoryOverride,
    signatorySnapshot,
    documentDate,
  });

  const styleConfig = TYPED_SIGNATURE_STYLES[resolved.typedSignatureStyle] || TYPED_SIGNATURE_STYLES.style_1;

  // Calculate dynamic font size based on name length to prevent clipping or multi-line wrap
  const nameLen = resolved.signatoryName.length || 4;
  const fontSize = nameLen > 25 ? "15px" : nameLen > 18 ? "18px" : nameLen > 12 ? "21px" : "24px";

  const hasSignatureToRender =
    resolved.showSignature &&
    ((resolved.signatureMode === "typed" && !!resolved.signatoryName) ||
      (resolved.signatureMode === "uploaded" && !!resolved.signatureUrl));

  const hasStampToRender = resolved.showStamp && resolved.stampMode === "uploaded" && !!resolved.stampUrl;

  const content = (
    <div className={`flex flex-col items-end text-right select-none ${className}`}>
      {/* 1. Header: For {Company Name} */}
      <div className="text-[11px] text-muted-foreground font-medium">
        For <span className="font-semibold text-foreground">{resolved.companyName || "Business Entity"}</span>
      </div>

      {/* 2. Visual Signature & Stamp Region */}
      <div className="relative mt-2 flex min-h-[58px] w-full max-w-[220px] items-center justify-end">
        {/* Company Stamp (subtly adjacent/behind) */}
        {hasStampToRender && (
          <div
            className={`pointer-events-none transition-all duration-200 ${
              hasSignatureToRender
                ? "absolute -left-2 top-0 z-0 opacity-80 mix-blend-multiply dark:mix-blend-screen"
                : "relative z-10"
            }`}
          >
            <img
              src={resolved.stampUrl}
              alt="Company Stamp"
              className="h-14 w-14 max-h-[55px] max-w-[90px] object-contain drop-shadow-sm"
              loading="lazy"
            />
          </div>
        )}

        {/* Signature Element */}
        {hasSignatureToRender && (
          <div className="relative z-10 flex items-center justify-end">
            {resolved.signatureMode === "typed" ? (
              <span
                style={{
                  fontFamily: styleConfig.fontFamily,
                  fontStyle: styleConfig.slant as any,
                  fontWeight: styleConfig.weight,
                  fontSize,
                  letterSpacing: styleConfig.letterSpacing,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                }}
                className="max-w-[210px] overflow-hidden text-ellipsis text-slate-800 dark:text-slate-100 drop-shadow-xs"
                title={resolved.signatoryName}
              >
                {resolved.signatoryName}
              </span>
            ) : (
              <img
                src={resolved.signatureUrl}
                alt="Authorized Signature"
                className="h-12 max-h-[48px] max-w-[140px] object-contain"
                loading="lazy"
              />
            )}
          </div>
        )}

        {/* Empty state line if neither is enabled or uploaded */}
        {!hasSignatureToRender && !hasStampToRender && (
          <div className="h-8 w-32 border-b border-dashed border-border/80" />
        )}
      </div>

      {/* 3. Signatory Name */}
      {resolved.showSignatoryName && (
        <div className="mt-1.5 text-xs font-semibold text-foreground tracking-tight">
          {resolved.signatoryName || "Authorized Signatory"}
        </div>
      )}

      {/* 4. Designation */}
      {resolved.showDesignation && resolved.designation && (
        <div className="text-[11px] text-muted-foreground font-medium">
          {resolved.designation}
        </div>
      )}

      {/* 5. Date */}
      {resolved.showSignatureDate && resolved.signatureDateText && (
        <div className="mt-0.5 text-[10px] text-muted-foreground/80 font-mono">
          Date: {resolved.signatureDateText}
        </div>
      )}

      {/* Date mismatch warning */}
      {resolved.isDateMismatched && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>Signature date differs from document date</span>
        </div>
      )}
    </div>
  );

  if (isSettingsPreview) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/25 p-4 backdrop-blur shadow-xs">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live Document Preview
        </div>
        <div className="flex justify-end pt-2">
          {content}
        </div>
      </div>
    );
  }

  return content;
}
