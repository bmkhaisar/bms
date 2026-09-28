import React, { useState, useEffect, useMemo } from "react";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  ShieldCheck,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Layers,
  Edit2,
  UserX,
  UserCheck,
  GitBranch,
  Shield,
  Eye,
} from "lucide-react";
import {
  listCompanyMemberships,
  updateMemberBranchAccess,
  createCompanyUser,
  setUserMembershipStatus,
} from "@/functions/membershipFn";
import {
  GRANULAR_ACCESS_GROUPS,
  ROLE_PRESET_MODULES,
  resolveModuleIdsToPermissions,
  type CanonicalPermission,
} from "@/modules/auth/permissions";
import type { Membership, Branch } from "@/modules/company/types";

export function UserAccessManagementSection() {
  const { user } = useAuth();
  const { activeCompany, branches, isOwner, can } = useActiveCompany();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  // Add User Dialog State
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    fullName: "",
    email: "",
    role: "accountant" as "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer" | "custom",
    branchMode: "specific" as "specific" | "multiple" | "all",
    selectedBranchIds: [] as string[],
    selectedModules: [...ROLE_PRESET_MODULES.accountant],
  });
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Edit User Dialog State
  const [selectedMember, setSelectedMember] = useState<Membership | null>(null);
  const [editRole, setEditRole] = useState<string>("accountant");
  const [editBranchMode, setEditBranchMode] = useState<"specific" | "multiple" | "all">("all");
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const fetchMemberships = async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const res = await listCompanyMemberships(activeCompany.id);
      if (res.success && res.memberships) {
        setMemberships(res.memberships);
      }
    } catch (err: any) {
      console.warn("Failed to load memberships:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemberships();
  }, [activeCompany?.id]);

  // Handle Role selection in Add User flow (updates preset module checkboxes)
  const handleRoleChangeInAdd = (newRole: "admin" | "accountant" | "sales" | "purchase" | "inventory" | "viewer" | "custom") => {
    setAddForm((prev) => ({
      ...prev,
      role: newRole,
      selectedModules: newRole === "custom" ? prev.selectedModules : [...(ROLE_PRESET_MODULES[newRole] || [])],
    }));
  };

  // Handle module toggle in Add User flow
  const handleToggleModuleInAdd = (moduleId: string) => {
    setAddForm((prev) => {
      const hasMod = prev.selectedModules.includes(moduleId);
      const nextMods = hasMod
        ? prev.selectedModules.filter((m) => m !== moduleId)
        : [...prev.selectedModules, moduleId];
      return {
        ...prev,
        selectedModules: nextMods,
      };
    });
  };

  // Create User Handler
  const handleCreateUser = async () => {
    if (!activeCompany?.id) return;
    if (!addForm.fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!addForm.email.trim() || !addForm.email.includes("@")) {
      toast.error("A valid email address is required");
      return;
    }
    if (addForm.branchMode !== "all" && addForm.selectedBranchIds.length === 0) {
      toast.error("Please assign at least one branch for this user");
      return;
    }

    setIsCreatingUser(true);
    try {
      const customPermissions = resolveModuleIdsToPermissions(addForm.selectedModules);
      const res = await createCompanyUser(activeCompany.id, {
        fullName: addForm.fullName.trim(),
        email: addForm.email.trim(),
        role: addForm.role,
        allBranches: addForm.branchMode === "all",
        branchIds: addForm.branchMode === "all" ? [] : addForm.selectedBranchIds,
        customPermissions,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to create user");
        return;
      }

      toast.success(`User '${addForm.fullName}' successfully added to the organization!`);
      setIsAddUserOpen(false);
      setAddForm({
        fullName: "",
        email: "",
        role: "accountant",
        branchMode: "specific",
        selectedBranchIds: [],
        selectedModules: [...ROLE_PRESET_MODULES.accountant],
      });
      await fetchMemberships();
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred");
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Open Edit User Dialog
  const handleOpenEdit = (m: Membership) => {
    setSelectedMember(m);
    const roleVal = m.organizationRole || m.role || "viewer";
    setEditRole(roleVal);

    const isAll = Boolean(m.allBranches || (!m.branchAccess?.length && (!m.branchIds || m.branchIds.length === 0)));
    const bIds = m.branchAccess?.map((ba) => ba.branchId) || m.branchIds || [];
    
    if (isAll) {
      setEditBranchMode("all");
      setEditBranchIds([]);
    } else if (bIds.length === 1) {
      setEditBranchMode("specific");
      setEditBranchIds(bIds);
    } else {
      setEditBranchMode("multiple");
      setEditBranchIds(bIds);
    }

    // Resolve modules from customPermissions or role preset
    const perms = (m.customPermissions || []) as string[];
    if (perms.length > 0) {
      const activeMods: string[] = [];
      for (const group of GRANULAR_ACCESS_GROUPS) {
        for (const mod of group.modules) {
          if (mod.canonicalPermissions.some((cp) => perms.includes(cp))) {
            activeMods.push(mod.id);
          }
        }
      }
      setEditModules(activeMods);
    } else {
      setEditModules([...(ROLE_PRESET_MODULES[roleVal] || [])]);
    }
  };

  // Save Edit Access Handler
  const handleSaveEdit = async () => {
    if (!activeCompany?.id || !selectedMember) return;
    if (editBranchMode !== "all" && editBranchIds.length === 0) {
      toast.error("Please assign at least one branch for this user");
      return;
    }

    setIsSavingEdit(true);
    try {
      const customPermissions = resolveModuleIdsToPermissions(editModules);
      const isAll = editBranchMode === "all";
      const targetUid = selectedMember.userId || (selectedMember as any).uid || "";

      const res = await updateMemberBranchAccess(activeCompany.id, targetUid, {
        allBranches: isAll,
        branchIds: isAll ? [] : editBranchIds,
        branchAccess: isAll ? [] : editBranchIds.map((bId) => ({ branchId: bId, permissions: customPermissions })),
        customPermissions,
        role: editRole,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to update access");
        return;
      }

      toast.success("User access and branch permissions updated successfully!");
      setSelectedMember(null);
      await fetchMemberships();
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Deactivate / Reactivate Handler
  const handleToggleStatus = async (m: Membership) => {
    if (!activeCompany?.id) return;
    const targetUid = m.userId || (m as any).uid || "";
    const isCurrentlyActive = m.status === "active";
    const newStatus = isCurrentlyActive ? "suspended" : "active";

    try {
      const res = await setUserMembershipStatus(activeCompany.id, targetUid, newStatus);
      if (!res.success) {
        toast.error(res.error || "Failed to update status");
        return;
      }
      toast.success(newStatus === "active" ? "User access reactivated." : "User access deactivated.");
      await fetchMemberships();
    } catch (err: any) {
      toast.error(err.message || "An error occurred");
    }
  };

  // Branch user count summary
  const branchUserCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    memberships.forEach((m) => {
      if (m.allBranches || (!m.branchIds?.length && !m.branchAccess?.length)) {
        counts["all"] = (counts["all"] || 0) + 1;
      } else {
        const bIds = m.branchAccess?.map((ba) => ba.branchId) || m.branchIds || [];
        bIds.forEach((bId) => {
          counts[bId] = (counts[bId] || 0) + 1;
        });
      }
    });
    return counts;
  }, [memberships]);

  return (
    <div className="space-y-6">
      {/* Header with Title and Add User Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Users & Access Control
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage organization users, branch assignments and permissions.
          </p>
        </div>

        {isOwner && (
          <Button
            onClick={() => {
              // Pre-select first branch if available
              const defaultBranch = branches[0]?.id ? [branches[0].id] : [];
              setAddForm((prev) => ({ ...prev, selectedBranchIds: defaultBranch }));
              setIsAddUserOpen(true);
            }}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs text-xs h-9"
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      {/* Summary KPI Cards (PRD § 24) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 border-border/70 shadow-2xs bg-card/60">
          <div className="text-xs text-muted-foreground">Total Users</div>
          <div className="text-xl font-bold text-foreground mt-0.5">{memberships.length}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Across all roles</div>
        </Card>

        <Card className="p-3 border-border/70 shadow-2xs bg-card/60">
          <div className="text-xs text-muted-foreground">Active Members</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            {memberships.filter((m) => m.status === "active").length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Authorized access</div>
        </Card>

        <Card className="p-3 border-border/70 shadow-2xs bg-card/60">
          <div className="text-xs text-muted-foreground">Operating Branches</div>
          <div className="text-xl font-bold text-primary mt-0.5">{branches.length}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Active locations</div>
        </Card>

        <Card className="p-3 border-border/70 shadow-2xs bg-card/60">
          <div className="text-xs text-muted-foreground">All-Branch Users</div>
          <div className="text-xl font-bold text-foreground mt-0.5">
            {memberships.filter((m) => m.allBranches || (m.organizationRole || m.role) === "owner").length}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Organization-wide</div>
        </Card>
      </div>

      {/* Branch Breakdown Chips */}
      {branches.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-lg bg-muted/30 border border-border/60 text-xs">
          <span className="text-muted-foreground font-medium flex items-center gap-1 mr-1">
            <Building2 className="h-3.5 w-3.5" /> Branch Breakdown:
          </span>
          {branches.map((b) => (
            <Badge key={b.id} variant="outline" className="text-[11px] font-normal py-0.5 px-2 bg-background">
              {b.name}: <span className="font-semibold ml-1 text-primary">{branchUserCounts[b.id] || 0} user{(branchUserCounts[b.id] || 0) !== 1 ? "s" : ""}</span>
            </Badge>
          ))}
        </div>
      )}

      {/* Memberships Table (Desktop View) */}
      <Card className="border-border/70 shadow-xs overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>USER</TableHead>
                <TableHead>ROLE</TableHead>
                <TableHead>BRANCH ACCESS</TableHead>
                <TableHead>PERMISSIONS</TableHead>
                <TableHead>STATUS</TableHead>
                <TableHead className="text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>Loading team members...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : memberships.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                    <p className="text-sm">No members found in this organization</p>
                  </TableCell>
                </TableRow>
              ) : (
                memberships.map((m) => {
                  const roleName = (m.organizationRole || m.role || "viewer").toUpperCase();
                  const isUserOwner = roleName === "OWNER";
                  const hasAll = m.allBranches !== false && (!m.branchAccess || m.branchAccess.length === 0) && (!m.branchIds || m.branchIds.length === 0);

                  const memberKey = m.userId || (m as any).uid || `mem_${m.role}`;
                  const displayName = (m as any).displayName || "Team Member";
                  const displayEmail = (m as any).email || (m as any).userId || (m as any).uid;
                  const uid = m.userId || (m as any).uid;

                  return (
                    <TableRow key={memberKey} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-foreground">
                        <div className="flex flex-col">
                          <span className="font-semibold text-xs text-foreground">{displayName}</span>
                          <span className="text-[11px] text-muted-foreground">{displayEmail}</span>
                          {uid && uid !== displayEmail && (
                            <span className="text-[9px] font-mono text-muted-foreground/60 truncate max-w-[180px]">
                              UID: {uid}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={isUserOwner ? "default" : "secondary"}
                          className={`text-[10px] uppercase font-semibold ${isUserOwner ? "bg-amber-600 text-white" : ""}`}
                        >
                          {roleName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {isUserOwner || hasAll ? (
                          <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                            All Branches
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              const bIds = m.branchAccess?.map((ba) => ba.branchId) || m.branchIds || [];
                              if (bIds.length === 0) return <span className="text-muted-foreground">None</span>;
                              if (bIds.length === 1) {
                                const bName = branches.find((b) => b.id === bIds[0])?.name || bIds[0];
                                return (
                                  <Badge variant="outline" className="text-[10px] py-0">
                                    {bName}
                                  </Badge>
                                );
                              }
                              const firstBranch = branches.find((b) => b.id === bIds[0])?.name || bIds[0];
                              return (
                                <Badge variant="outline" className="text-[10px] py-0 font-medium">
                                  {firstBranch} <span className="text-primary font-bold ml-1">+{bIds.length - 1}</span>
                                </Badge>
                              );
                            })()}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isUserOwner ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" /> Full System Authority
                          </span>
                        ) : m.customPermissions && m.customPermissions.length > 0 ? (
                          <span className="font-medium text-foreground">{m.customPermissions.length} Granular Permissions</span>
                        ) : (
                          <span>Role Defaults ({roleName})</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={m.status === "active" ? "outline" : "destructive"}
                          className={`text-[10px] capitalize ${m.status === "active" ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : ""}`}
                        >
                          {m.status || "active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {!isUserOwner && isOwner ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs h-7 px-2.5 gap-1"
                              onClick={() => handleOpenEdit(m)}
                            >
                              <Edit2 className="h-3 w-3" />
                              Edit Access
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`text-xs h-7 px-2 ${m.status === "active" ? "text-rose-600 hover:text-rose-700 hover:bg-rose-500/10" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"}`}
                              onClick={() => handleToggleStatus(m)}
                            >
                              {m.status === "active" ? (
                                <>
                                  <UserX className="h-3 w-3 mr-1" />
                                  Deactivate
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-3 w-3 mr-1" />
                                  Reactivate
                                </>
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile View: Responsive Cards (PRD § 23) */}
        <div className="md:hidden divide-y divide-border/60">
          {loading ? (
            <div className="p-6 text-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto mb-2" />
              <span>Loading team members...</span>
            </div>
          ) : memberships.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              No members found in this organization
            </div>
          ) : (
            memberships.map((m) => {
              const roleName = (m.organizationRole || m.role || "viewer").toUpperCase();
              const isUserOwner = roleName === "OWNER";
              const displayName = (m as any).displayName || "Team Member";
              const displayEmail = (m as any).email || (m as any).userId || (m as any).uid;

              return (
                <div key={m.userId || (m as any).uid} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-xs text-foreground">{displayName}</div>
                      <div className="text-[11px] text-muted-foreground">{displayEmail}</div>
                    </div>
                    <Badge
                      variant={isUserOwner ? "default" : "secondary"}
                      className={`text-[9px] uppercase font-semibold ${isUserOwner ? "bg-amber-600 text-white" : ""}`}
                    >
                      {roleName}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                    <span className="text-[11px] text-muted-foreground">Branch Access:</span>
                    <span className="font-medium text-[11px]">
                      {isUserOwner || m.allBranches ? "All Branches" : `${(m.branchIds || []).length} Assigned`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[11px] text-muted-foreground">Status:</span>
                    <Badge
                      variant={m.status === "active" ? "outline" : "destructive"}
                      className={`text-[9px] capitalize ${m.status === "active" ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10" : ""}`}
                    >
                      {m.status || "active"}
                    </Badge>
                  </div>

                  {!isUserOwner && isOwner && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 flex-1"
                        onClick={() => handleOpenEdit(m)}
                      >
                        <Edit2 className="h-3 w-3 mr-1" /> Edit Access
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`text-xs h-7 px-2.5 ${m.status === "active" ? "text-rose-600" : "text-emerald-600"}`}
                        onClick={() => handleToggleStatus(m)}
                      >
                        {m.status === "active" ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Add User Dialog (PRD §§ 2, 3, 4, 7) */}
      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Add Organization User
            </DialogTitle>
            <DialogDescription className="text-xs">
              Provision a new user account, assign branch memberships, and configure module permissions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* User Basics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Full Name *</Label>
                <Input
                  placeholder="e.g. Mohammed Maaz"
                  value={addForm.fullName}
                  onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email Address *</Label>
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Role Preset Selector (PRD § 3: No Owner option) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Organization Role</Label>
              <Select
                value={addForm.role}
                onValueChange={(v: any) => handleRoleChangeInAdd(v)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (Full Operational Access)</SelectItem>
                  <SelectItem value="accountant">Accountant (Invoices, Ledger, GST, Reports)</SelectItem>
                  <SelectItem value="sales">Sales (Quotes, Invoices, Returns, Receipts)</SelectItem>
                  <SelectItem value="purchase">Purchase (Bills, Supplier Payments)</SelectItem>
                  <SelectItem value="inventory">Inventory (Stock Levels & Warehouse Transfers)</SelectItem>
                  <SelectItem value="viewer">Viewer (Read-Only Access)</SelectItem>
                  <SelectItem value="custom">Custom (Granular Permissions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Branch Assignment Options (PRD § 4) */}
            <div className="rounded-lg border border-border/70 p-3 space-y-3 bg-muted/20">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary" /> Branch Access Scope
              </Label>

              <RadioGroup
                value={addForm.branchMode}
                onValueChange={(val: any) => setAddForm({ ...addForm, branchMode: val })}
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="specific" id="add-bm-single" />
                  <Label htmlFor="add-bm-single" className="text-xs font-normal cursor-pointer">
                    Specific Branch
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="multiple" id="add-bm-multi" />
                  <Label htmlFor="add-bm-multi" className="text-xs font-normal cursor-pointer">
                    Multiple Branches
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="all" id="add-bm-all" />
                  <Label htmlFor="add-bm-all" className="text-xs font-normal cursor-pointer">
                    All Branches
                  </Label>
                </div>
              </RadioGroup>

              {/* Branch Selection List if not All Branches */}
              {addForm.branchMode !== "all" && (
                <div className="pt-2 border-t border-border/60 space-y-2">
                  <div className="text-[11px] text-muted-foreground">Select authorized branches:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {branches.map((b) => {
                      const isChecked = addForm.selectedBranchIds.includes(b.id);
                      return (
                        <div
                          key={b.id}
                          className="flex items-center space-x-2 p-2 rounded-md border border-border/60 bg-background"
                        >
                          <Checkbox
                            id={`add-br-${b.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              if (addForm.branchMode === "specific") {
                                setAddForm({ ...addForm, selectedBranchIds: checked ? [b.id] : [] });
                              } else {
                                setAddForm({
                                  ...addForm,
                                  selectedBranchIds: checked
                                    ? [...addForm.selectedBranchIds, b.id]
                                    : addForm.selectedBranchIds.filter((id) => id !== b.id),
                                });
                              }
                            }}
                          />
                          <Label
                            htmlFor={`add-br-${b.id}`}
                            className="text-xs font-medium cursor-pointer flex-1 truncate"
                          >
                            {b.name} <span className="text-[10px] text-muted-foreground font-mono">({b.code})</span>
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Granular Module Permissions Grouped UI (PRD § 7) */}
            <div className="space-y-3 pt-2 border-t border-border/70">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold">Module Access & Permissions</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Preset by selected role. Customize individual modules as needed.
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {addForm.selectedModules.length} Modules Active
                </Badge>
              </div>

              <div className="space-y-3">
                {GRANULAR_ACCESS_GROUPS.map((group) => (
                  <div key={group.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                    <div className="text-xs font-bold text-foreground tracking-wider uppercase flex items-center justify-between">
                      <span>{group.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground lowercase">{group.description}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {group.modules.map((mod) => {
                        const isModActive = addForm.selectedModules.includes(mod.id);
                        return (
                          <div
                            key={mod.id}
                            className="flex items-start space-x-2 p-1.5 rounded hover:bg-muted/40 transition-colors"
                          >
                            <Checkbox
                              id={`add-mod-${mod.id}`}
                              checked={isModActive}
                              onCheckedChange={() => handleToggleModuleInAdd(mod.id)}
                              className="mt-0.5"
                            />
                            <div className="leading-tight">
                              <Label htmlFor={`add-mod-${mod.id}`} className="text-xs font-medium cursor-pointer">
                                {mod.label}
                              </Label>
                              <div className="text-[10px] text-muted-foreground line-clamp-1">
                                {mod.description}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsAddUserOpen(false)} disabled={isCreatingUser}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={isCreatingUser || !addForm.fullName.trim() || !addForm.email.trim()}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isCreatingUser && <Loader2 className="h-4 w-4 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Access Dialog (PRD §§ 4, 5, 7) */}
      <Dialog open={Boolean(selectedMember)} onOpenChange={(open) => !open && setSelectedMember(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Configure User Access
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update branch memberships and operational permissions for{" "}
              <span className="font-semibold text-foreground">
                {(selectedMember as any)?.displayName || (selectedMember as any)?.email}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Role Select */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Organization Role</Label>
              <Select
                value={editRole}
                onValueChange={(val) => {
                  setEditRole(val);
                  if (val !== "custom" && ROLE_PRESET_MODULES[val]) {
                    setEditModules([...ROLE_PRESET_MODULES[val]]);
                  }
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (Full Operational Access)</SelectItem>
                  <SelectItem value="accountant">Accountant (Invoices, Ledger, GST, Reports)</SelectItem>
                  <SelectItem value="sales">Sales (Quotes, Invoices, Returns, Receipts)</SelectItem>
                  <SelectItem value="purchase">Purchase (Bills, Supplier Payments)</SelectItem>
                  <SelectItem value="inventory">Inventory (Stock Levels & Warehouse Transfers)</SelectItem>
                  <SelectItem value="viewer">Viewer (Read-Only Access)</SelectItem>
                  <SelectItem value="custom">Custom (Granular Permissions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Branch Assignment Options (PRD § 5: Moving users between branches) */}
            <div className="rounded-lg border border-border/70 p-3 space-y-3 bg-muted/20">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary" /> Branch Access Scope
              </Label>

              <RadioGroup
                value={editBranchMode}
                onValueChange={(val: any) => setEditBranchMode(val)}
                className="grid grid-cols-1 sm:grid-cols-3 gap-2"
              >
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="specific" id="edit-bm-single" />
                  <Label htmlFor="edit-bm-single" className="text-xs font-normal cursor-pointer">
                    Specific Branch
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="multiple" id="edit-bm-multi" />
                  <Label htmlFor="edit-bm-multi" className="text-xs font-normal cursor-pointer">
                    Multiple Branches
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border border-border/60 rounded-md p-2 bg-background">
                  <RadioGroupItem value="all" id="edit-bm-all" />
                  <Label htmlFor="edit-bm-all" className="text-xs font-normal cursor-pointer">
                    All Branches
                  </Label>
                </div>
              </RadioGroup>

              {editBranchMode !== "all" && (
                <div className="pt-2 border-t border-border/60 space-y-2">
                  <div className="text-[11px] text-muted-foreground">Select authorized branches:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {branches.map((b) => {
                      const isChecked = editBranchIds.includes(b.id);
                      return (
                        <div
                          key={b.id}
                          className="flex items-center space-x-2 p-2 rounded-md border border-border/60 bg-background"
                        >
                          <Checkbox
                            id={`edit-br-${b.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              if (editBranchMode === "specific") {
                                setEditBranchIds(checked ? [b.id] : []);
                              } else {
                                setEditBranchIds(
                                  checked
                                    ? [...editBranchIds, b.id]
                                    : editBranchIds.filter((id) => id !== b.id)
                                );
                              }
                            }}
                          />
                          <Label
                            htmlFor={`edit-br-${b.id}`}
                            className="text-xs font-medium cursor-pointer flex-1 truncate"
                          >
                            {b.name} <span className="text-[10px] text-muted-foreground font-mono">({b.code})</span>
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Granular Module Permissions Grouped UI (PRD § 7) */}
            <div className="space-y-3 pt-2 border-t border-border/70">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-semibold">Module Access & Permissions</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Customize module access for this user.
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {editModules.length} Modules Active
                </Badge>
              </div>

              <div className="space-y-3">
                {GRANULAR_ACCESS_GROUPS.map((group) => (
                  <div key={group.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                    <div className="text-xs font-bold text-foreground tracking-wider uppercase flex items-center justify-between">
                      <span>{group.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground lowercase">{group.description}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {group.modules.map((mod) => {
                        const isModActive = editModules.includes(mod.id);
                        return (
                          <div
                            key={mod.id}
                            className="flex items-start space-x-2 p-1.5 rounded hover:bg-muted/40 transition-colors"
                          >
                            <Checkbox
                              id={`edit-mod-${mod.id}`}
                              checked={isModActive}
                              onCheckedChange={() => {
                                setEditModules((prev) =>
                                  prev.includes(mod.id)
                                    ? prev.filter((id) => id !== mod.id)
                                    : [...prev, mod.id]
                                );
                              }}
                              className="mt-0.5"
                            />
                            <div className="leading-tight">
                              <Label htmlFor={`edit-mod-${mod.id}`} className="text-xs font-medium cursor-pointer">
                                {mod.label}
                              </Label>
                              <div className="text-[10px] text-muted-foreground line-clamp-1">
                                {mod.description}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSelectedMember(null)} disabled={isSavingEdit}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isSavingEdit}
              className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {isSavingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
