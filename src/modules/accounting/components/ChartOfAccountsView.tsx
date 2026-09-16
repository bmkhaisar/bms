import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPaise } from "../constants";
import type { Ledger, AccountGroup, AccountNature, Voucher } from "../types";
import { calculateCanonicalLedgerBalances } from "../services/reportEngine";
import { Plus, FolderTree, Landmark, Tag, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ChartOfAccountsViewProps {
  ledgers: Ledger[];
  accountGroups: AccountGroup[];
  vouchers?: Voucher[];
  onCreateLedger: (data: {
    name: string;
    code?: string;
    groupId: string;
    openingBalance?: number;
    openingBalanceType?: "dr" | "cr";
    amountsInRupees?: boolean;
    partyType?: "customer" | "supplier" | "bank" | "cash" | "general";
    bankDetails?: { accountNumber?: string; ifsc?: string; bankName?: string; upiId?: string };
  }) => Promise<{ success: boolean; error?: string }>;
  onCreateGroup: (name: string, parentGroupId: string) => Promise<{ success: boolean; error?: string }>;
  onInitChart: () => Promise<{ success: boolean; error?: string }>;
}

export function ChartOfAccountsView({
  ledgers,
  accountGroups,
  vouchers = [],
  onCreateLedger,
  onCreateGroup,
  onInitChart,
}: ChartOfAccountsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNature, setSelectedNature] = useState<string>("all");

  // Canonical signed ledger balances derived strictly from posted vouchers + opening
  const canonicalBalances = useMemo(() => {
    return calculateCanonicalLedgerBalances(ledgers, vouchers, {}, accountGroups);
  }, [ledgers, vouchers, accountGroups]);

  // New Group Dialog State
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [parentGroupId, setParentGroupId] = useState("");
  const [isSubmittingGroup, setIsSubmittingGroup] = useState(false);

  // New Ledger Dialog State
  const [ledgerDialogOpen, setLedgerDialogOpen] = useState(false);
  const [ledgerName, setLedgerName] = useState("");
  const [ledgerCode, setLedgerCode] = useState("");
  const [ledgerGroupId, setLedgerGroupId] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingType, setOpeningType] = useState<"dr" | "cr">("dr");
  const [partyType, setPartyType] = useState<"general" | "bank" | "cash" | "customer" | "supplier">("general");
  const [bankAccNumber, setBankAccNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankUpi, setBankUpi] = useState("");
  const [isSubmittingLedger, setIsSubmittingLedger] = useState(false);

  const [isSyncingChart, setIsSyncingChart] = useState(false);

  // Hierarchy mapping
  const groupMap = useMemo(() => {
    const map = new Map<string, AccountGroup>();
    for (const g of accountGroups) map.set(g.id, g);
    return map;
  }, [accountGroups]);

  // Grouped tree structure for presentation
  const natures: AccountNature[] = ["asset", "liability", "equity", "income", "expense"];

  const filteredLedgers = useMemo(() => {
    return ledgers.filter((l) => {
      if (selectedNature !== "all" && l.groupNature !== selectedNature) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = l.name.toLowerCase().includes(q);
        const matchCode = (l.code || "").toLowerCase().includes(q);
        const matchGroup = (groupMap.get(l.groupId)?.name || "").toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchGroup) return false;
      }
      return true;
    });
  }, [ledgers, selectedNature, searchQuery, groupMap]);

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Group name is required.");
      return;
    }
    if (!parentGroupId) {
      toast.error("Parent group is required so the group can inherit accounting classification.");
      return;
    }

    setIsSubmittingGroup(true);
    try {
      const res = await onCreateGroup(groupName.trim(), parentGroupId);
      if (res.success) {
        toast.success(`Account group '${groupName}' created successfully.`);
        setGroupDialogOpen(false);
        setGroupName("");
        setParentGroupId("");
      } else {
        toast.error(res.error || "Failed to create account group.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating group";
      toast.error(msg);
    } finally {
      setIsSubmittingGroup(false);
    }
  };

  const handleCreateLedger = async () => {
    if (!ledgerName.trim()) {
      toast.error("Ledger account name is required.");
      return;
    }
    if (!ledgerGroupId) {
      toast.error("Please select an account group.");
      return;
    }

    setIsSubmittingLedger(true);
    try {
      const openingNum = parseFloat(openingBalance) || 0;
      const res = await onCreateLedger({
        name: ledgerName.trim(),
        code: ledgerCode.trim() || undefined,
        groupId: ledgerGroupId,
        openingBalance: openingNum,
        openingBalanceType: openingType,
        amountsInRupees: true,
        partyType,
        bankDetails:
          partyType === "bank"
            ? {
                accountNumber: bankAccNumber.trim(),
                ifsc: bankIfsc.trim(),
                bankName: bankName.trim(),
                upiId: bankUpi.trim(),
              }
            : undefined,
      });

      if (res.success) {
        toast.success(`Ledger account '${ledgerName}' created successfully.`);
        setLedgerDialogOpen(false);
        setLedgerName("");
        setLedgerCode("");
        setLedgerGroupId("");
        setOpeningBalance("");
        setOpeningType("dr");
        setPartyType("general");
        setBankAccNumber("");
        setBankIfsc("");
        setBankName("");
        setBankUpi("");
      } else {
        toast.error(res.error || "Failed to create ledger.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating ledger";
      toast.error(msg);
    } finally {
      setIsSubmittingLedger(false);
    }
  };

  const handleSyncSystemChart = async () => {
    setIsSyncingChart(true);
    try {
      const res = await onInitChart();
      if (res.success) {
        toast.success("Chart of Accounts verified and synced with system defaults.");
      } else {
        toast.error(res.error || "Failed to sync Chart of Accounts.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync error";
      toast.error(msg);
    } finally {
      setIsSyncingChart(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action and Filter Bar */}
      <Card className="p-4 card-soft flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <Label className="text-xs">Search Chart of Accounts</Label>
          <Input
            placeholder="Search account name, code, or group..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 border rounded-md p-1 bg-muted/20">
          {["all", ...natures].map((n) => (
            <Button
              key={n}
              variant={selectedNature === n ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setSelectedNature(n)}
            >
              {n}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={handleSyncSystemChart}
            disabled={isSyncingChart}
            title="Ensure all system account groups and foundational ledgers exist"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncingChart ? "animate-spin" : ""}`} /> Sync Defaults
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={() => setGroupDialogOpen(true)}
          >
            <FolderTree className="h-3.5 w-3.5" /> New Group
          </Button>

          <Button
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={() => setLedgerDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New Ledger
          </Button>
        </div>
      </Card>

      {/* Accounts & Groups Table */}
      <Card className="card-soft overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>Ledger Account</TableHead>
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Account Group</TableHead>
              <TableHead className="w-[100px]">Nature</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead className="text-right w-[130px]">Opening Balance</TableHead>
              <TableHead className="text-right w-[130px]">Current Balance</TableHead>
              <TableHead className="w-[80px] text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLedgers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                  No ledger accounts found. Click "Sync Defaults" or "New Ledger" to get started.
                </TableCell>
              </TableRow>
            ) : (
              filteredLedgers.map((l) => {
                const grp = groupMap.get(l.groupId);
                return (
                  <TableRow key={l.id} className="hover:bg-muted/30 text-xs">
                    <TableCell className="font-semibold">
                      <div className="flex items-center gap-2">
                        {l.partyType === "bank" && <Landmark className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                        <span>{l.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{l.code || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{grp?.name || l.groupId}</TableCell>
                    <TableCell>
                      <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-muted font-medium">
                        {l.groupNature}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{l.partyType || "general"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {l.openingBalance > 0
                        ? `${formatPaise(l.openingBalance)} ${(l.openingBalanceType || "dr").toUpperCase()}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {(() => {
                        const canonical = canonicalBalances.get(l.id);
                        const displayPaise = canonical
                          ? (canonical.closingDrPaise > 0 ? canonical.closingDrPaise : canonical.closingCrPaise)
                          : Math.abs(l.currentBalance || 0);
                        const displayType = canonical
                          ? (canonical.closingBalanceType === "cr" ? "Cr" : "Dr")
                          : ((l.currentBalance || 0) >= 0 ? "Dr" : "Cr");
                        return (
                          <>
                            {formatPaise(displayPaise)}{" "}
                            <span className={`text-[10px] font-semibold ${displayType === "Cr" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {displayType}
                            </span>
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      {l.active !== false ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* New Group Modal */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-primary" />
              <span>Create Custom Account Group</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-xs">
            <p className="text-muted-foreground">
              Custom account groups inherit the fundamental financial classification (nature) 
              from their parent group, ensuring reports like the Trial Balance and Balance Sheet 
              remain mathematically sound.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Group Name *</Label>
              <Input
                placeholder="e.g. Marketing Expenses, Software Licenses, IT Assets..."
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Parent Group *</Label>
              <Select value={parentGroupId} onValueChange={setParentGroupId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select parent group…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {accountGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">
                      {g.name} ({g.nature.toUpperCase()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setGroupDialogOpen(false)} disabled={isSubmittingGroup}>
              Cancel
            </Button>
            <Button onClick={handleCreateGroup} disabled={isSubmittingGroup || !groupName.trim() || !parentGroupId}>
              {isSubmittingGroup ? "Creating..." : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Ledger Modal */}
      <Dialog open={ledgerDialogOpen} onOpenChange={setLedgerDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              <span>Create Ledger Account</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Account Name *</Label>
                <Input
                  placeholder="e.g. Electricity Charges, Office Stationery..."
                  value={ledgerName}
                  onChange={(e) => setLedgerName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Account Code / Short Name</Label>
                <Input
                  placeholder="e.g. ELEC-01, HDFC-CURR..."
                  value={ledgerCode}
                  onChange={(e) => setLedgerCode(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Account Group *</Label>
                <Select value={ledgerGroupId} onValueChange={setLedgerGroupId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select group…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {accountGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id} className="text-xs">
                        {g.name} ({g.nature.toUpperCase()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Account Classification</Label>
                <Select value={partyType} onValueChange={(v) => setPartyType(v as typeof partyType)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General Ledger</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                    <SelectItem value="cash">Cash Account</SelectItem>
                    <SelectItem value="customer">Customer Sub-ledger</SelectItem>
                    <SelectItem value="supplier">Supplier Sub-ledger</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Opening Balance */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/20 rounded-md border">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Opening Balance (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Balance Type</Label>
                <Select value={openingType} onValueChange={(v) => setOpeningType(v as "dr" | "cr")}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dr">Debit (Dr) — Assets / Expenses</SelectItem>
                    <SelectItem value="cr">Credit (Cr) — Liabilities / Equity / Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Bank Metadata if partyType is bank */}
            {partyType === "bank" && (
              <div className="space-y-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-md">
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">Bank Metadata</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Bank Name</Label>
                    <Input placeholder="e.g. HDFC Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Account Number</Label>
                    <Input placeholder="Account #" value={bankAccNumber} onChange={(e) => setBankAccNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">IFSC Code</Label>
                    <Input placeholder="IFSC" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">UPI ID / VPA</Label>
                    <Input placeholder="company@okbank" value={bankUpi} onChange={(e) => setBankUpi(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setLedgerDialogOpen(false)} disabled={isSubmittingLedger}>
              Cancel
            </Button>
            <Button onClick={handleCreateLedger} disabled={isSubmittingLedger || !ledgerName.trim() || !ledgerGroupId}>
              {isSubmittingLedger ? "Creating..." : "Save Ledger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
