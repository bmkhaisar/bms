import React, { useState } from "react";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Crown,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  MapPin,
  Phone,
  Mail,
  FileText,
  ShieldAlert,
  Settings,
  Landmark,
  PenTool,
  Hash,
} from "lucide-react";
import { createBranch, updateBranch, setMainBranch, deactivateBranch } from "@/functions/branchFn";
import type { Branch } from "@/modules/company/types";

export function BranchManagementSection() {
  const { user } = useAuth();
  const { activeCompany, branches, isOwner } = useActiveCompany();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State for New Branch
  const [form, setForm] = useState({
    name: "",
    code: "",
    addressLine1: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    phone: "",
    email: "",
    gstRegistrationId: "",
    isMainBranch: false,
    useOrgBankDetails: true,
    useOrgSignatory: true,
    invoicePrefix: "",
    quotationPrefix: "",
  });

  // Settings State for Existing Branch (PRD §§ 13-19)
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [settingsForm, setSettingsForm] = useState({
    branchDisplayName: "",
    useCompanyContactDefault: true,
    address: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    phone: "",
    email: "",
    gstin: "",
    // Bank Details (PRD § 17)
    useCompanyBankDefault: true,
    bankName: "",
    accountHolderName: "",
    bankAccountNo: "",
    bankIfsc: "",
    bankBranch: "",
    bankAccountType: "Current",
    bankSwiftCode: "",
    upiId: "",
    // Signatory (PRD § 14)
    useCompanySignatoryDefault: true,
    authorizedSignatory: "",
    designation: "",
    // General Info & Tech Specs & Terms (PRD § 18)
    useCompanyGeneralInfoDefault: true,
    quotationGeneralInfoMarkdown: "",
    useCompanyTechSpecsDefault: true,
    quotationTechnicalSpecsMarkdown: "",
    useCompanyTermsDefault: true,
    quotationTermsMarkdown: "",
    invoiceTermsMarkdown: "",
    // Document Numbering (PRD § 20)
    invoicePrefix: "",
    quotationPrefix: "",
    purchasePrefix: "",
    receiptPrefix: "",
    creditNotePrefix: "",
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleCreateBranch = async () => {
    if (!activeCompany?.id) {
      toast.error("No active company selected");
      return;
    }
    if (!isOwner) {
      toast.error("Only Organization Owner can create branches (PRD § 2)");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Branch name is required");
      return;
    }
    if (!form.code.trim()) {
      toast.error("Branch code is required (e.g. HOS, BLR)");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createBranch({
        companyId: activeCompany.id,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        address: form.addressLine1.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        country: form.country.trim() || "India",
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        gstin: form.gstRegistrationId.trim() || undefined,
        isMainBranch: form.isMainBranch,
        callerUid: user?.uid || (user as any)?.id || "",
        quotationPrefix: form.quotationPrefix.trim() || undefined,
        invoicePrefix: form.invoicePrefix.trim() || undefined,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to create branch");
        return;
      }

      toast.success(`Branch '${form.name}' created successfully!`);
      setIsCreateOpen(false);
      setForm({
        name: "",
        code: "",
        addressLine1: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
        phone: "",
        email: "",
        gstRegistrationId: "",
        isMainBranch: false,
        useOrgBankDetails: true,
        useOrgSignatory: true,
        invoicePrefix: "",
        quotationPrefix: "",
      });
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenSettings = (b: Branch) => {
    setSelectedBranch(b);
    setSettingsForm({
      branchDisplayName: b.branchDisplayName || "",
      useCompanyContactDefault: b.useCompanyContactDefault ?? true,
      address: b.address || "",
      city: b.city || "",
      state: b.state || "",
      pincode: b.pincode || "",
      country: b.country || "India",
      phone: b.phone || "",
      email: b.email || "",
      gstin: b.gstin || b.gstRegistrationId || "",
      useCompanyBankDefault: b.useCompanyBankDefault ?? true,
      bankName: b.bankName || "",
      accountHolderName: b.accountHolderName || "",
      bankAccountNo: b.bankAccountNo || "",
      bankIfsc: b.bankIfsc || "",
      bankBranch: b.bankBranch || "",
      bankAccountType: b.bankAccountType || "Current",
      bankSwiftCode: b.bankSwiftCode || "",
      upiId: b.upiId || "",
      useCompanySignatoryDefault: b.useCompanySignatoryDefault ?? true,
      authorizedSignatory: b.authorizedSignatory || "",
      designation: b.designation || "",
      useCompanyGeneralInfoDefault: b.useCompanyGeneralInfoDefault ?? true,
      quotationGeneralInfoMarkdown: b.quotationGeneralInfoMarkdown || "",
      useCompanyTechSpecsDefault: b.useCompanyTechSpecsDefault ?? true,
      quotationTechnicalSpecsMarkdown: b.quotationTechnicalSpecsMarkdown || "",
      useCompanyTermsDefault: b.useCompanyTermsDefault ?? true,
      quotationTermsMarkdown: b.quotationTermsMarkdown || "",
      invoiceTermsMarkdown: b.invoiceTermsMarkdown || "",
      invoicePrefix: b.invoicePrefix || "",
      quotationPrefix: b.quotationPrefix || "",
      purchasePrefix: b.purchasePrefix || "",
      receiptPrefix: b.receiptPrefix || "",
      creditNotePrefix: b.creditNotePrefix || "",
    });
  };

  const handleSaveSettings = async () => {
    if (!activeCompany?.id || !selectedBranch) return;
    setIsSavingSettings(true);
    try {
      const res = await updateBranch({
        companyId: activeCompany.id,
        branchId: selectedBranch.id,
        callerUid: user?.uid || (user as any)?.id || "",
        branchDisplayName: settingsForm.branchDisplayName.trim() || undefined,
        useCompanyContactDefault: settingsForm.useCompanyContactDefault,
        address: settingsForm.address.trim() || undefined,
        city: settingsForm.city.trim() || undefined,
        state: settingsForm.state.trim() || undefined,
        pincode: settingsForm.pincode.trim() || undefined,
        country: settingsForm.country.trim() || "India",
        phone: settingsForm.phone.trim() || undefined,
        email: settingsForm.email.trim() || undefined,
        gstin: settingsForm.gstin.trim()?.toUpperCase() || undefined,
        useCompanyBankDefault: settingsForm.useCompanyBankDefault,
        bankName: settingsForm.bankName.trim() || undefined,
        accountHolderName: settingsForm.accountHolderName.trim() || undefined,
        bankAccountNo: settingsForm.bankAccountNo.trim() || undefined,
        bankIfsc: settingsForm.bankIfsc.trim()?.toUpperCase() || undefined,
        bankBranch: settingsForm.bankBranch.trim() || undefined,
        bankAccountType: settingsForm.bankAccountType.trim() || undefined,
        bankSwiftCode: settingsForm.bankSwiftCode.trim() || undefined,
        upiId: settingsForm.upiId.trim() || undefined,
        useCompanySignatoryDefault: settingsForm.useCompanySignatoryDefault,
        authorizedSignatory: settingsForm.authorizedSignatory.trim() || undefined,
        designation: settingsForm.designation.trim() || undefined,
        useCompanyGeneralInfoDefault: settingsForm.useCompanyGeneralInfoDefault,
        quotationGeneralInfoMarkdown: settingsForm.quotationGeneralInfoMarkdown || undefined,
        useCompanyTechSpecsDefault: settingsForm.useCompanyTechSpecsDefault,
        quotationTechnicalSpecsMarkdown: settingsForm.quotationTechnicalSpecsMarkdown || undefined,
        useCompanyTermsDefault: settingsForm.useCompanyTermsDefault,
        quotationTermsMarkdown: settingsForm.quotationTermsMarkdown || undefined,
        invoiceTermsMarkdown: settingsForm.invoiceTermsMarkdown || undefined,
        invoicePrefix: settingsForm.invoicePrefix.trim() || undefined,
        quotationPrefix: settingsForm.quotationPrefix.trim() || undefined,
        purchasePrefix: settingsForm.purchasePrefix.trim() || undefined,
        receiptPrefix: settingsForm.receiptPrefix.trim() || undefined,
        creditNotePrefix: settingsForm.creditNotePrefix.trim() || undefined,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to update branch settings");
        return;
      }

      toast.success(`Settings for branch '${selectedBranch.name}' updated successfully!`);
      setSelectedBranch(null);
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSetMainBranch = async (b: Branch) => {
    if (!activeCompany?.id || !isOwner) {
      toast.error("Only Organization Owner can change Main Branch (PRD § 4)");
      return;
    }
    try {
      const res = await setMainBranch(activeCompany.id, b.id, user?.uid || (user as any)?.id);
      if (!res.success) {
        toast.error(res.error || "Failed to set main branch");
        return;
      }
      toast.success(`'${b.name}' is now the Main Branch.`);
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    }
  };

  const handleDeactivate = async (b: Branch) => {
    if (!activeCompany?.id || !isOwner) {
      toast.error("Only Organization Owner can deactivate branches");
      return;
    }
    if (b.isMainBranch) {
      toast.error("Cannot deactivate the Main Branch. Promote another branch to Main first.");
      return;
    }
    try {
      const res = await deactivateBranch(activeCompany.id, b.id, user?.uid || (user as any)?.id);
      if (!res.success) {
        toast.error(res.error || "Failed to deactivate branch");
        return;
      }
      toast.success(`Branch '${b.name}' deactivated.`);
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Branch & Location Management
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure Head Office and operating branches. Master products and parties are shared centrally; operational transactions are branch-scoped.
          </p>
        </div>

        {isOwner ? (
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs text-xs h-9"
          >
            <Plus className="h-4 w-4" />
            New Branch
          </Button>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            Branch creation reserved for Owner
          </Badge>
        )}
      </div>

      {/* Branches Table */}
      <Card className="border-border/70 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Branch Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role / Tags</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>GSTIN / Tax ID</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-1.5">
                      <Building2 className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium">No branches configured</p>
                      <p className="text-xs text-muted-foreground">
                        {isOwner
                          ? "Create your Main Branch or operating locations."
                          : "Contact your organization owner to configure branches."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                branches.map((b) => (
                  <TableRow key={b.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-foreground whitespace-nowrap">
                      <div>
                        <span>{b.name}</span>
                        {b.branchDisplayName && (
                          <div className="text-[11px] font-normal text-muted-foreground truncate max-w-[200px]">
                            Display: {b.branchDisplayName}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                      {b.code}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={b.status === "active" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {b.isMainBranch && (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px] gap-1 py-0">
                            <Crown className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            Main Branch / HO
                          </Badge>
                        )}
                        {b.isBillingDefault && !b.isMainBranch && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            Default Billing
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground/70" />
                        <span>{[b.city, b.state].filter(Boolean).join(", ") || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {b.gstin || b.gstRegistrationId || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {b.phone || b.email || "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {isOwner ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 px-2 gap-1"
                            onClick={() => handleOpenSettings(b)}
                          >
                            <Settings className="h-3 w-3" />
                            Settings
                          </Button>
                          {!b.isMainBranch && b.status === "active" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 px-2"
                              onClick={() => handleSetMainBranch(b)}
                            >
                              Make Main
                            </Button>
                          )}
                          {!b.isMainBranch && b.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                              onClick={() => handleDeactivate(b)}
                            >
                              Deactivate
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Legacy Branch Migration Audit Card (Hardening Task 1) */}
      {isOwner && (
        <Card className="border-border/60 bg-muted/20">
          <CardHeader className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Legacy Branch Data Migration & Audit
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Audit all historical operational records (invoices, quotations, receipts, payments, purchases, vouchers, returns). Records without branch are migrated ONCE to the Main Branch.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs gap-1.5"
                disabled={isSubmitting}
                onClick={async () => {
                  if (!activeCompany?.id) return;
                  setIsSubmitting(true);
                  try {
                    const token = await user?.getIdToken();
                    if (!token) throw new Error("Authentication required");
                    const { migrateLegacyBranchServerFn } = await import("@/functions/migrateLegacyBranchFn");
                    const res = await migrateLegacyBranchServerFn({
                      data: { idToken: token, companyId: activeCompany.id, force: true },
                    });
                    if (res.success && res.summary) {
                      toast.success(
                        res.summary.alreadyMigrated
                          ? `All operational records are already migrated to Main Branch (${res.summary.mainBranchCode})`
                          : `Successfully migrated ${res.summary.totalRecordsMigrated} operational records to Main Branch (${res.summary.mainBranchCode})`
                      );
                    } else {
                      toast.error(res.error || "Migration failed");
                    }
                  } catch (err: any) {
                    toast.error(err.message || "Failed to execute migration");
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              >
                {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                Run Migration Audit
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Create Branch Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Create New Branch
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add an operating branch or head office location. Transactions and inventories are isolated to this branch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Branch Name *</Label>
                <Input
                  placeholder="e.g. Hoskote Works / Bangalore Office"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Branch Code * (Unique prefix)</Label>
                <Input
                  placeholder="e.g. HOS, BLR, MYS"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className="h-9 text-xs font-mono uppercase"
                  maxLength={6}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Street Address</Label>
              <Input
                placeholder="Plot / Industrial Area / Street address"
                value={form.addressLine1}
                onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">City</Label>
                <Input
                  placeholder="City"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">State</Label>
                <Input
                  placeholder="State"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pincode</Label>
                <Input
                  placeholder="Pincode"
                  value={form.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Country</Label>
                <Input
                  placeholder="India"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input
                  placeholder="+91..."
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email</Label>
                <Input
                  placeholder="branch@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">GSTIN (Optional Override)</Label>
                <Input
                  placeholder="29AAAAA0000A1Z5"
                  value={form.gstRegistrationId}
                  onChange={(e) => setForm({ ...form, gstRegistrationId: e.target.value.toUpperCase() })}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            {/* Document Numbering Prefixes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/70">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Invoice Prefix Override (Optional)</Label>
                <Input
                  placeholder="e.g. INV/HOS"
                  value={form.invoicePrefix}
                  onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Quotation Prefix Override (Optional)</Label>
                <Input
                  placeholder="e.g. QT/HOS"
                  value={form.quotationPrefix}
                  onChange={(e) => setForm({ ...form, quotationPrefix: e.target.value })}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold cursor-pointer">Set as Main Branch / Head Office</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Only 1 Main Branch per organization. Provides company contact fallback and default billing location.
                  </p>
                </div>
                <Switch
                  checked={form.isMainBranch}
                  onCheckedChange={(checked) => setForm({ ...form, isMainBranch: checked })}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsCreateOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateBranch}
              disabled={isSubmitting || !form.name.trim() || !form.code.trim()}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branch Settings & Inheritance Configuration Dialog (PRD §§ 13-20) */}
      <Dialog open={Boolean(selectedBranch)} onOpenChange={(open) => !open && setSelectedBranch(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Branch Configuration & Inheritance: {selectedBranch?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure branch overrides. Sections set to "Use Company Default" inherit settings from the Organization automatically.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="identity" className="w-full">
            <TabsList className="grid grid-cols-5 h-9 text-xs">
              <TabsTrigger value="identity" className="text-xs">Identity</TabsTrigger>
              <TabsTrigger value="bank" className="text-xs">Bank</TabsTrigger>
              <TabsTrigger value="signatory" className="text-xs">Signatory</TabsTrigger>
              <TabsTrigger value="content" className="text-xs">Terms & Info</TabsTrigger>
              <TabsTrigger value="numbering" className="text-xs">Prefixes</TabsTrigger>
            </TabsList>

            {/* Tab 1: Identity & Contact (PRD §§ 13, 19) */}
            <TabsContent value="identity" className="space-y-4 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Branch Document Display Name (Optional)</Label>
                <Input
                  placeholder="e.g. KH Portable Cabins — Bangalore Works"
                  value={settingsForm.branchDisplayName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, branchDisplayName: e.target.value })}
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Displays prominently on quotes, invoices, and credit notes generated from this branch while retaining legal entity details.
                </p>
              </div>

              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Use Company Address & Contact Default</Label>
                    <p className="text-[11px] text-muted-foreground">
                      When enabled, documents display organization address. Toggle OFF to use this branch's specific address.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanyContactDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanyContactDefault: checked })}
                  />
                </div>

                {!settingsForm.useCompanyContactDefault && (
                  <div className="space-y-3 pt-3 border-t border-border/60">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Branch Street Address</Label>
                      <Input
                        placeholder="Street / Industrial Area"
                        value={settingsForm.address}
                        onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Input
                        placeholder="City"
                        value={settingsForm.city}
                        onChange={(e) => setSettingsForm({ ...settingsForm, city: e.target.value })}
                        className="h-9 text-xs"
                      />
                      <Input
                        placeholder="State"
                        value={settingsForm.state}
                        onChange={(e) => setSettingsForm({ ...settingsForm, state: e.target.value })}
                        className="h-9 text-xs"
                      />
                      <Input
                        placeholder="Pincode"
                        value={settingsForm.pincode}
                        onChange={(e) => setSettingsForm({ ...settingsForm, pincode: e.target.value })}
                        className="h-9 text-xs"
                      />
                      <Input
                        placeholder="Country"
                        value={settingsForm.country}
                        onChange={(e) => setSettingsForm({ ...settingsForm, country: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Input
                        placeholder="Phone"
                        value={settingsForm.phone}
                        onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                        className="h-9 text-xs"
                      />
                      <Input
                        placeholder="Email"
                        value={settingsForm.email}
                        onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })}
                        className="h-9 text-xs"
                      />
                      <Input
                        placeholder="GSTIN Override"
                        value={settingsForm.gstin}
                        onChange={(e) => setSettingsForm({ ...settingsForm, gstin: e.target.value.toUpperCase() })}
                        className="h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 2: Bank Details (PRD § 17) */}
            <TabsContent value="bank" className="space-y-4 pt-3">
              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <Landmark className="h-4 w-4 text-primary" /> Use Company Bank Default
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      When enabled, documents generated from this branch print the organization default bank account.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanyBankDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanyBankDefault: checked })}
                  />
                </div>

                {!settingsForm.useCompanyBankDefault && (
                  <div className="space-y-3 pt-3 border-t border-border/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Bank Name</Label>
                        <Input
                          placeholder="e.g. HDFC Bank"
                          value={settingsForm.bankName}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankName: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Account Holder Name</Label>
                        <Input
                          placeholder="e.g. KH Portable Cabins Bangalore"
                          value={settingsForm.accountHolderName}
                          onChange={(e) => setSettingsForm({ ...settingsForm, accountHolderName: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Account Number</Label>
                        <Input
                          placeholder="Account Number"
                          value={settingsForm.bankAccountNo}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountNo: e.target.value })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">IFSC Code</Label>
                        <Input
                          placeholder="HDFC0001234"
                          value={settingsForm.bankIfsc}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankIfsc: e.target.value.toUpperCase() })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Branch Location</Label>
                        <Input
                          placeholder="e.g. Whitefield"
                          value={settingsForm.bankBranch}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankBranch: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Account Type</Label>
                        <Input
                          placeholder="Current / Savings"
                          value={settingsForm.bankAccountType}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankAccountType: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">SWIFT Code (Optional)</Label>
                        <Input
                          placeholder="SWIFT"
                          value={settingsForm.bankSwiftCode}
                          onChange={(e) => setSettingsForm({ ...settingsForm, bankSwiftCode: e.target.value })}
                          className="h-9 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">UPI ID (Optional)</Label>
                        <Input
                          placeholder="company@upi"
                          value={settingsForm.upiId}
                          onChange={(e) => setSettingsForm({ ...settingsForm, upiId: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 3: Signatory & Stamp (PRD § 14) */}
            <TabsContent value="signatory" className="space-y-4 pt-3">
              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <PenTool className="h-4 w-4 text-primary" /> Use Company Signatory Default
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      When enabled, documents print the company authorized signatory and seal.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanySignatoryDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanySignatoryDefault: checked })}
                  />
                </div>

                {!settingsForm.useCompanySignatoryDefault && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border/60">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Branch Authorized Signatory Name</Label>
                      <Input
                        placeholder="e.g. Ramesh Kumar"
                        value={settingsForm.authorizedSignatory}
                        onChange={(e) => setSettingsForm({ ...settingsForm, authorizedSignatory: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Signatory Designation</Label>
                      <Input
                        placeholder="e.g. Branch Manager"
                        value={settingsForm.designation}
                        onChange={(e) => setSettingsForm({ ...settingsForm, designation: e.target.value })}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 4: Content & Terms (PRD § 18) */}
            <TabsContent value="content" className="space-y-4 pt-3">
              {/* General Info */}
              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Use Company General Info Default</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Quotation general information section.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanyGeneralInfoDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanyGeneralInfoDefault: checked })}
                  />
                </div>
                {!settingsForm.useCompanyGeneralInfoDefault && (
                  <Textarea
                    placeholder="Branch-specific quotation general information (Markdown supported)..."
                    value={settingsForm.quotationGeneralInfoMarkdown}
                    onChange={(e) => setSettingsForm({ ...settingsForm, quotationGeneralInfoMarkdown: e.target.value })}
                    className="text-xs min-h-[80px]"
                  />
                )}
              </div>

              {/* Tech Specs */}
              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Use Company Tech Specs Default</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Quotation technical specifications section.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanyTechSpecsDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanyTechSpecsDefault: checked })}
                  />
                </div>
                {!settingsForm.useCompanyTechSpecsDefault && (
                  <Textarea
                    placeholder="Branch-specific technical specifications (Markdown supported)..."
                    value={settingsForm.quotationTechnicalSpecsMarkdown}
                    onChange={(e) => setSettingsForm({ ...settingsForm, quotationTechnicalSpecsMarkdown: e.target.value })}
                    className="text-xs min-h-[80px]"
                  />
                )}
              </div>

              {/* Terms */}
              <div className="rounded-lg border border-border/70 p-3 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs font-semibold">Use Company Terms Default</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Quotation & invoice legal terms and payment conditions.
                    </p>
                  </div>
                  <Switch
                    checked={settingsForm.useCompanyTermsDefault}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, useCompanyTermsDefault: checked })}
                  />
                </div>
                {!settingsForm.useCompanyTermsDefault && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium">Quotation Terms</Label>
                      <Textarea
                        placeholder="Branch quotation terms..."
                        value={settingsForm.quotationTermsMarkdown}
                        onChange={(e) => setSettingsForm({ ...settingsForm, quotationTermsMarkdown: e.target.value })}
                        className="text-xs min-h-[60px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium">Invoice Terms</Label>
                      <Textarea
                        placeholder="Branch invoice terms..."
                        value={settingsForm.invoiceTermsMarkdown}
                        onChange={(e) => setSettingsForm({ ...settingsForm, invoiceTermsMarkdown: e.target.value })}
                        className="text-xs min-h-[60px]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 5: Document Numbering Prefixes (PRD § 20) */}
            <TabsContent value="numbering" className="space-y-4 pt-3">
              <div className="space-y-1 text-xs text-muted-foreground mb-2">
                Configure custom document prefixes for this branch (e.g. QT/BLR, INV/BLR). Numbering counters remain atomic and FY-scoped.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Invoice Prefix</Label>
                  <Input
                    placeholder="e.g. INV/BLR"
                    value={settingsForm.invoicePrefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, invoicePrefix: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Quotation Prefix</Label>
                  <Input
                    placeholder="e.g. QT/BLR"
                    value={settingsForm.quotationPrefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, quotationPrefix: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Purchase Prefix</Label>
                  <Input
                    placeholder="e.g. PO/BLR"
                    value={settingsForm.purchasePrefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, purchasePrefix: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Receipt Prefix</Label>
                  <Input
                    placeholder="e.g. REC/BLR"
                    value={settingsForm.receiptPrefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, receiptPrefix: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Credit Note Prefix</Label>
                  <Input
                    placeholder="e.g. CN/BLR"
                    value={settingsForm.creditNotePrefix}
                    onChange={(e) => setSettingsForm({ ...settingsForm, creditNotePrefix: e.target.value })}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="outline" onClick={() => setSelectedBranch(null)} disabled={isSavingSettings}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isSavingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Branch Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
