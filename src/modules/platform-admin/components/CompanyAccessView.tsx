import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
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
  ShieldCheck,
  UserPlus,
  Loader2,
  RefreshCw,
  Crown,
  UserX,
  UserMinus,
  UserCheck,
  Edit2,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import {
  listCompaniesPlatformAdminFn,
  listCompanyMembershipsFn,
  grantCompanyAccessFn,
  updateCompanyAccessFn,
  suspendCompanyAccessFn,
  revokeCompanyAccessFn,
  transferCompanyOwnershipFn,
} from "@/functions/platformAdminFns";
import type { PlatformCompanySummary } from "@/server/platform-admin/companyService";

interface CompanyAccessViewProps {
  idToken: string;
}

const AVAILABLE_ROLES = [
  { id: "owner", label: "Owner (Full Tenant Control)" },
  { id: "administrator", label: "Administrator (Operational Admin)" },
  { id: "accountant", label: "Accountant (Full Accounting, Reports)" },
  { id: "sales", label: "Sales (Quotations, Invoices, Receipts)" },
  { id: "purchase", label: "Purchase (Orders, Invoices, Payments)" },
  { id: "inventory", label: "Inventory (Stock Movements, Products)" },
  { id: "viewer", label: "Viewer (Read-only operational data)" },
];

