import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Plus,
  Search,
  Loader2,
  Users,
  RefreshCw,
  Sparkles,
  RotateCcw,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  UserPlus,
  MoreHorizontal,
  Calendar,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCompaniesPlatformAdminFn,
  createCompanyPlatformAdminFn,
  resetDemoCompanyFn,
  initializeDemoDataFn,
  extendDemoExpirationFn,
  openOrganizationForAdminFn,
} from "@/functions/platformAdminFns";
import type { PlatformCompanySummary } from "@/server/platform-admin/companyService";

interface CompaniesViewProps {
  idToken: string;
  onCompanyCreated?: () => void;
  onNavigateTab?: (tab: string, context?: { companyId?: string }) => void;
}

export function CompaniesView({ idToken, onCompanyCreated, onNavigateTab }: CompaniesViewProps) {
  const { user } = useAuth();
  const { switchCompany } = useActiveCompany();
  const nav = useNavigate();

  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openingCompanyId, setOpeningCompanyId] = useState<string | null>(null);

  // Post-Creation modal state
  const [createdCompany, setCreatedCompany] = useState<PlatformCompanySummary | null>(null);

  // Demo Reset modal state
  const [resetModalCompany, setResetModalCompany] = useState<PlatformCompanySummary | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  // Init Demo Data modal state
  const [initDemoCompany, setInitDemoCompany] = useState<PlatformCompanySummary | null>(null);
  const [initializingDemo, setInitializingDemo] = useState(false);

  // Extend Demo Expiry modal state
  const [extendCompany, setExtendCompany] = useState<PlatformCompanySummary | null>(null);
  const [extendExpiryDate, setExtendExpiryDate] = useState("");
  const [extending, setExtending] = useState(false);

  // Form state for Create Organization
  const [formData, setFormData] = useState({
    name: "",
    legalName: "",
    organizationType: "NORMAL" as "NORMAL" | "DEMO",
    hasExpiry: true,
    expiryDays: 30,
    customExpiryDate: "",
    demoDescription: "",
    internalNote: "",
    gstin: "",
    pan: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    currency: "INR",
    currencySymbol: "₹",
    timezone: "Asia/Kolkata",
    initialOwner: "",
    fyName: "2026-2027",
    fyStartDate: "2026-04-01",
    fyEndDate: "2027-03-31",
  });

  const getAuthToken = useCallback(
    async (force = false) => {
      if (user) {
        try {
          return await user.getIdToken(force);
        } catch {
          return idToken;
        }
      }
      return idToken;
    },
    [user, idToken]
  );

  const loadCompanies = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const token = await getAuthToken(forceRefresh);
        if (!token) {
          setLoading(false);
          return;
        }
        const res = await listCompaniesPlatformAdminFn({ data: { idToken: token } });
        if (res.success && res.companies) {
          setCompanies(res.companies);
        } else {
          toast.error(res.error || "Failed to load companies");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Network error";
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [getAuthToken]
  );

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Company name is required.");
      return;
    }

    const fyStart = new Date(formData.fyStartDate).getTime();
    const fyEnd = new Date(formData.fyEndDate).getTime();

    if (isNaN(fyStart) || isNaN(fyEnd) || fyStart >= fyEnd) {
      toast.error("Valid financial year start and end dates are required.");
      return;
    }

    let demoExpiresAt: number | undefined;
    if (formData.organizationType === "DEMO" && formData.hasExpiry) {
      if (formData.customExpiryDate) {
        const parsed = new Date(formData.customExpiryDate).getTime();
        if (!isNaN(parsed)) demoExpiresAt = parsed;
      } else {
        demoExpiresAt = Date.now() + formData.expiryDays * 24 * 60 * 60 * 1000;
      }
    }

    setSubmitting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) {
        toast.error("Authentication token required.");
        return;
      }
      const res = await createCompanyPlatformAdminFn({
        data: {
          idToken: token,
          name: formData.name.trim(),
          legalName: formData.legalName.trim() || formData.name.trim(),
          organizationType: formData.organizationType,
          isDemo: formData.organizationType === "DEMO",
          demoExpiresAt,
          demoDescription: formData.demoDescription.trim() || undefined,
          internalNote: formData.internalNote.trim() || undefined,
          gstin: formData.gstin.trim(),
          pan: formData.pan.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          address: formData.address.trim(),
          city: formData.city.trim(),
          state: formData.state.trim(),
          pincode: formData.pincode.trim(),
          country: formData.country.trim(),
          currency: formData.currency,
          currencySymbol: formData.currencySymbol,
          timezone: formData.timezone,
          initialOwnerEmail: formData.initialOwner.includes("@") ? formData.initialOwner.trim().toLowerCase() : undefined,
          initialOwnerUid: !formData.initialOwner.includes("@") && formData.initialOwner.trim() ? formData.initialOwner.trim() : undefined,
          fyName: formData.fyName.trim(),
          fyStart,
          fyEnd,
        },
      });

      if (res.success && res.companyId) {
        toast.success(
          formData.organizationType === "DEMO"
            ? "Demo organization created successfully."
            : "Company created successfully."
        );
        setShowCreateModal(false);

        const newCompanySummary: PlatformCompanySummary = {
          id: res.companyId,
          name: formData.name.trim(),
          legalName: formData.legalName.trim() || formData.name.trim(),
          active: true,
          ownerUid: formData.initialOwner || undefined,
          activeUsersCount: formData.initialOwner ? 1 : 0,
          createdAt: Date.now(),
          createdBy: user?.uid || "admin",
          gstin: formData.gstin.trim() || undefined,
          organizationType: formData.organizationType,
          isDemo: formData.organizationType === "DEMO",
          demoExpiresAt,
          demoDescription: formData.demoDescription.trim() || undefined,
        };

        setCreatedCompany(newCompanySummary);

        // Reset form
        setFormData({
          name: "",
          legalName: "",
          organizationType: "NORMAL",
          hasExpiry: true,
          expiryDays: 30,
          customExpiryDate: "",
          demoDescription: "",
          internalNote: "",
          gstin: "",
          pan: "",
          email: "",
          phone: "",
          address: "",
          city: "",
          state: "",
          pincode: "",
          country: "India",
          currency: "INR",
          currencySymbol: "₹",
          timezone: "Asia/Kolkata",
          initialOwner: "",
          fyName: "2026-2027",
          fyStartDate: "2026-04-01",
          fyEndDate: "2027-03-31",
        });

        await loadCompanies(true);
        onCompanyCreated?.();
      } else {
        toast.error(res.error || "Failed to create company.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating company";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenOrganization = async (company: PlatformCompanySummary) => {
    setOpeningCompanyId(company.id);
    try {
      const token = await getAuthToken(true);
      if (!token) return;

      const res = await openOrganizationForAdminFn({
        data: { idToken: token, companyId: company.id },
      });

      if (res.success) {
        toast.success(`Entering ${company.name}...`);
        await switchCompany(company.id);
        nav({ to: "/" });
      } else {
        toast.error(res.error || "Failed to open organization");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error opening organization";
      toast.error(msg);
    } finally {
      setOpeningCompanyId(null);
    }
  };

  const handleResetDemo = async () => {
    if (!resetModalCompany) return;
    if (resetConfirmText.trim() !== resetModalCompany.name.trim()) {
      toast.error("Company name does not match exactly.");
      return;
    }

    setResetting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) return;

      const res = await resetDemoCompanyFn({
        data: {
          idToken: token,
          companyId: resetModalCompany.id,
          confirmName: resetConfirmText.trim(),
        },
      });

      if (res.success) {
        toast.success("Demo organization reset successfully. Operational data has been purged.");
        setResetModalCompany(null);
        setResetConfirmText("");
        await loadCompanies(true);
      } else {
        toast.error(res.error || "Failed to reset demo organization.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error resetting demo organization";
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const handleInitDemoData = async (companyId: string) => {
    setInitializingDemo(true);
    try {
      const token = await getAuthToken(true);
      if (!token) return;

      const res = await initializeDemoDataFn({
        data: { idToken: token, companyId },
      });

      if (res.success) {
        toast.success(res.message || "Realistic demo dataset successfully initialized!");
        setInitDemoCompany(null);
        if (createdCompany && createdCompany.id === companyId) {
          // Close post creation dialog if open
          setCreatedCompany(null);
        }
        await loadCompanies(true);
      } else {
        toast.error(res.error || "Failed to initialize demo data.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error initializing demo data";
      toast.error(msg);
    } finally {
      setInitializingDemo(false);
    }
  };

  const handleExtendExpiry = async () => {
    if (!extendCompany || !extendExpiryDate) return;

    const parsed = new Date(extendExpiryDate).getTime();
    if (isNaN(parsed) || parsed <= Date.now()) {
      toast.error("Please pick a valid future date.");
      return;
    }

    setExtending(true);
    try {
      const token = await getAuthToken(true);
      if (!token) return;

      const res = await extendDemoExpirationFn({
        data: {
          idToken: token,
          companyId: extendCompany.id,
          demoExpiresAt: parsed,
        },
      });

      if (res.success) {
        toast.success("Demo expiration date extended successfully.");
        setExtendCompany(null);
        setExtendExpiryDate("");
        await loadCompanies(true);
      } else {
        toast.error(res.error || "Failed to extend demo expiration.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error extending demo expiration";
      toast.error(msg);
    } finally {
      setExtending(false);
    }
  };

  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.gstin && c.gstin.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Registered Organizations
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Multi-tenant registry across normal production and demo organizations in BMS NEXT.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadCompanies(true)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Organization
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search organizations by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
      </div>

      <Card className="shadow-sm border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold text-foreground">Organization</TableHead>
                <TableHead className="font-semibold text-foreground">Type</TableHead>
                <TableHead className="font-semibold text-foreground">Tenant ID</TableHead>
                <TableHead className="font-semibold text-foreground">GSTIN</TableHead>
                <TableHead className="font-semibold text-foreground">Active Users</TableHead>
                <TableHead className="font-semibold text-foreground">Status</TableHead>
                <TableHead className="font-semibold text-foreground">Created</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading organizations...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    No organizations found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const isDemo = c.isDemo || c.organizationType === "DEMO";
                  const isExpired = isDemo && c.demoExpiresAt && c.demoExpiresAt <= Date.now();

                  return (
                    <TableRow key={c.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium text-foreground">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span>{c.name}</span>
                          </div>
                          {c.legalName && c.legalName !== c.name && (
                            <div className="text-xs text-muted-foreground">{c.legalName}</div>
                          )}
                          {c.demoDescription && (
                            <div className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                              {c.demoDescription}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isDemo ? (
                          <div className="space-y-1">
                            <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300/80 text-[11px] font-semibold gap-1">
                              <Sparkles className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                              DEMO
                            </Badge>
                            {c.demoExpiresAt ? (
                              <div
                                className={`text-[10px] flex items-center gap-1 ${
                                  isExpired
                                    ? "text-rose-600 font-semibold"
                                    : "text-muted-foreground"
                                }`}
                              >
                                <Clock className="h-2.5 w-2.5" />
                                {isExpired
                                  ? "Expired"
                                  : `Exp: ${new Date(c.demoExpiresAt).toLocaleDateString()}`}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[11px] font-normal">
                            Normal
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.gstin || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm text-foreground">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span>{c.activeUsersCount}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isExpired ? (
                          <Badge variant="destructive" className="text-[11px]">
                            Expired
                          </Badge>
                        ) : (
                          <Badge variant={c.active ? "default" : "secondary"} className="text-[11px]">
                            {c.active ? "Active" : "Disabled"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={openingCompanyId === c.id}
                            onClick={() => handleOpenOrganization(c)}
                          >
                            {openingCompanyId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ArrowRight className="h-3 w-3 text-primary" />
                            )}
                            <span>Open</span>
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onClick={() => onNavigateTab?.("access", { companyId: c.id })}
                                className="cursor-pointer gap-2"
                              >
                                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Configure Access</span>
                              </DropdownMenuItem>

                              <DropdownMenuItem
                                onClick={() => onNavigateTab?.("users")}
                                className="cursor-pointer gap-2"
                              >
                                <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Create User</span>
                              </DropdownMenuItem>

                              {isDemo && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setInitDemoCompany(c)}
                                    className="cursor-pointer gap-2 text-indigo-600 dark:text-indigo-400 font-medium"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    <span>Seed Demo Data</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setExtendCompany(c);
                                      const current = c.demoExpiresAt ? new Date(c.demoExpiresAt) : new Date();
                                      const next = new Date(current.getTime() + 14 * 24 * 60 * 60 * 1000);
                                      setExtendExpiryDate(next.toISOString().split("T")[0]);
                                    }}
                                    className="cursor-pointer gap-2"
                                  >
                                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Extend Expiration</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setResetModalCompany(c);
                                      setResetConfirmText("");
                                    }}
                                    className="cursor-pointer gap-2 text-rose-600 dark:text-rose-400 font-medium focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <span>Reset Demo Org</span>
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 1. Create Organization Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateCompany}>
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
              <DialogDescription>
                Provision an isolated tenant company with independent Chart of Accounts, financial year, and document counters.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="c-name">Company Trade Name *</Label>
                <Input
                  id="c-name"
                  placeholder="e.g. Apex Global Traders Pvt Ltd"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              {/* Organization Type Selector */}
              <div className="md:col-span-2 space-y-2 p-3.5 rounded-xl border border-border/80 bg-muted/30">
                <Label className="text-xs font-semibold text-foreground">Organization Type *</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => setFormData({ ...formData, organizationType: "NORMAL" })}
                    className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-2.5 ${
                      formData.organizationType === "NORMAL"
                        ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/30"
                        : "border-border bg-card text-muted-foreground hover:border-border/80"
                    }`}
                  >
                    <Building2 className={`h-4 w-4 mt-0.5 ${formData.organizationType === "NORMAL" ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <div className="text-xs font-semibold text-foreground">Normal Organization</div>
                      <div className="text-[11px] text-muted-foreground">Standard production workspace with complete tenant isolation.</div>
                    </div>
                  </div>

                  <div
                    onClick={() => setFormData({ ...formData, organizationType: "DEMO" })}
                    className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-2.5 ${
                      formData.organizationType === "DEMO"
                        ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/30 text-foreground ring-1 ring-amber-500/30"
                        : "border-border bg-card text-muted-foreground hover:border-border/80"
                    }`}
                  >
                    <Sparkles className={`h-4 w-4 mt-0.5 ${formData.organizationType === "DEMO" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
                    <div>
                      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <span>Demo Organization</span>
                        <Badge className="text-[9px] h-4 px-1 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-none">DEMO</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">Evaluation tenant with safe operational reset and demo dataset capability.</div>
                    </div>
                  </div>
                </div>

                {formData.organizationType === "DEMO" && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="demo-has-expiry" className="text-xs cursor-pointer">
                        Set Demo Expiry Date
                      </Label>
                      <input
                        type="checkbox"
                        id="demo-has-expiry"
                        checked={formData.hasExpiry}
                        onChange={(e) => setFormData({ ...formData, hasExpiry: e.target.checked })}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                      />
                    </div>

                    {formData.hasExpiry && (
                      <div className="flex flex-wrap items-center gap-2">
                        {[7, 14, 30, 60, 90].map((days) => (
                          <Button
                            key={days}
                            type="button"
                            size="sm"
                            variant={formData.expiryDays === days && !formData.customExpiryDate ? "default" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => setFormData({ ...formData, expiryDays: days, customExpiryDate: "" })}
                          >
                            +{days} Days
                          </Button>
                        ))}
                        <div className="flex-1 min-w-[140px]">
                          <Input
                            type="date"
                            className="h-7 text-xs"
                            value={formData.customExpiryDate}
                            onChange={(e) => setFormData({ ...formData, customExpiryDate: e.target.value })}
                            placeholder="Custom date"
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label htmlFor="c-demo-desc" className="text-xs">
                        Demo Description / Prospect Note (Optional)
                      </Label>
                      <Input
                        id="c-demo-desc"
                        placeholder="e.g. Evaluation tenant for Acme Corp prospective deal"
                        className="text-xs"
                        value={formData.demoDescription}
                        onChange={(e) => setFormData({ ...formData, demoDescription: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-legal">Legal Name</Label>
                <Input
                  id="c-legal"
                  placeholder="As registered in official documents"
                  value={formData.legalName}
                  onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-gstin">GSTIN</Label>
                <Input
                  id="c-gstin"
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  value={formData.gstin}
                  onChange={(e) => setFormData({ ...formData, gstin: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-pan">PAN</Label>
                <Input
                  id="c-pan"
                  placeholder="e.g. AAAAA0000A"
                  value={formData.pan}
                  onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-phone">Phone</Label>
                <Input
                  id="c-phone"
                  placeholder="Business contact number"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-email">Business Email</Label>
                <Input
                  id="c-email"
                  type="email"
                  placeholder="accounts@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-city">City</Label>
                <Input
                  id="c-city"
                  placeholder="City"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="c-state">State</Label>
                <Input
                  id="c-state"
                  placeholder="State"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                />
              </div>

              <div className="md:col-span-2 pt-2 border-t border-border/60">
                <h4 className="text-sm font-semibold text-foreground mb-2">Initial Financial Year</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fy-name" className="text-xs">Period Name</Label>
                    <Input
                      id="fy-name"
                      value={formData.fyName}
                      onChange={(e) => setFormData({ ...formData, fyName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fy-start" className="text-xs">Start Date</Label>
                    <Input
                      id="fy-start"
                      type="date"
                      value={formData.fyStartDate}
                      onChange={(e) => setFormData({ ...formData, fyStartDate: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fy-end" className="text-xs">End Date</Label>
                    <Input
                      id="fy-end"
                      type="date"
                      value={formData.fyEndDate}
                      onChange={(e) => setFormData({ ...formData, fyEndDate: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-border/60 space-y-1.5">
                <Label htmlFor="c-owner">Initial Company Owner Email or UID (Optional)</Label>
                <Input
                  id="c-owner"
                  placeholder="e.g. owner@company.com or Firebase UID (leave blank to assign later)"
                  value={formData.initialOwner}
                  onChange={(e) => setFormData({ ...formData, initialOwner: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Platform Admin does not automatically gain operational access unless assigned or explicitly opened.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateModal(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Provisioning...
                  </>
                ) : formData.organizationType === "DEMO" ? (
                  "Create Demo Organization"
                ) : (
                  "Create Organization"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Post-Creation Guidance Modal (PRD Section 3) */}
      <Dialog
        open={Boolean(createdCompany)}
        onOpenChange={(open) => {
          if (!open) setCreatedCompany(null);
        }}
      >
        <DialogContent className="max-w-md">
          {createdCompany && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Organization Provisioned
                </DialogTitle>
                <DialogDescription>
                  <span className="font-semibold text-foreground">{createdCompany.name}</span> has been created with isolated tenant records and Chart of Accounts.
                </DialogDescription>
              </DialogHeader>

              {createdCompany.isDemo && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/40 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Demo Organization Ready:</span> You can seed a realistic demo dataset (customers, products, invoices, and vouchers) right now.
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-1">
                {createdCompany.isDemo && (
                  <Button
                    onClick={() => handleInitDemoData(createdCompany.id)}
                    disabled={initializingDemo}
                    className="w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {initializingDemo ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    <span>Initialize Demo Data (Quotes, Invoices, Vouchers)</span>
                  </Button>
                )}

                <Button
                  variant="outline"
                  onClick={() => {
                    setCreatedCompany(null);
                    onNavigateTab?.("users");
                  }}
                  className="w-full justify-start gap-2"
                >
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  <span>Create User for this Organization</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    const cid = createdCompany.id;
                    setCreatedCompany(null);
                    onNavigateTab?.("access", { companyId: cid });
                  }}
                  className="w-full justify-start gap-2"
                >
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span>Configure User Access & Memberships</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => {
                    const comp = createdCompany;
                    setCreatedCompany(null);
                    handleOpenOrganization(comp);
                  }}
                  className="w-full justify-start gap-2 text-primary hover:text-primary"
                >
                  <ArrowRight className="h-4 w-4" />
                  <span>Open Organization Workspace</span>
                </Button>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreatedCompany(null)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 3. Demo Reset Exact-Name Confirmation Modal (PRD Section 17) */}
      <Dialog
        open={Boolean(resetModalCompany)}
        onOpenChange={(open) => {
          if (!open) {
            setResetModalCompany(null);
            setResetConfirmText("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          {resetModalCompany && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5" />
                  Reset Demo Organization
                </DialogTitle>
                <DialogDescription>
                  This action is strictly limited to Demo Organizations and will wipe all operational records.
                </DialogDescription>
              </DialogHeader>

              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/60 text-xs space-y-2 text-rose-900 dark:text-rose-200">
                <div className="font-semibold">Authoritative Operational Purge:</div>
                <ul className="list-disc pl-4 space-y-1 text-rose-800 dark:text-rose-300">
                  <li>Removes all customers, suppliers, products, and categories</li>
                  <li>Removes all quotations, invoices, purchases, receipts, and payments</li>
                  <li>Removes all accounting vouchers, ledger balances, and audit logs</li>
                  <li>Restarts document counters back to 0001</li>
                  <li>Preserves the Organization, user accounts, and assigned roles</li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-confirm" className="text-xs font-semibold text-foreground">
                  To confirm, type the exact organization name:{" "}
                  <span className="font-mono text-rose-600 dark:text-rose-400 select-all">
                    {resetModalCompany.name}
                  </span>
                </Label>
                <Input
                  id="reset-confirm"
                  placeholder={resetModalCompany.name}
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setResetModalCompany(null);
                    setResetConfirmText("");
                  }}
                  disabled={resetting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleResetDemo}
                  disabled={resetting || resetConfirmText.trim() !== resetModalCompany.name.trim()}
                >
                  {resetting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Resetting Demo...
                    </>
                  ) : (
                    "Reset Demo Data"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 4. Initialize Demo Data Modal (PRD Section 16) */}
      <Dialog
        open={Boolean(initDemoCompany)}
        onOpenChange={(open) => {
          if (!open) setInitDemoCompany(null);
        }}
      >
        <DialogContent className="max-w-md">
          {initDemoCompany && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="h-5 w-5" />
                  Seed Demo Dataset
                </DialogTitle>
                <DialogDescription>
                  Generate realistic operational data for{" "}
                  <span className="font-semibold text-foreground">{initDemoCompany.name}</span> using normal canonical accounting engines.
                </DialogDescription>
              </DialogHeader>

              <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 text-xs space-y-2 text-indigo-950 dark:text-indigo-200">
                <div className="font-semibold">Dataset Breakdown:</div>
                <ul className="list-disc pl-4 space-y-1 text-indigo-900 dark:text-indigo-300">
                  <li>2 Master Customers (Acme Enterprises, Metro Infrastructure)</li>
                  <li>1 Master Supplier (Standard Steel & Hardware Corp)</li>
                  <li>5 Standard Products with size specifications and GST rates</li>
                  <li>2 Quotations (QT/2026-27/0001, QT/2026-27/0002)</li>
                  <li>1 Real Invoice (INV/2026-27/0001) with balanced journal voucher</li>
                  <li>1 Real Bank Receipt with balanced double-entry ledger postings</li>
                  <li>1 Supplier Purchase with payable voucher</li>
                </ul>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInitDemoCompany(null)}
                  disabled={initializingDemo}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleInitDemoData(initDemoCompany.id)}
                  disabled={initializingDemo}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {initializingDemo ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Seeding...
                    </>
                  ) : (
                    "Initialize Dataset"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 5. Extend Demo Expiration Modal (PRD Section 18) */}
      <Dialog
        open={Boolean(extendCompany)}
        onOpenChange={(open) => {
          if (!open) {
            setExtendCompany(null);
            setExtendExpiryDate("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          {extendCompany && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-foreground">
                  <Calendar className="h-5 w-5 text-amber-600" />
                  Extend Demo Expiration
                </DialogTitle>
                <DialogDescription>
                  Adjust the expiration timestamp for{" "}
                  <span className="font-semibold text-foreground">{extendCompany.name}</span>.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <Label htmlFor="ext-date" className="text-xs">
                  New Expiration Date
                </Label>
                <Input
                  id="ext-date"
                  type="date"
                  value={extendExpiryDate}
                  onChange={(e) => setExtendExpiryDate(e.target.value)}
                />
                <div className="flex gap-2">
                  {[7, 14, 30, 60].map((days) => (
                    <Button
                      key={days}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => {
                        const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                        setExtendExpiryDate(d.toISOString().split("T")[0]);
                      }}
                    >
                      +{days}d
                    </Button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setExtendCompany(null)}
                  disabled={extending}
                >
                  Cancel
                </Button>
                <Button onClick={handleExtendExpiry} disabled={extending}>
                  {extending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Update Expiration"
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
