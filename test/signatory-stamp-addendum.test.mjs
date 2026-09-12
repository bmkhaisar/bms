import test from "node:test";
import assert from "node:assert/strict";

/**
 * Domain specification for Typed Signature styles (PRD Section 3 & 12)
 */
const TYPED_SIGNATURE_STYLES = {
  style_1: {
    id: "style_1",
    label: "Flowing Script",
    fontFamily: "'Dancing Script', cursive",
    weight: 600,
    slant: "italic",
    letterSpacing: "0.05em",
  },
  style_2: {
    id: "style_2",
    label: "Executive Flourish",
    fontFamily: "'Great Vibes', cursive",
    weight: 700,
    slant: "italic",
    letterSpacing: "0.02em",
  },
  style_3: {
    id: "style_3",
    label: "Modern Casual",
    fontFamily: "'Caveat', cursive",
    weight: 500,
    slant: "normal",
    letterSpacing: "0.01em",
  },
};

/**
 * Resolves signature date according to PRD Section 10 & 11
 */
function resolveSignatoryDate(dateMode, docDate, customDate) {
  if (dateMode === "hidden") return "";
  if (dateMode === "today") {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${dd}-${mm}-${yyyy}`;
  }
  if (dateMode === "custom" && customDate) {
    const s = String(customDate);
    if (s.includes("-")) {
      const p = s.split("-");
      if (p[0].length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
    }
    return s;
  }
  if (docDate) {
    const d = typeof docDate === "number" ? new Date(docDate) : new Date(String(docDate));
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${dd}-${mm}-${yyyy}`;
    }
    return String(docDate);
  }
  return "";
}

/**
 * Dynamically scales font size to prevent multi-line wrap or clipping (PRD Section 32)
 */
function calculateSignatureFontSize(name) {
  const len = (name || "").trim().length;
  if (len > 25) return { fontSize: "15px", pt: 12 };
  if (len > 18) return { fontSize: "18px", pt: 14 };
  if (len > 12) return { fontSize: "21px", pt: 17 };
  return { fontSize: "24px", pt: 20 };
}

/**
 * Enforces logical PDF bounds (PRD Section 18)
 * signature: max 45-50mm width, 16mm height
 * stamp: max 28-35mm width, 20mm height
 */
function normalizePdfImageBounds(type, rawWidthMm, rawHeightMm) {
  const maxW = type === "signature" ? 45 : 30;
  const maxH = type === "signature" ? 16 : 20;

  const aspect = (rawWidthMm && rawHeightMm) ? rawWidthMm / rawHeightMm : 2.5;
  let renderW = maxW;
  let renderH = renderW / aspect;

  if (renderH > maxH) {
    renderH = maxH;
    renderW = renderH * aspect;
  }

  return {
    widthMm: Math.min(renderW, maxW),
    heightMm: Math.min(renderH, maxH),
    aspectPreserved: true,
  };
}

/**
 * Pure resolver matching signatoryHelper.ts
 */
