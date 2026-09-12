import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Building2, Plus, Search, Loader2, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  listCompaniesPlatformAdminFn,
  createCompanyPlatformAdminFn,
} from "@/functions/platformAdminFns";
import type { PlatformCompanySummary } from "@/server/platform-admin/companyService";

interface CompaniesViewProps {
  idToken: string;
  onCompanyCreated?: () => void;
}

export function CompaniesView({ idToken, onCompanyCreated }: CompaniesViewProps) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    legalName: "",
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

      if (res.success) {
        toast.success("Company created successfully.");
        setShowCreateModal(false);
        setFormData({
          name: "",
          legalName: "",
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
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Registered Companies</h2>
          <p className="text-sm text-slate-500">
            Tenant registry across all organizations in BMS NEXT.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadCompanies(true)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Company
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search companies by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-white"
          />
        </div>
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold text-slate-700">Company</TableHead>
                <TableHead className="font-semibold text-slate-700">Tenant ID</TableHead>
                <TableHead className="font-semibold text-slate-700">GSTIN</TableHead>
                <TableHead className="font-semibold text-slate-700">Active Members</TableHead>
                <TableHead className="font-semibold text-slate-700">Owner</TableHead>
                <TableHead className="font-semibold text-slate-700">Status</TableHead>
                <TableHead className="font-semibold text-slate-700">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading companies...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                    <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No companies found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => (
                  <TableRow key={c.id} className="hover:bg-slate-50/80">
                    <TableCell className="font-medium text-slate-900">
                      <div>
                        <div>{c.name}</div>
                        {c.legalName && c.legalName !== c.name && (
                          <div className="text-xs text-slate-500">{c.legalName}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{c.id}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{c.gstin || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-slate-700">
                        <Users className="h-4 w-4 text-slate-400" />
                        <span>{c.activeUsersCount}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {c.ownerUid ? (
                        <span title={c.ownerUid}>{c.ownerUid.substring(0, 10)}...</span>
                      ) : (
                        <span className="text-amber-600 font-sans text-xs">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.active ? "default" : "secondary"}>
                        {c.active ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Company Dialog */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateCompany}>
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
              <DialogDescription>
                Provision a new tenant company with default branch, financial year, and isolated Chart of Accounts.
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
                <Label htmlFor="c-address">Address</Label>
                <Input
                  id="c-address"
                  placeholder="Registered office address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
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

              <div className="md:col-span-2 pt-2 border-t border-slate-100">
                <h4 className="text-sm font-semibold text-slate-800 mb-2">Initial Financial Year</h4>
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

              <div className="md:col-span-2 pt-2 border-t border-slate-100 space-y-1.5">
                <Label htmlFor="c-owner">Initial Company Owner Email or UID (Optional)</Label>
                <Input
                  id="c-owner"
                  placeholder="e.g. owner@company.com or Firebase UID (leave blank to assign later)"
                  value={formData.initialOwner}
                  onChange={(e) => setFormData({ ...formData, initialOwner: e.target.value })}
                />
                <p className="text-xs text-slate-500">
                  If provided, this user will automatically receive active Owner membership in this company.
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
                    Creating...
                  </>
                ) : (
                  "Create Company"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
