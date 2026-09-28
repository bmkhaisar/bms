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
import { UserPlus, Search, Loader2, RefreshCw, UserCheck, Key, Sparkles, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  listPlatformUsersFn,
  createPlatformUserFn,
  findUserPlatformAdminFn,
  listCompaniesPlatformAdminFn,
  grantCompanyAccessFn,
} from "@/functions/platformAdminFns";
import type { PlatformUserSummary } from "@/server/platform-admin/userService";
import type { PlatformCompanySummary } from "@/server/platform-admin/companyService";

interface UsersViewProps {
  idToken: string;
  onUserCreated?: () => void;
}

const ROLES = [
  { id: "owner", label: "Owner (Full Tenant Control)" },
  { id: "administrator", label: "Administrator (Operational Admin)" },
  { id: "accountant", label: "Accountant (Full Accounting, Reports)" },
  { id: "sales", label: "Sales (Quotations, Invoices, Receipts)" },
  { id: "purchase", label: "Purchase (Orders, Invoices, Payments)" },
  { id: "inventory", label: "Inventory (Stock Movements, Products)" },
  { id: "viewer", label: "Viewer (Read-only operational data)" },
];

export function UsersView({ idToken, onUserCreated }: UsersViewProps) {
  const { user } = useAuth();
  const [users, setUsers] = useState<PlatformUserSummary[]>([]);
  const [companies, setCompanies] = useState<PlatformCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New user form state
  const [formData, setFormData] = useState({
    email: "",
    displayName: "",
    phoneNumber: "",
    password: "",
    assignCompanyId: "",
    assignRoleId: "accountant",
  });

  // Generated temporary password display state
  const [createdUserInfo, setCreatedUserInfo] = useState<{
    email: string;
    uid: string;
    tempPassword?: string;
    assignedCompany?: string;
    assignedRole?: string;
  } | null>(null);

  // Lookup existing user state
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<any>(null);

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

  const loadData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const token = await getAuthToken(forceRefresh);
        if (!token) {
          setLoading(false);
          return;
        }
        const [userRes, compRes] = await Promise.all([
          listPlatformUsersFn({ data: { idToken: token } }),
          listCompaniesPlatformAdminFn({ data: { idToken: token } }).catch(() => ({ success: false, companies: [] })),
        ]);

        if (userRes.success && userRes.users) {
          setUsers(userRes.users);
        } else {
          toast.error(userRes.error || "Failed to load platform users");
        }

        if (compRes.success && compRes.companies) {
          setCompanies(compRes.companies);
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
    loadData();
  }, [loadData]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.trim() || !formData.email.includes("@")) {
      toast.error("Valid email address is required.");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAuthToken(true);
      if (!token) {
        toast.error("Authentication token required.");
        return;
      }
      const res = await createPlatformUserFn({
        data: {
          idToken: token,
          email: formData.email.trim(),
          displayName: formData.displayName.trim() || undefined,
          phoneNumber: formData.phoneNumber.trim() || undefined,
          password: formData.password || undefined,
        },
      });

      if (res.success && res.user) {
        let assignedCompanyName: string | undefined;
        let assignedRoleLabel: string | undefined;

        // If organization assignment requested, grant access immediately
        if (formData.assignCompanyId && formData.assignCompanyId !== "none") {
          try {
            const accessRes = await grantCompanyAccessFn({
              data: {
                idToken: token,
                targetEmail: res.user.email,
                companyId: formData.assignCompanyId,
                roleId: formData.assignRoleId,
              },
            });
            if (accessRes.success) {
              const matchedComp = companies.find((c) => c.id === formData.assignCompanyId);
              assignedCompanyName = matchedComp ? matchedComp.name : formData.assignCompanyId;
              const matchedRole = ROLES.find((r) => r.id === formData.assignRoleId);
              assignedRoleLabel = matchedRole ? matchedRole.label : formData.assignRoleId;
              toast.success(`Access granted to ${assignedCompanyName} as ${assignedRoleLabel}`);
            } else {
              toast.warning(`User created, but role assignment failed: ${accessRes.error}`);
            }
          } catch (accessErr: unknown) {
            const accessMsg = accessErr instanceof Error ? accessErr.message : "Access error";
            toast.warning(`User created, but role assignment failed: ${accessMsg}`);
          }
        }

        if (res.existing) {
          toast.info(res.message || "User already exists in Firebase Authentication.");
        } else {
          toast.success("User created successfully in Firebase Auth.");
        }

        setCreatedUserInfo({
          email: res.user.email,
          uid: res.user.uid,
          tempPassword: res.user.tempPassword,
          assignedCompany: assignedCompanyName,
          assignedRole: assignedRoleLabel,
        });

        setFormData({
          email: "",
          displayName: "",
          phoneNumber: "",
          password: "",
          assignCompanyId: "",
          assignRoleId: "accountant",
        });

        await loadData(true);
        onUserCreated?.();
      } else {
        toast.error(res.error || "Failed to create user.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating user";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupEmail.trim()) return;

    setLookupLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await findUserPlatformAdminFn({
        data: { idToken: token, email: lookupEmail.trim() },
      });
      if (res.success) {
        setLookupResult(res);
        if (!res.found) {
          toast.info("No Firebase user found with this email.");
        }
      } else {
        toast.error(res.error || "Lookup failed.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error looking up user";
      toast.error(msg);
    } finally {
      setLookupLoading(false);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.uid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Platform Users</h2>
          <p className="text-sm text-muted-foreground">
            Firebase Authentication user directory across BMS organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Create User
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by name, email, or UID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card"
            />
          </div>
        </div>

        <form onSubmit={handleLookup} className="flex gap-2">
          <Input
            placeholder="Find user by email..."
            type="email"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            className="text-xs bg-card"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={lookupLoading}>
            {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
          </Button>
        </form>
      </div>

      {lookupResult && lookupResult.found && (
        <Card className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <UserCheck className="h-4 w-4" />
                Firebase User Found
              </div>
              <div className="text-sm font-medium text-foreground">
                {lookupResult.user.displayName || "No Name"} ({lookupResult.user.email})
              </div>
              <div className="text-xs font-mono text-muted-foreground">
                UID: {lookupResult.user.uid}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLookupResult(null)}
              className="text-xs text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <Card className="shadow-sm border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold text-foreground">Name</TableHead>
                <TableHead className="font-semibold text-foreground">Email</TableHead>
                <TableHead className="font-semibold text-foreground">Internal UID</TableHead>
                <TableHead className="font-semibold text-foreground">Assigned Companies</TableHead>
                <TableHead className="font-semibold text-foreground">Account Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No users found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => (
                  <TableRow key={u.uid} className="hover:bg-muted/40">
                    <TableCell className="font-medium text-foreground">{u.displayName}</TableCell>
                    <TableCell className="text-foreground">{u.email}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span title={u.uid}>{u.uid.substring(0, 12)}...</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal text-xs">
                        {u.assignedCompaniesCount} {u.assignedCompaniesCount === 1 ? "company" : "companies"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.disabled ? "destructive" : "default"} className="text-xs">
                        {u.disabled ? "Disabled" : "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog
        open={showCreateModal}
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) setCreatedUserInfo(null);
        }}
      >
        <DialogContent className="max-w-md">
          {createdUserInfo ? (
            <div className="space-y-4 py-2">
              <DialogHeader>
                <DialogTitle className="text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  User Created Successfully
                </DialogTitle>
                <DialogDescription>
                  The user has been registered in Firebase Authentication.
                </DialogDescription>
              </DialogHeader>

              <div className="p-4 rounded-lg bg-muted/40 border border-border space-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs block">Email</span>
                  <span className="font-semibold text-foreground">{createdUserInfo.email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs block">Internal UID</span>
                  <span className="font-mono text-xs text-muted-foreground">{createdUserInfo.uid}</span>
                </div>
                {createdUserInfo.assignedCompany && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-muted-foreground text-xs block">Assigned Membership</span>
                    <span className="font-semibold text-foreground text-xs">
                      {createdUserInfo.assignedCompany} — Role: {createdUserInfo.assignedRole}
                    </span>
                  </div>
                )}
                {createdUserInfo.tempPassword && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-amber-700 dark:text-amber-400 font-semibold text-xs flex items-center gap-1">
                      <Key className="h-3.5 w-3.5" />
                      Temporary Password (Show Once)
                    </span>
                    <div className="mt-1 p-2 bg-amber-50 dark:bg-amber-950/40 rounded border border-amber-200 dark:border-amber-800 font-mono text-sm select-all">
                      {createdUserInfo.tempPassword}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Provide this temporary password securely to the user so they can log in and reset their password.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button onClick={() => setShowCreateModal(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreateUser}>
              <DialogHeader>
                <DialogTitle>Create Platform User</DialogTitle>
                <DialogDescription>
                  Register a login identity in Firebase Authentication and optionally assign initial organization access.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3.5 py-4">
                <div className="space-y-1.5">
                  <Label htmlFor="u-email">Email Address *</Label>
                  <Input
                    id="u-email"
                    type="email"
                    placeholder="user@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="u-name">Display Name</Label>
                  <Input
                    id="u-name"
                    placeholder="e.g. Rahul Sharma"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="u-phone">Phone Number (Optional)</Label>
                  <Input
                    id="u-phone"
                    placeholder="+919876543210"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="u-pass">Initial Password (Optional)</Label>
                  <Input
                    id="u-pass"
                    type="password"
                    placeholder="Leave blank to auto-generate a temporary password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    If left blank, a secure random temporary password will be generated for you to share.
                  </p>
                </div>

                {/* Organization & Role Assignment (PRD Section 4 & 5) */}
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">
                      Assign to Organization (Optional)
                    </Label>
                    <Select
                      value={formData.assignCompanyId}
                      onValueChange={(val) => setFormData({ ...formData, assignCompanyId: val })}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder="Select an organization..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Do not assign to an organization now</SelectItem>
                        {companies.map((c) => {
                          const isDemo = c.isDemo || c.organizationType === "DEMO";
                          return (
                            <SelectItem key={c.id} value={c.id}>
                              <div className="flex items-center gap-2">
                                <span>{c.name}</span>
                                {isDemo && (
                                  <Badge className="text-[9px] px-1 h-3.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 border-none">
                                    DEMO
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.assignCompanyId && formData.assignCompanyId !== "none" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        Assigned Role
                      </Label>
                      <Select
                        value={formData.assignRoleId}
                        onValueChange={(val) => setFormData({ ...formData, assignRoleId: val })}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder="Select role..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
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
                    "Create User"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
