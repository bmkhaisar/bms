import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Download, Search, Wallet, TrendingUp, TrendingDown, Scale, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatPaise, rupeesToPaise, paiseToRupees } from "../constants";
import type { Ledger, AccountGroup, AccountNature, ManageLedgerInput } from "../types";
import * as XLSX from "xlsx";

interface AccountsMasterViewProps {
  ledgers: Ledger[];
  accountGroups: AccountGroup[];
  onCreateLedger: (input: Omit<ManageLedgerInput, "idToken" | "companyId">) => Promise<{ success: boolean; error?: string }>;
  onViewStatement?: (ledgerId: string) => void;
}

export function AccountsMasterView({
  ledgers,
  accountGroups,
  onCreateLedger,
  onViewStatement,
}: AccountsMasterViewProps) {
  const [search, setSearch] = useState("");
  const [natureFilter, setNatureFilter] = useState<string>("all");
  const [editingLedger, setEditingLedger] = useState<Ledger | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form states
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formGroupId, setFormGroupId] = useState("");
  const [formOpeningBalance, setFormOpeningBalance] = useState("0");
  const [formBalanceType, setFormBalanceType] = useState<"dr" | "cr">("dr");
  const [formGstin, setFormGstin] = useState("");
  const [formPan, setFormPan] = useState("");
  const [formPartyType, setFormPartyType] = useState<string>("general");
  const [formActive, setFormActive] = useState(true);

  // Open modal for new ledger
  const openNewLedgerModal = () => {
    setEditingLedger(null);
    setFormName("");
    setFormCode("");
    setFormGroupId(accountGroups[0]?.id || "grp_bank");
    setFormOpeningBalance("0");
    setFormBalanceType("dr");
    setFormGstin("");
    setFormPan("");
    setFormPartyType("general");
    setFormActive(true);
    setIsModalOpen(true);
  };

  // Open modal for edit
  const openEditModal = (ledger: Ledger) => {
    setEditingLedger(ledger);
    setFormName(ledger.name);
    setFormCode(ledger.code || "");
    setFormGroupId(ledger.groupId);
    setFormOpeningBalance(String(paiseToRupees(ledger.openingBalance || 0)));
    setFormBalanceType(ledger.openingBalanceType || "dr");
    setFormGstin(ledger.gstin || "");
    setFormPan(ledger.pan || "");
    setFormPartyType(ledger.partyType || "general");
    setFormActive(ledger.active !== false);
    setIsModalOpen(true);
  };

  // Save handler
  const handleSave = async () => {
    const cleanName = formName.trim();
    if (!cleanName) {
      toast.error("Account name is required");
      return;
    }
    if (!formGroupId) {
      toast.error("Please select a parent account group");
      return;
    }

    const opBalRupees = parseFloat(formOpeningBalance) || 0;
    const opBalPaise = rupeesToPaise(opBalRupees);

    setIsSubmitting(true);
    try {
      const res = await onCreateLedger({
        ledgerId: editingLedger?.id,
        name: cleanName,
        code: formCode.trim() || undefined,
        groupId: formGroupId,
        openingBalance: opBalPaise,
        openingBalanceType: formBalanceType,
        gstin: formGstin.trim().toUpperCase() || undefined,
        pan: formPan.trim().toUpperCase() || undefined,
        partyType: formPartyType as any,
        active: formActive,
      });

      if (res.success) {
        toast.success(editingLedger ? "Account ledger updated successfully" : "New account ledger created");
        setIsModalOpen(false);
      } else {
        toast.error(res.error || "Failed to save account ledger");
      }
    } catch (err: any) {
      toast.error(err?.message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Map groups by ID for quick lookup
  const groupMap = useMemo(() => {
    const map = new Map<string, AccountGroup>();
    for (const g of accountGroups) map.set(g.id, g);
    return map;
  }, [accountGroups]);

  // Filtered ledgers
  const filteredLedgers = useMemo(() => {
    return ledgers.filter((l) => {
      const g = groupMap.get(l.groupId);
      if (natureFilter !== "all" && g?.nature !== natureFilter) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const matchesName = l.name.toLowerCase().includes(q);
        const matchesCode = (l.code || "").toLowerCase().includes(q);
        const matchesGroup = (g?.name || "").toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesGroup) return false;
      }
      return true;
    });
  }, [ledgers, groupMap, natureFilter, search]);

  // Statistics KPI
  const stats = useMemo(() => {
    let assetPaise = 0;
    let liabilityPaise = 0;
    let incomePaise = 0;
    let expensePaise = 0;

    for (const l of ledgers) {
      const g = groupMap.get(l.groupId);
      const bal = l.currentBalance || 0;
      if (g?.nature === "asset") assetPaise += bal;
      else if (g?.nature === "liability") liabilityPaise += bal;
      else if (g?.nature === "income") incomePaise += bal;
      else if (g?.nature === "expense") expensePaise += bal;
    }

    return {
      totalAccounts: ledgers.length,
      assetPaise,
      liabilityPaise,
      incomePaise,
      expensePaise,
    };
  }, [ledgers, groupMap]);

  // Excel Export
  const exportToExcel = () => {
    const rows = filteredLedgers.map((l) => {
      const g = groupMap.get(l.groupId);
      return {
        "Account Code": l.code || "",
        "Account Name": l.name,
        "Parent Group": g?.name || l.groupId,
        "Account Nature": (g?.nature || "").toUpperCase(),
        "Account Type": l.partyType || "General",
        "Opening Balance": `${paiseToRupees(l.openingBalance || 0).toFixed(2)} ${(l.openingBalanceType || "DR").toUpperCase()}`,
        "Current Balance": `${Math.abs(paiseToRupees(l.currentBalance || 0)).toFixed(2)} ${(l.currentBalance || 0) >= 0 ? "DR" : "CR"}`,
        "GSTIN": l.gstin || "",
        "PAN": l.pan || "",
        "Status": l.active !== false ? "Active" : "Inactive",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Accounts Master");
    XLSX.writeFile(wb, `Accounts_Master_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Accounts master exported to Excel");
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Accounts</span>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{stats.totalAccounts}</div>
          <div className="text-[10px] text-muted-foreground">Chart of Accounts ledgers</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Assets</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {formatPaise(Math.max(0, stats.assetPaise))}
          </div>
          <div className="text-[10px] text-muted-foreground">Liquid, receivables & fixed</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Liabilities</span>
            <TrendingDown className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400">
            {formatPaise(Math.abs(stats.liabilityPaise))}
          </div>
          <div className="text-[10px] text-muted-foreground">Payables, loans & capital</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Income vs Expenses</span>
            <Scale className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 text-sm font-semibold">
            <span className="text-emerald-600">+{formatPaise(Math.abs(stats.incomePaise))}</span> /{" "}
            <span className="text-rose-600">-{formatPaise(Math.abs(stats.expensePaise))}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">Net operating position</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search account name, code, group..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={natureFilter} onValueChange={setNatureFilter}>
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder="All Natures" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Natures</SelectItem>
                <SelectItem value="asset">Assets</SelectItem>
                <SelectItem value="liability">Liabilities</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expenses</SelectItem>
                <SelectItem value="equity">Equity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
              <Download className="h-3.5 w-3.5" />
              <span>Excel Export</span>
            </Button>
            <Button size="sm" onClick={openNewLedgerModal} className="gap-1.5 text-xs h-9">
              <Plus className="h-3.5 w-3.5" />
              <span>New Account</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Accounts Master Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead className="w-16">Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Group Hierarchy</TableHead>
                <TableHead>Nature</TableHead>
                <TableHead className="text-right">Opening Bal</TableHead>
                <TableHead className="text-right">Current Bal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLedgers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No accounts found matching your filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLedgers.map((l) => {
                  const g = groupMap.get(l.groupId);
                  const isDr = (l.currentBalance || 0) >= 0;
                  const curBalAbs = Math.abs(l.currentBalance || 0);

                  return (
                    <TableRow key={l.id} className="text-xs hover:bg-secondary/20">
                      <TableCell className="font-mono text-muted-foreground">{l.code || "—"}</TableCell>
                      <TableCell>
                        <div className="font-semibold text-foreground flex items-center gap-1.5">
                          <span>{l.name}</span>
                          {l.isSystem && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-primary/40 text-primary">
                              System
                            </Badge>
                          )}
                        </div>
                        {l.gstin && (
                          <div className="text-[10px] font-mono text-muted-foreground">GSTIN: {l.gstin}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-muted-foreground">{g?.name || l.groupId}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`capitalize text-[10px] font-medium ${
                            g?.nature === "asset"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                              : g?.nature === "liability"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : g?.nature === "income"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                          }`}
                        >
                          {g?.nature || "Asset"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPaise(l.openingBalance || 0)}{" "}
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {(l.openingBalanceType || "dr").toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        <span className={isDr ? "text-blue-700 dark:text-blue-400" : "text-emerald-700 dark:text-emerald-400"}>
                          {formatPaise(curBalAbs)} {isDr ? "Dr" : "Cr"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {l.active !== false ? (
                          <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground text-[10px]">
                            <XCircle className="h-3 w-3" /> Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit Account"
                            onClick={() => openEditModal(l)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Create / Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLedger ? "Edit Account Ledger" : "Create New Account Ledger"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Account Name *</Label>
                <Input
                  placeholder="e.g. HDFC Bank Current A/c"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="text-xs h-9"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Code (Optional)</Label>
                <Input
                  placeholder="e.g. ACC-101"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="text-xs h-9 uppercase font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Parent Group *</Label>
              <Select value={formGroupId} onValueChange={setFormGroupId}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select Parent Group" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {accountGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">
                      {g.name} ({g.nature.toUpperCase()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Opening Balance (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formOpeningBalance}
                  onChange={(e) => setFormOpeningBalance(e.target.value)}
                  className="text-xs h-9 font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Dr / Cr</Label>
                <Select value={formBalanceType} onValueChange={(v: "dr" | "cr") => setFormBalanceType(v)}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dr" className="text-xs">Debit (Dr)</SelectItem>
                    <SelectItem value="cr" className="text-xs">Credit (Cr)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">GSTIN (Optional)</Label>
                <Input
                  placeholder="27AAAAA0000A1Z5"
                  value={formGstin}
                  onChange={(e) => setFormGstin(e.target.value.toUpperCase())}
                  className="text-xs h-9 font-mono uppercase"
                  maxLength={15}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PAN (Optional)</Label>
                <Input
                  placeholder="ABCDE1234F"
                  value={formPan}
                  onChange={(e) => setFormPan(e.target.value.toUpperCase())}
                  className="text-xs h-9 font-mono uppercase"
                  maxLength={10}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="space-y-1">
                <Label className="text-xs">Account Classification</Label>
                <Select value={formPartyType} onValueChange={setFormPartyType}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general" className="text-xs">General Ledger</SelectItem>
                    <SelectItem value="bank" className="text-xs">Bank Account</SelectItem>
                    <SelectItem value="cash" className="text-xs">Cash in Hand</SelectItem>
                    <SelectItem value="customer" className="text-xs">Customer (Debtor)</SelectItem>
                    <SelectItem value="supplier" className="text-xs">Supplier (Creditor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Account Status</Label>
                <Select value={formActive ? "active" : "inactive"} onValueChange={(v) => setFormActive(v === "active")}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active" className="text-xs">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : editingLedger ? "Save Changes" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