export function CompanyAccessView({ idToken }: CompanyAccessViewProps) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [memberships, setMemberships] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingMemberships, setLoadingMemberships] = useState(false);

  // Grant Access Modal
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantTarget, setGrantTarget] = useState("");
  const [grantRoleId, setGrantRoleId] = useState("accountant");
  const [grantSubmitting, setGrantSubmitting] = useState(false);

  // Edit Role Modal
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [editRoleId, setEditRoleId] = useState("accountant");
  const [editStatus, setEditStatus] = useState<"active" | "suspended" | "revoked">("active");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Transfer Ownership Modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);

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

  // Load Companies
  const loadCompanies = useCallback(
    async (forceRefresh = false) => {
      setLoadingCompanies(true);
      try {
        const token = await getAuthToken(forceRefresh);
        if (!token) {
          setLoadingCompanies(false);
          return;
        }
        const res = await listCompaniesPlatformAdminFn({ data: { idToken: token } });
        if (res.success && res.companies) {
          setCompanies(res.companies);
          if (res.companies.length > 0 && !selectedCompanyId) {
            setSelectedCompanyId(res.companies[0].id);
          }
        }
      } catch (err: any) {
        toast.error("Failed to load companies: " + err.message);
      } finally {
        setLoadingCompanies(false);
      }
    },
    [getAuthToken, selectedCompanyId]
  );

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // Load Memberships for Selected Company
  const loadMemberships = useCallback(
    async (forceRefresh = false) => {
      if (!selectedCompanyId) return;
      setLoadingMemberships(true);
      try {
        const token = await getAuthToken(forceRefresh);
        if (!token) {
          setLoadingMemberships(false);
          return;
        }
        const res: any = await listCompanyMembershipsFn({
          data: { idToken: token, companyId: selectedCompanyId },
        });
        if (res.success && res.memberships) {
          setMemberships(res.memberships);
        } else {
          toast.error(res.error || "Failed to load memberships");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error";
        toast.error(msg);
      } finally {
        setLoadingMemberships(false);
      }
    },
    [getAuthToken, selectedCompanyId]
  );

  useEffect(() => {
    loadMemberships();
  }, [loadMemberships]);

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantTarget.trim()) {
      toast.error("User email or UID is required.");
      return;
    }

    setGrantSubmitting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) {
        toast.error("Authentication token required.");
        return;
      }
      const isEmail = grantTarget.includes("@");
      const res = await grantCompanyAccessFn({
        data: {
          idToken: token,
          companyId: selectedCompanyId,
          targetEmail: isEmail ? grantTarget.trim().toLowerCase() : undefined,
          targetUid: !isEmail ? grantTarget.trim() : undefined,
          roleId: grantRoleId,
        },
      });

      if (res.success) {
        toast.success("Company access granted successfully.");
        setShowGrantModal(false);
        setGrantTarget("");
        setGrantRoleId("accountant");
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to grant access.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error granting access";
      toast.error(msg);
    } finally {
      setGrantSubmitting(false);
    }
  };

  const handleReactivate = async (targetUid: string) => {
    try {
      const token = await getAuthToken(true);
      if (!token) return;
      const res = await updateCompanyAccessFn({
        data: { idToken: token, companyId: selectedCompanyId, targetUid, status: "active" },
      });
      if (res.success) {
        toast.success("Access reactivated successfully.");
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to reactivate access.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(msg);
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    setEditSubmitting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) return;
      const res = await updateCompanyAccessFn({
        data: {
          idToken: token,
          companyId: selectedCompanyId,
          targetUid: editingMember.uid,
          roleId: editRoleId,
          status: editStatus,
        },
      });

      if (res.success) {
        toast.success("Membership updated successfully.");
        setEditingMember(null);
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to update membership.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error updating membership";
      toast.error(msg);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSuspend = async (targetUid: string) => {
    if (!confirm("Are you sure you want to suspend this user's access?")) return;
    try {
      const token = await getAuthToken(true);
      if (!token) return;
      const res = await suspendCompanyAccessFn({
        data: { idToken: token, companyId: selectedCompanyId, targetUid },
      });
      if (res.success) {
        toast.success("Access suspended.");
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to suspend access.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(msg);
    }
  };

  const handleRevoke = async (targetUid: string) => {
    if (
      !confirm(
        "Are you sure you want to REVOKE this user's access? The user will immediately lose access to this company's operational workspace."
      )
    )
      return;
    try {
      const token = await getAuthToken(true);
      if (!token) return;
      const res = await revokeCompanyAccessFn({
        data: { idToken: token, companyId: selectedCompanyId, targetUid },
      });
      if (res.success) {
        toast.success("Access revoked.");
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to revoke access.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(msg);
    }
  };

  const handleTransferOwnership = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTarget.trim()) {
      toast.error("Target new owner UID or email is required.");
      return;
    }

    setTransferSubmitting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) return;
      const isEmail = transferTarget.includes("@");
      const res = await transferCompanyOwnershipFn({
        data: {
          idToken: token,
          companyId: selectedCompanyId,
          newOwnerEmail: isEmail ? transferTarget.trim().toLowerCase() : undefined,
          newOwnerUid: !isEmail ? transferTarget.trim() : undefined,
          previousOwnerNewRoleId: "administrator",
        },
      });

      if (res.success) {
        toast.success("Ownership transferred successfully.");
        setShowTransferModal(false);
        setTransferTarget("");
        loadMemberships(true);
      } else {
        toast.error(res.error || "Failed to transfer ownership.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error transferring ownership";
      toast.error(msg);
    } finally {
      setTransferSubmitting(false);
    }
  };

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Company Access Control</h2>
          <p className="text-sm text-slate-500">
            Provision and configure tenant memberships, roles, and branch permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadCompanies(true);
              loadMemberships(true);
            }}
            disabled={loadingMemberships || loadingCompanies}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loadingMemberships || loadingCompanies ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setShowGrantModal(true)}
            disabled={!selectedCompanyId}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Grant Membership
          </Button>
        </div>
      </div>

      {/* Company Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <Building2 className="h-5 w-5 text-slate-500 hidden sm:block" />
        <div className="flex-1 space-y-1">
          <Label className="text-xs font-semibold text-slate-700">Select Target Organization</Label>
          <Select
            value={selectedCompanyId}
            onValueChange={(val) => setSelectedCompanyId(val)}
            disabled={loadingCompanies || companies.length === 0}
          >
            <SelectTrigger className="w-full sm:w-80 bg-white">
              <SelectValue placeholder="Choose a company..." />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedCompany && (
          <div className="text-xs text-slate-500 border-t sm:border-t-0 sm:border-l border-slate-200 pt-2 sm:pt-0 sm:pl-4">
            <div>
              <span className="font-semibold text-slate-700">GSTIN:</span> {selectedCompany.gstin || "N/A"}
            </div>
            <div>
              <span className="font-semibold text-slate-700">Active Members:</span> {selectedCompany.activeUsersCount}
            </div>
          </div>
        )}
      </div>

      {/* Memberships Table */}
      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold text-slate-700">User UID</TableHead>
                <TableHead className="font-semibold text-slate-700">Role</TableHead>
                <TableHead className="font-semibold text-slate-700">Status</TableHead>
                <TableHead className="font-semibold text-slate-700">Assigned Branches</TableHead>
                <TableHead className="font-semibold text-slate-700">Granted On</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingMemberships ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading company memberships...
                  </TableCell>
                </TableRow>
              ) : memberships.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    No active or registered memberships found for this company.
                  </TableCell>
                </TableRow>
              ) : (
                memberships.map((m) => {
                  const isOwner = m.role === "owner" || m.roleId === "owner";
                  return (
                    <TableRow key={m.uid} className="hover:bg-slate-50/80">
                      <TableCell className="font-mono text-xs font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          {isOwner && <Crown className="h-4 w-4 text-amber-500 flex-shrink-0" />}
                          <span>{m.uid}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={isOwner ? "default" : "secondary"}
                          className="capitalize"
                        >
                          {m.roleId || m.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            m.status === "active"
                              ? "default"
                              : m.status === "suspended"
                              ? "secondary"
                              : "destructive"
                          }
                          className="capitalize text-xs"
                        >
                          {m.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {m.branchIds ? Object.keys(m.branchIds).join(", ") : "br_main"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingMember(m);
                              setEditRoleId(m.roleId || m.role || "accountant");
                              setEditStatus(m.status || "active");
                            }}
                            title="Edit Role / Status"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>

                          {m.status === "active" && !isOwner && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSuspend(m.uid)}
                              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                              title="Suspend Access"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {m.status === "suspended" && !isOwner && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReactivate(m.uid)}
                              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              title="Reactivate Access"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {m.status !== "revoked" && !isOwner && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevoke(m.uid)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Revoke Access"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          )}
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

      {/* Transfer Ownership Section */}
      <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-amber-950 flex items-center gap-1.5">
            <Crown className="h-4 w-4 text-amber-600" />
            Company Ownership Transfer
          </h4>
          <p className="text-xs text-amber-800">
            Transfer primary ownership of this organization to another Firebase Auth user safely.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTransferModal(true)}
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
          disabled={!selectedCompanyId}
        >
          Transfer Ownership
        </Button>
      </div>

      {/* Grant Membership Dialog */}
      <Dialog open={showGrantModal} onOpenChange={setShowGrantModal}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleGrantAccess}>
            <DialogHeader>
              <DialogTitle>Grant Company Membership</DialogTitle>
              <DialogDescription>
                Assign a Firebase user membership in {selectedCompany?.name || "this company"}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="g-target">User Email or UID *</Label>
                <Input
                  id="g-target"
                  placeholder="e.g. accounts@abccompany.com or Firebase UID"
                  value={grantTarget}
                  onChange={(e) => setGrantTarget(e.target.value)}
                  required
                />
                <p className="text-[11px] text-slate-500">
                  Enter the user's login email address or their internal Firebase UID.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="g-role">Assigned Role *</Label>
                <Select value={grantRoleId} onValueChange={setGrantRoleId}>
                  <SelectTrigger id="g-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_ROLES.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowGrantModal(false)}
                disabled={grantSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={grantSubmitting}>
                {grantSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Provisioning...
                  </>
                ) : (
                  "Grant Access"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={Boolean(editingMember)} onOpenChange={(o) => !o && setEditingMember(null)}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleUpdateRole}>
            <DialogHeader>
              <DialogTitle>Edit Membership</DialogTitle>
              <DialogDescription>
                Modify role or access status for UID: {editingMember?.uid}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="e-role">Role</Label>
                <Select value={editRoleId} onValueChange={setEditRoleId}>
                  <SelectTrigger id="e-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_ROLES.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="e-status">Status</Label>
                <Select
                  value={editStatus}
                  onValueChange={(val: any) => setEditStatus(val)}
                >
                  <SelectTrigger id="e-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingMember(null)}
                disabled={editSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transfer Ownership Dialog */}
      <Dialog open={showTransferModal} onOpenChange={setShowTransferModal}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleTransferOwnership}>
            <DialogHeader>
              <DialogTitle className="text-amber-900">Transfer Company Ownership</DialogTitle>
              <DialogDescription>
                Assign a new primary owner for {selectedCompany?.name}. The existing owner will be converted to an Administrator.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="t-target">New Owner Email or UID *</Label>
                <Input
                  id="t-target"
                  placeholder="e.g. accounts@abccompany.com or Firebase UID"
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowTransferModal(false)}
                disabled={transferSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={transferSubmitting}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {transferSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Transferring...
                  </>
                ) : (
                  "Confirm Transfer"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
