import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ImagePlus, Save, ShieldAlert, Building2, FileSignature, Stamp, AlertCircle, FileText, Eye, CheckCircle2 } from "lucide-react";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb } from "@/config/firebase";
import { ref, update } from "firebase/database";
import { cacheEntity, getCachedEntity } from "@/modules/sync/dexieCache";
import type { Company, TypedSignatureStyle } from "@/modules/company/types";
import { TYPED_SIGNATURE_STYLES } from "@/modules/company/signatoryHelper";
import { SignatoryBlock } from "@/components/app/SignatoryBlock";
import { MarkdownRenderer } from "@/lib/MarkdownRenderer";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Company Settings — BMS NEXT" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const { activeCompany, isOwner, can } = useActiveCompany();
  const canEdit = isOwner || can("company.settings.update");

  const [form, setForm] = useState<Partial<Company>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function initSettings() {
      if (!activeCompany) {
        setLoading(false);
        return;
      }

      // Check Dexie cache first for fast offline startup
      if (user?.uid) {
        const cached = await getCachedEntity<Company>({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "company",
          entityId: "profile",
        });
        if (cached && active) {
          setForm(cached);
        }
      }

      // Reconcile with active company from Firebase RTDB
      if (active) {
        setForm((prev) => ({
          ...prev,
          ...activeCompany,
        }));
        setLoading(false);
      }
    }

    initSettings();

    return () => {
      active = false;
    };
  }, [activeCompany, user?.uid]);

  function handleImageUpload(key: "logoUrl" | "signatureUrl" | "stampUrl") {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image file is too large. Please select an image under 2MB.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setForm((prev) => {
          const next = { ...prev, [key]: result };
          if (key === "signatureUrl") {
            next.signatureMode = "uploaded";
            next.showSignature = true;
          } else if (key === "stampUrl") {
            next.stampMode = "uploaded";
            next.showStamp = true;
          }
          return next;
        });
        toast.success(
          `${key === "logoUrl" ? "Company Logo" : key === "signatureUrl" ? "Signature" : "Company Stamp"} loaded. Click Save Changes to persist.`
        );
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function handleSave() {
    if (!canEdit) {
      toast.error("You do not have permission to update company settings.");
      return;
    }

    if (!activeCompany?.id || !user?.uid) {
      toast.error("No active company selected.");
      return;
    }

    if (!form.name?.trim()) {
      toast.error("Company Name is required.");
      return;
    }

    setSaving(true);
    const rawData = {
      ...form,
      name: form.name.trim(),
      legalName: form.legalName?.trim() || form.name.trim(),
      tradingName: form.tradingName?.trim() || "",
      address: form.address?.trim() || "",
      city: form.city?.trim() || "",
      state: form.state?.trim() || "",
      pincode: form.pincode?.trim() || "",
      country: form.country?.trim() || "India",
      phone: form.phone?.trim() || "",
      altPhone: form.altPhone?.trim() || "",
      email: form.email?.trim() || "",
      defaultShareCcEmail: form.defaultShareCcEmail?.trim() || "",
      website: form.website?.trim() || "",
      gstin: form.gstin?.trim().toUpperCase() || "",
      pan: form.pan?.trim().toUpperCase() || "",
      cin: form.cin?.trim().toUpperCase() || "",
      stateCode: form.stateCode?.trim() || "",
      bankName: form.bankName?.trim() || "",
      bankBranch: form.bankBranch?.trim() || "",
      bankAccountNo: form.bankAccountNo?.trim() || "",
      bankIfsc: form.bankIfsc?.trim().toUpperCase() || "",
      accountHolderName: form.accountHolderName?.trim() || form.bankAccountHolderName?.trim() || form.name?.trim() || "",
      bankAccountHolderName: form.accountHolderName?.trim() || form.bankAccountHolderName?.trim() || form.name?.trim() || "",
      bankAccountType: form.bankAccountType?.trim() || "",
      bankSwiftCode: form.bankSwiftCode?.trim() || "",
      upiId: form.upiId?.trim() || "",
      showQuotationGeneralInfo: form.showQuotationGeneralInfo ?? true,
      showQuotationTechnicalSpecs: form.showQuotationTechnicalSpecs ?? true,
      showQuotationTerms: form.showQuotationTerms ?? true,
      showInvoiceTerms: form.showInvoiceTerms ?? true,
      showQuotationBankDetails: form.showQuotationBankDetails ?? true,
      showInvoiceBankDetails: form.showInvoiceBankDetails ?? true,
      quotationGeneralInfoMarkdown: form.quotationGeneralInfoMarkdown ?? "",
      quotationTechnicalSpecsMarkdown: form.quotationTechnicalSpecsMarkdown ?? "",
      quotationTermsMarkdown: form.quotationTermsMarkdown ?? "",
      invoiceTermsMarkdown: form.invoiceTermsMarkdown ?? (form.terms || ""),
      quotationClosingMessage: form.quotationClosingMessage ?? "",
      authorizedSignatory: form.authorizedSignatory?.trim() || "",
      designation: form.designation?.trim() || "",
      signatureMode: form.signatureMode || (form.signatureUrl ? "uploaded" : "none"),
      typedSignatureStyle: form.typedSignatureStyle || "style_1",
      signatureUrl: form.signatureUrl || "",
      stampUrl: form.stampUrl || "",
      stampMode: form.stampMode || (form.stampUrl ? "uploaded" : "none"),
      showSignature: form.showSignature ?? (form.signatureMode === "typed" || !!form.signatureUrl),
      showStamp: form.showStamp ?? !!form.stampUrl,
      showSignatoryName: form.showSignatoryName ?? true,
      showDesignation: form.showDesignation ?? true,
      showSignatureDate: form.showSignatureDate ?? true,
      signatureDateMode: form.signatureDateMode || "document_date",
      customSignatureDate: form.customSignatureDate || "",
      terms: form.invoiceTermsMarkdown ?? (form.terms?.trim() || ""),
      invoicePrefix: form.invoicePrefix?.trim() || "INV",
      quotationPrefix: form.quotationPrefix?.trim() || "QT",
      purchasePrefix: form.purchasePrefix?.trim() || "PO",
      receiptPrefix: form.receiptPrefix?.trim() || "REC",
      paymentPrefix: form.paymentPrefix?.trim() || "PAY",
      logoUrl: form.logoUrl || "",
      updatedAt: Date.now(),
    };

    // Strip any remaining undefined values so Firebase update never throws
    const updatedData: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawData)) {
      if (value !== undefined) {
        updatedData[key] = value;
      }
    }

    try {
      // 1. Save to Firebase RTDB if available
      if (firebaseDb) {
        const compRef = ref(firebaseDb, `companies/${activeCompany.id}`);
        await update(compRef, updatedData);

        // Record audit entry for branding & signatory changes without storing binary blobs
        const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const auditRef = ref(firebaseDb, `companyData/${activeCompany.id}/auditLogs/${auditId}`);
        await update(auditRef, {
          id: auditId,
          companyId: activeCompany.id,
          actorUid: user.uid,
          action: "company.branding_signatory.updated",
          entityType: "company_settings",
          entityId: activeCompany.id,
          timestamp: Date.now(),
          details: {
            authorizedSignatory: updatedData.authorizedSignatory,
            designation: updatedData.designation,
            signatureMode: updatedData.signatureMode,
            typedSignatureStyle: updatedData.typedSignatureStyle,
            hasSignatureUrl: !!updatedData.signatureUrl,
            hasStampUrl: !!updatedData.stampUrl,
            stampMode: updatedData.stampMode,
            showSignature: updatedData.showSignature,
            showStamp: updatedData.showStamp,
            showSignatoryName: updatedData.showSignatoryName,
            showDesignation: updatedData.showDesignation,
            showSignatureDate: updatedData.showSignatureDate,
            signatureDateMode: updatedData.signatureDateMode,
          },
        });
      }

      // 2. Cache in local Dexie bms_cache_v1
      await cacheEntity({
        uid: user.uid,
        companyId: activeCompany.id,
        entityType: "company",
        entityId: "profile",
        data: updatedData,
      });

      toast.success("Company settings saved");
    } catch (err: unknown) {
      console.error("Failed to save company settings:", err);
      toast.error("Unable to save changes. Please verify your connection.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Company Settings">
        <div className="flex h-64 items-center justify-center">
          <p className="text-xs text-muted-foreground">Loading company configuration...</p>
        </div>
      </AppShell>
    );
  }

  if (!activeCompany) {
    return (
      <AppShell title="Company Settings">
        <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/50" />
          <h2 className="text-base font-semibold">No Active Company</h2>
          <p className="text-xs text-muted-foreground">Select or create a company to manage settings.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Company Settings">
      <PageHeader
        title="Company Settings"
        description="Legal business identity, tax credentials, banking, and document numbering."
        actions={
          canEdit ? (
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              <span>{saving ? "Saving..." : "Save Changes"}</span>
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="h-4 w-4" />
              <span>View-only permission</span>
            </div>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Business Details */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Business Profile</CardTitle>
            <CardDescription className="text-xs">
              Official legal details appearing on tax invoices and quotations
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Trading / Display Name *">
              <Input
                value={form.name ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="MMA Trading Co."
              />
            </Field>
            <Field label="Legal Entity Name *">
              <Input
                value={form.legalName ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                placeholder="MMA Trading Private Limited"
              />
            </Field>
            <Field label="GSTIN">
              <Input
                value={form.gstin ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                placeholder="29AAAAA0000A1Z5"
              />
            </Field>
            <Field label="PAN">
              <Input
                value={form.pan ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, pan: e.target.value })}
                placeholder="AAAAA0000A"
              />
            </Field>
            <Field label="CIN">
              <Input
                value={form.cin ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, cin: e.target.value })}
                placeholder="U12345KA2026PTC000000"
              />
            </Field>
            <Field label="State Code (GST)">
              <Input
                value={form.stateCode ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, stateCode: e.target.value })}
                placeholder="29"
              />
            </Field>
            <Field label="Corporate Phone *">
              <Input
                value={form.phone ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 9876543210"
              />
            </Field>
            <Field label="Alternate Phone">
              <Input
                value={form.altPhone ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, altPhone: e.target.value })}
                placeholder="+91 80 12345678"
              />
            </Field>
            <Field label="Official Email">
              <Input
                type="email"
                value={form.email ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="accounts@company.com"
              />
            </Field>
            <Field label="Default Share CC Email (Optional)">
              <Input
                type="email"
                value={form.defaultShareCcEmail ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, defaultShareCcEmail: e.target.value })}
                placeholder="accounts@company.com"
              />
            </Field>
            <Field label="Website">
              <Input
                value={form.website ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://company.com"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Registered Address *">
                <Textarea
                  rows={3}
                  value={form.address ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Plot No. 42, Industrial Area, Phase 1"
                />
              </Field>
            </div>
            <Field label="City *">
              <Input
                value={form.city ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Bengaluru"
              />
            </Field>
            <Field label="State *">
              <Input
                value={form.state ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="Karnataka"
              />
            </Field>
            <Field label="Pincode *">
              <Input
                value={form.pincode ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                placeholder="560001"
              />
            </Field>
            <Field label="Country">
              <Input
                value={form.country ?? "India"}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Branding & Document Series */}
        <div className="space-y-6">
          <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Company Logo</CardTitle>
              <CardDescription className="text-xs">
                Official logo rendered on invoices and quotations. Transparent PNG or WebP recommended.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {form.logoUrl ? (
                  <img
                    src={form.logoUrl}
                    alt="Company Logo"
                    className="h-16 w-20 rounded-xl border border-border/60 object-contain bg-white p-1.5 shadow-xs"
                  />
                ) : (
                  <div className="grid h-16 w-20 place-items-center rounded-xl border border-dashed border-border/80 text-xs text-muted-foreground">
                    No Logo
                  </div>
                )}
                {canEdit && (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 text-xs"
                      onClick={() => handleImageUpload("logoUrl")}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      {form.logoUrl ? "Replace Logo" : "Upload Logo"}
                    </Button>
                    {form.logoUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-destructive hover:text-destructive h-7"
                        onClick={() => setForm({ ...form, logoUrl: "" })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Document Prefixes */}
          <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Document Series</CardTitle>
              <CardDescription className="text-xs">
                Server-coordinated prefixes for atomic document sequencing
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice Prefix">
                <Input
                  value={form.invoicePrefix ?? "INV"}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                />
              </Field>
              <Field label="Quotation Prefix">
                <Input
                  value={form.quotationPrefix ?? "QT"}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, quotationPrefix: e.target.value })}
                />
              </Field>
              <Field label="Purchase Prefix">
                <Input
                  value={form.purchasePrefix ?? "PO"}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, purchasePrefix: e.target.value })}
                />
              </Field>
              <Field label="Receipt Prefix">
                <Input
                  value={form.receiptPrefix ?? "REC"}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, receiptPrefix: e.target.value })}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Authorized Signatory, Stamp & Document Appearance */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-3">
          <CardHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileSignature className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Authorized Signatory & Stamp</CardTitle>
                <CardDescription className="text-xs">
                  Configure the official signatory block, cursive typed signature, uploaded company seal, and per-document visibility options.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            <div className="grid gap-8 lg:grid-cols-12 items-start">
              {/* Left Column: Signatory Configuration */}
              <div className="lg:col-span-7 space-y-6">
                {/* 1. Name & Designation */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Authorized Signatory Name">
                    <Input
                      value={form.authorizedSignatory ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setForm({ ...form, authorizedSignatory: e.target.value })}
                      placeholder="e.g. Mohammed Maaz"
                    />
                  </Field>

                  <Field label="Designation / Role">
                    <Input
                      value={form.designation ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setForm({ ...form, designation: e.target.value })}
                      placeholder="e.g. Director, Partner, Proprietor"
                    />
                  </Field>
                </div>

                {/* 2. Signature Mode */}
                <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Signature Mode
                  </Label>
                  <RadioGroup
                    value={form.signatureMode || (form.signatureUrl ? "uploaded" : "none")}
                    disabled={!canEdit}
                    onValueChange={(val: any) =>
                      setForm({
                        ...form,
                        signatureMode: val,
                        showSignature: val !== "none",
                      })
                    }
                    className="grid grid-cols-3 gap-3"
                  >
                    <label
                      htmlFor="sig-mode-none"
                      className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center cursor-pointer transition-colors ${
                        (form.signatureMode || "none") === "none"
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border/60 hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value="none" id="sig-mode-none" className="sr-only" />
                      <span className="text-xs">None</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">Plain text / blank</span>
                    </label>

                    <label
                      htmlFor="sig-mode-typed"
                      className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center cursor-pointer transition-colors ${
                        form.signatureMode === "typed"
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border/60 hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value="typed" id="sig-mode-typed" className="sr-only" />
                      <span className="text-xs">Typed Signature</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">Cursive font style</span>
                    </label>

                    <label
                      htmlFor="sig-mode-uploaded"
                      className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center cursor-pointer transition-colors ${
                        form.signatureMode === "uploaded"
                          ? "border-primary bg-primary/5 text-primary font-medium"
                          : "border-border/60 hover:bg-muted/50"
                      }`}
                    >
                      <RadioGroupItem value="uploaded" id="sig-mode-uploaded" className="sr-only" />
                      <span className="text-xs">Upload Signature</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">Scanned PNG / WebP</span>
                    </label>
                  </RadioGroup>

                  {/* 2a. Typed Signature Style Selector */}
                  {form.signatureMode === "typed" && (
                    <div className="mt-4 space-y-2.5 pt-2 border-t border-border/40">
                      <Label className="text-xs font-medium text-foreground">
                        Signature Style
                      </Label>
                      <div className="grid grid-cols-3 gap-2.5">
                        {(["style_1", "style_2", "style_3"] as const).map((sKey) => {
                          const sDef = TYPED_SIGNATURE_STYLES[sKey];
                          const isSelected = (form.typedSignatureStyle || "style_1") === sKey;
                          const displayName = form.authorizedSignatory?.trim() || "Maaz";
                          return (
                            <button
                              key={sKey}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setForm({ ...form, typedSignatureStyle: sKey })}
                              className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all ${
                                isSelected
                                  ? "border-primary bg-background shadow-xs ring-1 ring-primary"
                                  : "border-border/60 bg-background/60 hover:bg-background"
                              }`}
                            >
                              <span
                                style={{
                                  fontFamily: sDef.fontFamily,
                                  fontStyle: sDef.slant as any,
                                  fontWeight: sDef.weight,
                                  letterSpacing: sDef.letterSpacing,
                                }}
                                className="text-base text-slate-800 dark:text-slate-100 max-w-full overflow-hidden text-ellipsis whitespace-nowrap"
                              >
                                {displayName}
                              </span>
                              <span className="text-[10px] text-muted-foreground mt-1">
                                {sDef.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2b. Uploaded Signature Control */}
                  {form.signatureMode === "uploaded" && (
                    <div className="mt-4 flex items-center gap-4 pt-2 border-t border-border/40">
                      {form.signatureUrl ? (
                        <img
                          src={form.signatureUrl}
                          alt="Signature Preview"
                          className="h-14 w-28 rounded-lg border border-border/60 object-contain bg-white p-1"
                        />
                      ) : (
                        <div className="grid h-14 w-28 place-items-center rounded-lg border border-dashed border-border/80 text-[11px] text-muted-foreground">
                          No File Chosen
                        </div>
                      )}
                      {canEdit && (
                        <div className="flex flex-col gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 text-xs"
                            onClick={() => handleImageUpload("signatureUrl")}
                          >
                            <ImagePlus className="h-3.5 w-3.5" />
                            {form.signatureUrl ? "Replace Signature" : "Upload Signature"}
                          </Button>
                          {form.signatureUrl && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-destructive hover:text-destructive h-6"
                              onClick={() => setForm({ ...form, signatureUrl: "" })}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Company Stamp */}
                <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Company Stamp
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Official rubber seal or digital company stamp. Composed alongside or behind signature.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-1">
                    {form.stampUrl ? (
                      <img
                        src={form.stampUrl}
                        alt="Company Stamp Preview"
                        className="h-16 w-16 rounded-lg border border-border/60 object-contain bg-white p-1"
                      />
                    ) : (
                      <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-border/80 text-[11px] text-muted-foreground">
                        No Stamp
                      </div>
                    )}
                    {canEdit && (
                      <div className="flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 text-xs"
                          onClick={() => handleImageUpload("stampUrl")}
                        >
                          <Stamp className="h-3.5 w-3.5" />
                          {form.stampUrl ? "Replace Stamp" : "Upload Stamp"}
                        </Button>
                        {form.stampUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-destructive hover:text-destructive h-6"
                            onClick={() => setForm({ ...form, stampUrl: "" })}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Document Options & Toggles */}
                <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Document Options (PDF Visibility)
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-2 pt-1">
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <span className="text-xs font-medium">Show Signature</span>
                      <Switch
                        checked={form.showSignature ?? (form.signatureMode === "typed" || !!form.signatureUrl)}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showSignature: val })}
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <span className="text-xs font-medium">Show Stamp</span>
                      <Switch
                        checked={form.showStamp ?? !!form.stampUrl}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showStamp: val })}
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <span className="text-xs font-medium">Show Signatory Name</span>
                      <Switch
                        checked={form.showSignatoryName ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showSignatoryName: val })}
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 p-2.5">
                      <span className="text-xs font-medium">Show Designation</span>
                      <Switch
                        checked={form.showDesignation ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showDesignation: val })}
                      />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/60 p-2.5 sm:col-span-2">
                      <span className="text-xs font-medium">Show Signature Date</span>
                      <Switch
                        checked={form.showSignatureDate ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showSignatureDate: val })}
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Signature Date Configuration */}
                <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Signature Date
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-2 pt-1">
                    <Field label="Date Mode">
                      <Select
                        value={form.signatureDateMode || "document_date"}
                        disabled={!canEdit}
                        onValueChange={(val: any) => setForm({ ...form, signatureDateMode: val })}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Select date mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="document_date" className="text-xs">
                            Use Document Date (Default)
                          </SelectItem>
                          <SelectItem value="today" className="text-xs">
                            Use Today's Date
                          </SelectItem>
                          <SelectItem value="custom" className="text-xs">
                            Custom Date
                          </SelectItem>
                          <SelectItem value="hidden" className="text-xs">
                            Hide Date
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    {form.signatureDateMode === "custom" && (
                      <Field label="Custom Date">
                        <Input
                          type="date"
                          value={form.customSignatureDate ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => setForm({ ...form, customSignatureDate: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </Field>
                    )}
                  </div>

                  {form.signatureDateMode === "custom" && form.customSignatureDate && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>Signature date differs from document date. (Subtle audit notice)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Live Interactive Signatory Preview */}
              <div className="lg:col-span-5 space-y-3 sticky top-6">
                <div className="rounded-xl border border-border/70 bg-gradient-to-br from-background/90 to-muted/30 p-5 shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-border/40">
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      Live Signatory Preview
                    </span>
                    <span className="text-[10px] text-muted-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                      Realtime
                    </span>
                  </div>

                  <div className="pt-6 pb-2">
                    <SignatoryBlock
                      company={form}
                      isSettingsPreview={false}
                      documentDate={
                        form.signatureDateMode === "custom" && form.customSignatureDate
                          ? form.customSignatureDate
                          : "2026-09-12"
                      }
                    />
                  </div>

                  <div className="mt-6 pt-3 border-t border-border/40 text-[11px] text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">Immutable Snapshot Guarantee:</span> When an invoice or quotation is issued or posted, the signatory configuration and asset references are frozen. Future changes to company settings will never alter previously issued historical documents.
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Universal Document Settings & Visibility Toggles */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-3">
          <CardHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Document Settings & Universal Defaults</CardTitle>
                <CardDescription className="text-xs">
                  Centrally configure content and visibility for Quotations and Invoices. New documents inherit these defaults automatically.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Global Document Visibility Toggles */}
            <div className="space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Document Section Visibility (Default for Future Documents)
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Quotation Toggles */}
                <div className="space-y-2.5 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    Quotation Defaults
                  </span>
                  <div className="grid gap-2 pt-1">
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show General Information</span>
                      <Switch
                        checked={form.showQuotationGeneralInfo ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showQuotationGeneralInfo: val })}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show Technical Specifications</span>
                      <Switch
                        checked={form.showQuotationTechnicalSpecs ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showQuotationTechnicalSpecs: val })}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show Terms & Conditions</span>
                      <Switch
                        checked={form.showQuotationTerms ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showQuotationTerms: val })}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show Bank Details</span>
                      <Switch
                        checked={form.showQuotationBankDetails ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showQuotationBankDetails: val })}
                      />
                    </div>
                  </div>
                </div>

                {/* Invoice Toggles */}
                <div className="space-y-2.5 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Invoice Defaults
                  </span>
                  <div className="grid gap-2 pt-1">
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show Terms & Conditions</span>
                      <Switch
                        checked={form.showInvoiceTerms ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showInvoiceTerms: val })}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/70 p-2 text-xs">
                      <span>Show Bank Details</span>
                      <Switch
                        checked={form.showInvoiceBankDetails ?? true}
                        disabled={!canEdit}
                        onCheckedChange={(val) => setForm({ ...form, showInvoiceBankDetails: val })}
                      />
                    </div>
                    <div className="rounded-lg border border-dashed border-border/60 bg-background/40 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                      General Information and Technical Specifications are excluded from Invoices by design to keep billing concise and compliant.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Markdown Content Editors with Live Interactive Preview */}
            <div className="space-y-4 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Document Markdown Content & Templates
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Paste markdown tables, numbered lists, or bold bullet points. Instant live preview below.
                  </p>
                </div>
              </div>

              <Tabs defaultValue="quotation_general" className="w-full">
                <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full h-auto p-1">
                  <TabsTrigger value="quotation_general" className="text-xs py-1.5">Quotation General Info</TabsTrigger>
                  <TabsTrigger value="quotation_tech" className="text-xs py-1.5">Technical Specs</TabsTrigger>
                  <TabsTrigger value="quotation_terms" className="text-xs py-1.5">Quotation Terms</TabsTrigger>
                  <TabsTrigger value="invoice_terms" className="text-xs py-1.5">Invoice Terms</TabsTrigger>
                  <TabsTrigger value="closing" className="text-xs py-1.5">Closing Note</TabsTrigger>
                </TabsList>

                {/* 1. Quotation General Info */}
                <TabsContent value="quotation_general" className="mt-4 space-y-3">
                  <div className="grid gap-4 lg:grid-cols-2 items-start">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Markdown Editor</Label>
                      <Textarea
                        rows={10}
                        value={form.quotationGeneralInfoMarkdown ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setForm({ ...form, quotationGeneralInfoMarkdown: e.target.value })}
                        placeholder="| General Information | Details |&#10;|---|---|&#10;| Configuration | Cabin 40’L × 10’W × 8.5’H |&#10;| Transportation | **INCLUDED.** |&#10;| Wiring | Concealed wiring |"
                        className="font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Supports markdown table syntax (| Label | Value |). Left column renders with bold emphasis in PDF.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" /> Live Vector Preview
                      </Label>
                      <div className="min-h-[220px] rounded-xl border border-border/70 bg-background/80 p-3 overflow-y-auto max-h-[260px]">
                        <MarkdownRenderer content={form.quotationGeneralInfoMarkdown || ""} />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 2. Technical Specifications */}
                <TabsContent value="quotation_tech" className="mt-4 space-y-3">
                  <div className="grid gap-4 lg:grid-cols-2 items-start">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Markdown Editor</Label>
                      <Textarea
                        rows={10}
                        value={form.quotationTechnicalSpecsMarkdown ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setForm({ ...form, quotationTechnicalSpecsMarkdown: e.target.value })}
                        placeholder="## Structural Specifications&#10;| Item | Specification |&#10;|---|---|&#10;| Base Frame | 100 x 50 mm C-Channel |&#10;| Wall Panels | 50 mm Sandwich PUF Panel |&#10;&#10;## Electrical Work&#10;- Heavy duty conduits&#10;- Modular switches"
                        className="font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Supports headings (##), tables, and bullet points.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" /> Live Vector Preview
                      </Label>
                      <div className="min-h-[220px] rounded-xl border border-border/70 bg-background/80 p-3 overflow-y-auto max-h-[260px]">
                        <MarkdownRenderer content={form.quotationTechnicalSpecsMarkdown || ""} />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 3. Quotation Terms */}
                <TabsContent value="quotation_terms" className="mt-4 space-y-3">
                  <div className="grid gap-4 lg:grid-cols-2 items-start">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Markdown Editor</Label>
                      <Textarea
                        rows={10}
                        value={form.quotationTermsMarkdown ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setForm({ ...form, quotationTermsMarkdown: e.target.value })}
                        placeholder="1. **GST:** GST @ **18%** extra or included as specified.&#10;2. **Delivery:** Within **3 weeks** from receipt of PO and advance.&#10;3. **Payment Terms:** **50% advance**, **30% on inspection**, and **20% before dispatch**.&#10;4. **Quotation Validity:** **15 days** from quote date."
                        className="font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Numbered lists render with clean hanging indents. Use **bold** for key business terms.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" /> Live Vector Preview
                      </Label>
                      <div className="min-h-[220px] rounded-xl border border-border/70 bg-background/80 p-3 overflow-y-auto max-h-[260px]">
                        <MarkdownRenderer content={form.quotationTermsMarkdown || ""} />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 4. Invoice Terms */}
                <TabsContent value="invoice_terms" className="mt-4 space-y-3">
                  <div className="grid gap-4 lg:grid-cols-2 items-start">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Markdown Editor</Label>
                      <Textarea
                        rows={10}
                        value={form.invoiceTermsMarkdown ?? (form.terms || "")}
                        disabled={!canEdit}
                        onChange={(e) => {
                          setForm({
                            ...form,
                            invoiceTermsMarkdown: e.target.value,
                            terms: e.target.value,
                          });
                        }}
                        placeholder="1. Goods once sold will not be taken back.&#10;2. Interest @ **18% p.a.** will be charged on delayed payments after **15 days**.&#10;3. All disputes subject to local jurisdiction."
                        className="font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Invoices print Terms & Conditions above Settlement Details.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <Eye className="h-3.5 w-3.5" /> Live Vector Preview
                      </Label>
                      <div className="min-h-[220px] rounded-xl border border-border/70 bg-background/80 p-3 overflow-y-auto max-h-[260px]">
                        <MarkdownRenderer content={form.invoiceTermsMarkdown || form.terms || ""} />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 5. Closing Note */}
                <TabsContent value="closing" className="mt-4 space-y-3">
                  <div className="grid gap-4 lg:grid-cols-2 items-start">
                    <div className="space-y-2">
                      <Field label="Quotation Closing Message">
                        <Input
                          value={form.quotationClosingMessage ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => setForm({ ...form, quotationClosingMessage: e.target.value })}
                          placeholder="Thank you for your business. We look forward to working with you."
                        />
                      </Field>
                      <p className="text-[10px] text-muted-foreground">
                        Printed on the final page of quotations directly above the Authorized Signatory block.
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4 text-xs italic text-muted-foreground">
                      "{form.quotationClosingMessage || "Thank you for your business. We look forward to working with you."}"
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>

        {/* Banking & Settlement Information */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Banking & Settlement Information</CardTitle>
            <CardDescription className="text-xs">
              Configured bank account details rendered on invoices and quotations in a clean 2-column settlement table
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Account Holder Name *">
              <Input
                value={form.accountHolderName ?? form.bankAccountHolderName ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })}
                placeholder="e.g. Registered Business / Account Holder Name"
              />
            </Field>
            <Field label="Account Number *">
              <Input
                value={form.bankAccountNo ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
                placeholder="e.g. 40057061196"
              />
            </Field>
            <Field label="Bank Name *">
              <Input
                value={form.bankName ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="e.g. State Bank of India"
              />
            </Field>
            <Field label="IFSC Code *">
              <Input
                value={form.bankIfsc ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })}
                placeholder="e.g. SBIN0017782"
              />
            </Field>
            <Field label="Branch Name (Optional)">
              <Input
                value={form.bankBranch ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankBranch: e.target.value })}
                placeholder="e.g. Industrial Area Branch"
              />
            </Field>
            <Field label="Account Type (Optional)">
              <Input
                value={form.bankAccountType ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankAccountType: e.target.value })}
                placeholder="e.g. Current Account"
              />
            </Field>
            <Field label="UPI ID / VPA (Optional)">
              <Input
                value={form.upiId ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                placeholder="e.g. company@sbi"
              />
            </Field>
            <Field label="SWIFT Code (Optional)">
              <Input
                value={form.bankSwiftCode ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankSwiftCode: e.target.value.toUpperCase() })}
                placeholder="e.g. SBININBB123"
              />
            </Field>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