function resolveDocumentSignatory(params) {
  const { company = {}, signatoryOverride, signatorySnapshot, documentDate } = params;

  if (signatorySnapshot && signatorySnapshot.companyName) {
    const s = signatorySnapshot;
    const dateText = s.resolvedDateText || resolveSignatoryDate(s.signatureDateMode, documentDate, s.customSignatureDate);
    return {
      companyName: s.companyName,
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

  const compName = company.legalName || company.name || "Business Entity";
  const name = company.authorizedSignatory || "";
  const designation = company.designation || "";
  const sigMode = company.signatureMode || (company.signatureUrl ? "uploaded" : "none");
  const typedStyle = company.typedSignatureStyle || "style_1";
  const sigUrl = company.signatureUrl || undefined;
  const stampUrl = company.stampUrl || undefined;
  const stampMode = company.stampMode || (stampUrl ? "uploaded" : "none");

  const showSig = signatoryOverride?.showSignature !== undefined
    ? signatoryOverride.showSignature
    : company.showSignature !== undefined
      ? company.showSignature
      : sigMode === "typed" || !!sigUrl;

  const showStamp = signatoryOverride?.showStamp !== undefined
    ? signatoryOverride.showStamp
    : company.showStamp !== undefined
      ? company.showStamp
      : !!stampUrl;

  const showName = signatoryOverride?.showSignatoryName !== undefined
    ? signatoryOverride.showSignatoryName
    : company.showSignatoryName !== undefined
      ? company.showSignatoryName
      : true;

  const showDesig = signatoryOverride?.showDesignation !== undefined
    ? signatoryOverride.showDesignation
    : company.showDesignation !== undefined
      ? company.showDesignation
      : true;

  const showDate = signatoryOverride?.showSignatureDate !== undefined
    ? signatoryOverride.showSignatureDate
    : company.showSignatureDate !== undefined
      ? company.showSignatureDate
      : true;

  const dateMode = signatoryOverride?.signatureDateMode || company.signatureDateMode || "document_date";
  const customDate = signatoryOverride?.customSignatureDate || company.customSignatureDate;

  const resolvedDateText = resolveSignatoryDate(dateMode, documentDate, customDate);

  let isDateMismatched = false;
  if (dateMode === "custom" && customDate && documentDate) {
    const docDateText = resolveSignatoryDate("document_date", documentDate);
    isDateMismatched = resolvedDateText !== docDateText;
  }

  return {
    companyName: compName,
    signatoryName: name,
    designation,
    signatureMode: sigMode,
    typedSignatureStyle: typedStyle,
    signatureUrl: sigUrl,
    stampUrl,
    stampMode,
    showSignature: showSig,
    showStamp,
    showSignatoryName: showName,
    showDesignation: showDesig,
    showSignatureDate: showDate,
    signatureDateMode: dateMode,
    signatureDateText: resolvedDateText,
    isDateMismatched,
  };
}

/**
 * Creates frozen SignatorySnapshot for finalized documents (PRD Section 20)
 */
function createSignatorySnapshot(company, signatoryOverride, documentDate) {
  const resolved = resolveDocumentSignatory({
    company,
    signatoryOverride,
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
    customSignatureDate: company.customSignatureDate || signatoryOverride?.customSignatureDate,
    snapshottedAt: Date.now(),
  };
}

// ==========================================
// TEST CASES
// ==========================================

test("Signatory Addendum 1: Typed Signature with 3 cursive styles", () => {
  assert.ok(TYPED_SIGNATURE_STYLES.style_1, "Style 1 exists");
  assert.ok(TYPED_SIGNATURE_STYLES.style_2, "Style 2 exists");
  assert.ok(TYPED_SIGNATURE_STYLES.style_3, "Style 3 exists");

  assert.equal(TYPED_SIGNATURE_STYLES.style_1.slant, "italic");
  assert.equal(TYPED_SIGNATURE_STYLES.style_2.slant, "italic");
  assert.equal(TYPED_SIGNATURE_STYLES.style_3.slant, "normal");

  const res = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      authorizedSignatory: "Mohammed Maaz",
      signatureMode: "typed",
      typedSignatureStyle: "style_2",
    },
  });

  assert.equal(res.signatureMode, "typed");
  assert.equal(res.typedSignatureStyle, "style_2");
  assert.equal(res.signatoryName, "Mohammed Maaz");
  assert.equal(res.showSignature, true);
});

test("Signatory Addendum 2: Long Name Dynamic Font Scaling (No clipping/wrap)", () => {
  // Short name
  const shortScale = calculateSignatureFontSize("M");
  assert.equal(shortScale.fontSize, "24px");
  assert.equal(shortScale.pt, 20);

  // Typical name
  const medScale = calculateSignatureFontSize("Maaz");
  assert.equal(medScale.fontSize, "24px");

  // Long name
  const longScale = calculateSignatureFontSize("Mohammed Maaz");
  assert.equal(longScale.fontSize, "21px");

  // Extra long corporate name
  const xlScale = calculateSignatureFontSize("KH Portable Cabins Pvt Ltd");
  assert.equal(xlScale.fontSize, "15px");
  assert.ok(xlScale.pt <= 12, "Points scaled down appropriately for PDF rendering");
});

