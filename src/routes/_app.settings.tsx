import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ImagePlus, Save, ShieldAlert, Building2 } from "lucide-react";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb } from "@/config/firebase";
import { ref, update } from "firebase/database";
import { cacheEntity, getCachedEntity } from "@/modules/sync/dexieCache";
import type { Company } from "@/modules/company/types";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Company Settings — BMS NEXT" }] }),
  component: SettingsPage,
});

export function SettingsPage() {
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
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image file is too large. Please select an image under 2MB.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        setForm((prev) => ({ ...prev, [key]: reader.result as string }));
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
    const updatedData: Partial<Company> = {
      ...form,
      name: form.name.trim(),
      legalName: form.legalName?.trim() || form.name.trim(),
      tradingName: form.tradingName?.trim(),
      address: form.address?.trim() || "",
      city: form.city?.trim() || "",
      state: form.state?.trim() || "",
      pincode: form.pincode?.trim() || "",
      country: form.country || "India",
      phone: form.phone?.trim() || "",
      altPhone: form.altPhone?.trim(),
      email: form.email?.trim(),
      website: form.website?.trim(),
      gstin: form.gstin?.trim().toUpperCase(),
      pan: form.pan?.trim().toUpperCase(),
      cin: form.cin?.trim().toUpperCase(),
      stateCode: form.stateCode?.trim(),
      bankName: form.bankName?.trim(),
      bankBranch: form.bankBranch?.trim(),
      bankAccountNo: form.bankAccountNo?.trim(),
      bankIfsc: form.bankIfsc?.trim().toUpperCase(),
      upiId: form.upiId?.trim(),
      authorizedSignatory: form.authorizedSignatory?.trim(),
      terms: form.terms?.trim(),
      invoicePrefix: form.invoicePrefix?.trim() || "INV",
      quotationPrefix: form.quotationPrefix?.trim() || "QT",
      purchasePrefix: form.purchasePrefix?.trim() || "PO",
      receiptPrefix: form.receiptPrefix?.trim() || "REC",
      paymentPrefix: form.paymentPrefix?.trim() || "PAY",
      updatedAt: Date.now(),
    };

    try {
      // 1. Save to Firebase RTDB if available
      if (firebaseDb) {
        const compRef = ref(firebaseDb, `companies/${activeCompany.id}`);
        await update(compRef, updatedData);
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
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm lg:col-span-2">
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

        {/* Branding & Signatures */}
        <div className="space-y-6">
          <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Branding</CardTitle>
              <CardDescription className="text-xs">
                Your legal identity for documents. If no logo is uploaded, a professional typographic header is rendered.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs font-medium">Company Logo</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  {form.logoUrl ? (
                    <img
                      src={form.logoUrl}
                      alt="Company Logo"
                      className="h-16 w-16 rounded-xl border border-border/60 object-contain bg-white p-1"
                    />
                  ) : (
                    <div className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-border/80 text-xs text-muted-foreground">
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
                        <ImagePlus className="h-3.5 w-3.5" /> Upload Logo
                      </Button>
                      {form.logoUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-destructive hover:text-destructive"
                          onClick={() => setForm({ ...form, logoUrl: undefined })}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Authorized Signature</Label>
                <div className="mt-1.5 flex items-center gap-3">
                  {form.signatureUrl ? (
                    <img
                      src={form.signatureUrl}
                      alt="Signature"
                      className="h-16 w-24 rounded-xl border border-border/60 object-contain bg-white p-1"
                    />
                  ) : (
                    <div className="grid h-16 w-24 place-items-center rounded-xl border border-dashed border-border/80 text-xs text-muted-foreground">
                      None
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
                        <ImagePlus className="h-3.5 w-3.5" /> Upload Signature
                      </Button>
                      {form.signatureUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-destructive hover:text-destructive"
                          onClick={() => setForm({ ...form, signatureUrl: undefined })}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Field label="Authorized Signatory Name">
                <Input
                  value={form.authorizedSignatory ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, authorizedSignatory: e.target.value })}
                  placeholder="Director / Partner"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Document Prefixes */}
          <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
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

        {/* Banking & UPI */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Banking & Settlement Information</CardTitle>
            <CardDescription className="text-xs">
              Printed on customer invoices and quotations for direct payment settlement
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank Name">
              <Input
                value={form.bankName ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                placeholder="HDFC Bank"
              />
            </Field>
            <Field label="Branch Name">
              <Input
                value={form.bankBranch ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankBranch: e.target.value })}
                placeholder="MG Road Branch"
              />
            </Field>
            <Field label="Account Number">
              <Input
                value={form.bankAccountNo ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
                placeholder="50200012345678"
              />
            </Field>
            <Field label="IFSC Code">
              <Input
                value={form.bankIfsc ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, bankIfsc: e.target.value })}
                placeholder="HDFC0001234"
              />
            </Field>
            <Field label="UPI ID / VPA">
              <Input
                value={form.upiId ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                placeholder="company@hdfcbank"
              />
            </Field>
          </CardContent>
        </Card>

        {/* Terms */}
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Default Terms & Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Field label="Standard Invoice Terms">
              <Textarea
                rows={5}
                value={form.terms ?? ""}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, terms: e.target.value })}
                placeholder="1. Goods once sold will not be taken back.&#10;2. Payment due within 15 days of invoice date."
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
