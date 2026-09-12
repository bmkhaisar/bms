import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { UserPlus, Search, Loader2, RefreshCw, UserCheck, Key } from "lucide-react";
import { toast } from "sonner";
import {
  listPlatformUsersFn,
  createPlatformUserFn,
  findUserPlatformAdminFn,
} from "@/functions/platformAdminFns";
import type { PlatformUserSummary } from "@/server/platform-admin/userService";

interface UsersViewProps {
  idToken: string;
  onUserCreated?: () => void;
}

export function UsersView({ idToken, onUserCreated }: UsersViewProps) {
  const { user } = useAuth();
  const [users, setUsers] = useState<PlatformUserSummary[]>([]);
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
  });

  // Generated temporary password display state
  const [createdUserInfo, setCreatedUserInfo] = useState<{
    email: string;
    uid: string;
    tempPassword?: string;
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

  const loadUsers = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const token = await getAuthToken(forceRefresh);
        if (!token) {
          setLoading(false);
          return;
        }
        const res = await listPlatformUsersFn({ data: { idToken: token } });
        if (res.success && res.users) {
          setUsers(res.users);
        } else {
          toast.error(res.error || "Failed to load platform users");
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
    loadUsers();
  }, [loadUsers]);

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
        if (res.existing) {
          toast.info(res.message || "User already exists in Firebase Authentication.");
        } else {
          toast.success("User created successfully in Firebase Auth.");
        }
        setCreatedUserInfo({
          email: res.user.email,
          uid: res.user.uid,
          tempPassword: res.user.tempPassword,
        });
        setFormData({ email: "", displayName: "", phoneNumber: "", password: "" });
        await loadUsers(true);
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
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Platform Users</h2>
          <p className="text-sm text-slate-500">
            Firebase Authentication user directory across BMS organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadUsers(true)} disabled={loading}>
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
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Filter by name, email, or UID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
        </div>

        {/* Quick Email Lookup Form */}
        <form onSubmit={handleLookup} className="flex gap-2">
          <Input
            placeholder="Verify Firebase email..."
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            className="bg-white"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={lookupLoading}>
            {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </form>
      </div>

      {lookupResult && lookupResult.found && lookupResult.user && (
        <Card className="border-emerald-200 bg-emerald-50/50 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-emerald-600" />
                <span className="font-semibold text-sm text-emerald-950">
                  User Found: {lookupResult.user.displayName || "No Display Name"} ({lookupResult.user.email})
                </span>
              </div>
              <div className="text-xs font-mono text-emerald-800">
                UID: {lookupResult.user.uid}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLookupResult(null)}
              className="text-xs text-slate-500"
            >
              Dismiss
            </Button>
          </div>
        </Card>
      )}

      <Card className="shadow-sm border-slate-200">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="font-semibold text-slate-700">Name</TableHead>
                <TableHead className="font-semibold text-slate-700">Email</TableHead>
                <TableHead className="font-semibold text-slate-700">Internal UID</TableHead>
                <TableHead className="font-semibold text-slate-700">Assigned Companies</TableHead>
                <TableHead className="font-semibold text-slate-700">Account Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                    No users found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => (
                  <TableRow key={u.uid} className="hover:bg-slate-50/80">
                    <TableCell className="font-medium text-slate-900">{u.displayName}</TableCell>
                    <TableCell className="text-slate-700">{u.email}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      <span title={u.uid}>{u.uid.substring(0, 12)}...</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {u.assignedCompaniesCount} {u.assignedCompaniesCount === 1 ? "company" : "companies"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.disabled ? "destructive" : "default"}>
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
                <DialogTitle className="text-emerald-700 flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  User Created Successfully
                </DialogTitle>
                <DialogDescription>
                  The user has been registered in Firebase Authentication.
                </DialogDescription>
              </DialogHeader>

              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-sm">
                <div>
                  <span className="text-slate-500 text-xs block">Email</span>
                  <span className="font-semibold text-slate-900">{createdUserInfo.email}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block">Internal UID</span>
                  <span className="font-mono text-xs text-slate-700">{createdUserInfo.uid}</span>
                </div>
                {createdUserInfo.tempPassword && (
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-amber-700 font-semibold text-xs flex items-center gap-1">
                      <Key className="h-3.5 w-3.5" />
                      Temporary Password (Show Once)
                    </span>
                    <div className="mt-1 p-2 bg-amber-50 rounded border border-amber-200 font-mono text-sm select-all">
                      {createdUserInfo.tempPassword}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
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
                  Register a login identity in Firebase Authentication. You can then assign them company memberships.
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
                  <p className="text-[11px] text-slate-500">
                    If left blank, a secure random temporary password will be generated for you to share with the user.
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