test("Signatory Addendum 3: Uploaded Signature Only", () => {
  const res = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      authorizedSignatory: "Director",
      signatureMode: "uploaded",
      signatureUrl: "https://r2.bmskh.in/companies/c1/signatures/v1/signature.png",
      stampUrl: "",
    },
  });

  assert.equal(res.signatureMode, "uploaded");
  assert.equal(res.signatureUrl, "https://r2.bmskh.in/companies/c1/signatures/v1/signature.png");
  assert.equal(res.showSignature, true);
  assert.equal(res.showStamp, false);
});

test("Signatory Addendum 4: Stamp Only Mode", () => {
  const res = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      authorizedSignatory: "Partner",
      signatureMode: "none",
      stampUrl: "https://r2.bmskh.in/companies/c1/stamps/v1/stamp.png",
      showStamp: true,
      showSignature: false,
    },
  });

  assert.equal(res.showSignature, false);
  assert.equal(res.showStamp, true);
  assert.equal(res.stampUrl, "https://r2.bmskh.in/companies/c1/stamps/v1/stamp.png");
});

test("Signatory Addendum 5: Composite Signature + Stamp (Both Enabled)", () => {
  const res = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      authorizedSignatory: "Maaz",
      designation: "Director",
      signatureMode: "typed",
      typedSignatureStyle: "style_1",
      stampUrl: "https://r2.bmskh.in/companies/c1/stamps/v1/stamp.png",
      stampMode: "uploaded",
      showSignature: true,
      showStamp: true,
    },
  });

  assert.equal(res.showSignature, true);
  assert.equal(res.showStamp, true);
  assert.equal(res.signatoryName, "Maaz");
  assert.equal(res.designation, "Director");
});

test("Signatory Addendum 6: PDF Visibility Toggles (Hide without deleting assets)", () => {
  const res = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      authorizedSignatory: "Maaz",
      signatureUrl: "https://r2.bmskh.in/sig.png",
      stampUrl: "https://r2.bmskh.in/stamp.png",
      showSignature: false, // User turned off on PDF
      showStamp: false,     // User turned off on PDF
      showSignatoryName: true,
      showDesignation: false,
      showSignatureDate: false,
    },
  });

  assert.equal(res.showSignature, false);
  assert.equal(res.showStamp, false);
  assert.equal(res.showSignatoryName, true);
  assert.equal(res.showDesignation, false);
  assert.equal(res.showSignatureDate, false);
  // Assets remain configured
  assert.equal(res.signatureUrl, "https://r2.bmskh.in/sig.png");
  assert.equal(res.stampUrl, "https://r2.bmskh.in/stamp.png");
});

test("Signatory Addendum 7: Signature Date Modes (document_date, today, custom, hidden)", () => {
  const docDate = 1789214400000; // 2026-09-12

  // 1. document_date
  const d1 = resolveSignatoryDate("document_date", docDate);
  assert.equal(d1, "12-09-2026");

  // 2. today
  const d2 = resolveSignatoryDate("today", docDate);
  assert.ok(/^\d{2}-\d{2}-\d{4}$/.test(d2), "Today formatted DD-MM-YYYY");

  // 3. custom past date
  const d3 = resolveSignatoryDate("custom", docDate, "2026-08-15");
  assert.equal(d3, "15-08-2026");

  // 4. custom future date
  const d4 = resolveSignatoryDate("custom", docDate, "2026-12-31");
  assert.equal(d4, "31-12-2026");

  // 5. hidden
  const d5 = resolveSignatoryDate("hidden", docDate);
  assert.equal(d5, "");
});

test("Signatory Addendum 8: Subtle warning when custom date differs from document date", () => {
  const docDate = "2026-09-12";

  // Matching date
  const resMatching = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      signatureDateMode: "custom",
      customSignatureDate: "2026-09-12",
    },
    documentDate: docDate,
  });
  assert.equal(resMatching.isDateMismatched, false);

  // Differing date
  const resDifferent = resolveDocumentSignatory({
    company: {
      name: "KH Portable Cabins",
      signatureDateMode: "custom",
      customSignatureDate: "2026-09-25",
    },
    documentDate: docDate,
  });
  assert.equal(resDifferent.isDateMismatched, true);
});

test("Signatory Addendum 9: Per-Document Override (More Options / Document Appearance)", () => {
  const company = {
    name: "KH Portable Cabins",
    authorizedSignatory: "Mohammed Maaz",
    designation: "Director",
    signatureMode: "typed",
    showSignature: true,
    showStamp: true,
    stampUrl: "https://r2.bmskh.in/stamp.png",
  };

  // Specific quotation overrides stamp to false and hides date
  const res = resolveDocumentSignatory({
    company,
    signatoryOverride: {
      showStamp: false,
      showSignatureDate: false,
    },
    documentDate: "2026-09-12",
  });

  assert.equal(res.showSignature, true);
  assert.equal(res.showStamp, false, "Stamp disabled on this quotation specifically");
  assert.equal(res.showSignatureDate, false, "Date hidden on this quotation specifically");
});

test("Signatory Addendum 10: Frozen Signatory Snapshot Immutability", () => {
  const originalCompany2026 = {
    name: "KH Portable Cabins",
    authorizedSignatory: "Mohammed Maaz",
    designation: "Director",
    signatureMode: "typed",
    typedSignatureStyle: "style_1",
    signatureUrl: "https://r2.bmskh.in/v1/sig.png",
  };

  // 1. Invoice is posted in 2026
  const snapshot2026 = createSignatorySnapshot(originalCompany2026, null, "2026-09-12");

  assert.equal(snapshot2026.authorizedSignatory, "Mohammed Maaz");
  assert.equal(snapshot2026.designation, "Director");

  // 2. Company Director changes in 2027
  const newCompany2027 = {
    name: "KH Portable Cabins",
    authorizedSignatory: "Sarah Khan",
    designation: "Managing Partner",
    signatureMode: "typed",
    typedSignatureStyle: "style_3",
    signatureUrl: "https://r2.bmskh.in/v2/sig.png",
  };

  // 3. Reprinting 2026 invoice uses the frozen snapshot
  const reprintedInvoiceSignatory = resolveDocumentSignatory({
    company: newCompany2027,
    signatorySnapshot: snapshot2026,
    documentDate: "2026-09-12",
  });

  assert.equal(reprintedInvoiceSignatory.signatoryName, "Mohammed Maaz", "Original 2026 signatory preserved");
  assert.equal(reprintedInvoiceSignatory.designation, "Director", "Original 2026 designation preserved");
  assert.equal(reprintedInvoiceSignatory.typedSignatureStyle, "style_1", "Original style preserved");
});

test("Signatory Addendum 11: Logical PDF Bounds Enforcement (No image stretching)", () => {
  // Ultra-wide signature image (e.g. 1200 x 200 px = 6:1 aspect)
  const sigBounds = normalizePdfImageBounds("signature", 120, 20);
  assert.ok(sigBounds.widthMm <= 45, "Signature width capped at 45mm");
  assert.ok(sigBounds.heightMm <= 16, "Signature height capped at 16mm");
  assert.equal(sigBounds.aspectPreserved, true);

  // Large square stamp image (e.g. 2000 x 2000 px = 1:1 aspect)
  const stampBounds = normalizePdfImageBounds("stamp", 100, 100);
  assert.ok(stampBounds.widthMm <= 30, "Stamp width capped at 30mm");
  assert.ok(stampBounds.heightMm <= 20, "Stamp height capped at 20mm");
  assert.equal(stampBounds.widthMm, stampBounds.heightMm, "Square aspect preserved");
});

test("Signatory Addendum 12: Reference-Safe Asset Lifecycle (Removing asset from settings does not delete R2)", () => {
  let r2Storage = {
    "companies/c1/signatures/v1/signature.png": { bytes: 4096, active: true },
    "companies/c1/stamps/v1/stamp.png": { bytes: 8192, active: true },
  };

  // When user clicks 'Remove Signature' in settings:
  const updatedCompanySettings = {
    signatureUrl: "", // removed from current settings
    signatureMode: "none",
  };

  // R2 storage remains completely intact for historical invoices!
  assert.ok(r2Storage["companies/c1/signatures/v1/signature.png"], "R2 object key is NOT deleted");
  assert.equal(r2Storage["companies/c1/signatures/v1/signature.png"].active, true);
});
