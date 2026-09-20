import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Supplier } from "@/lib/db";
import { useLive, useLiveState } from "@/lib/useLive";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ListToolbar, EmptyState, usePagination, Pager } from "@/components/app/ListHelpers";
import { ListSkeleton } from "@/components/app/Skeletons";
import { Pencil, Plus, Trash2, Truck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, removeCachedEntity } from "@/modules/sync/dexieCache";
import { createSupplierWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { performOptimisticMutation } from "@/lib/mutationPipeline";
import { checkEntityHistoricalUsage, type HistoricalUsageResult } from "@/lib/historicalUsage";

export const Route = createFileRoute("/_app/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — BMS NEXT" }] }),
  component: SuppliersPage,
});

const empty: Supplier = {
  id: "",
  name: "",
  mobile: "",
  email: "",
  gstin: "",
  address: "",
  company: "",
  openingBalance: 0,
  active: true,
  createdAt: 0,
};

function SuppliersPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRowsState = useLiveState<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const rows = dexieRowsState.data;
  const initialLoading = !dexieRowsState.isLoaded;
  const [, setCloudRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ALL" | "INACTIVE">("ACTIVE");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier>(empty);
  const [saving, setSaving] = useState(false);

  // Target for delete / deactivate modal
  const [deleteTarget, setDeleteTarget] = useState<{
    supplier: Supplier;
    usage: HistoricalUsageResult;
  } | null>(null);

  // Deep-link support
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    const idParam = params.get("id");
    if (queryParam) setQ(queryParam);
    if (idParam && rows.length > 0) {
      const match = rows.find((r) => r.id === idParam);
      if (match) {
        setEditing({ ...match });
        setOpen(true);
      }
    }
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (statusFilter === "ACTIVE" && r.active === false) return false;
    if (statusFilter === "INACTIVE" && r.active !== false) return false;

    const s = q.toLowerCase().trim();
    return (
      !s ||
      r.name.toLowerCase().includes(s) ||
      (r.mobile ?? "").includes(s) ||
      (r.gstin ?? "").toLowerCase().includes(s) ||
      (r.company ?? "").toLowerCase().includes(s)
    );
  });
  const pager = usePagination(filtered, 10);

  function openNew() {
    setEditing({ ...empty, id: uid(), createdAt: Date.now() });
    setOpen(true);
  }

  function openEdit(r: Supplier) {
    setEditing({ ...r, active: r.active !== false });
    setOpen(true);
  }

  async function promptDelete(supplier: Supplier) {
    const usage = await checkEntityHistoricalUsage({
      entityType: "supplier",
      entityId: supplier.id,
    });
    setDeleteTarget({ supplier, usage });
  }

  async function removeSupplierPermanent(supplier: Supplier) {
    const id = supplier.id;
    await performOptimisticMutation<Supplier>({
      entityType: "supplier",
      entityId: id,
      action: "delete",
      companyId: activeCompany?.id,
      uid: user?.uid,
      capturePreviousState: () => supplier,
      onOptimistic: () => {
        // Immediate UI removal
        setCloudRows((prev) => prev.filter((s) => s.id !== id));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => [prev, ...list]);
        }
      },
      syncDexie: async () => {
        await db().suppliers.delete(id);
        await db().parties.delete(id);
        if (activeCompany?.id) {
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "supplier", entityId: id });
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "party", entityId: id });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().suppliers.put(prev);
          await db().parties.put(prev);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "supplier", entityId: id, data: prev });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${id}`));
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`));
        }
      },
      queryKeys: [["suppliers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
      successToast: `Supplier "${supplier.name}" deleted`,
      errorToast: "Couldn't delete supplier. It has been restored.",
    });
  }

  async function deactivateSupplier(supplier: Supplier) {
    const deactivated: Supplier = { ...supplier, active: false };
    const id = supplier.id;

    await performOptimisticMutation<Supplier>({
      entityType: "supplier",
      entityId: id,
      action: "deactivate",
      companyId: activeCompany?.id,
      uid: user?.uid,
      optimisticData: deactivated,
      capturePreviousState: () => supplier,
      onOptimistic: () => {
        setCloudRows((prev) => prev.map((s) => (s.id === id ? deactivated : s)));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => list.map((s) => (s.id === prev.id ? prev : s)));
        }
      },
      syncDexie: async () => {
        await db().suppliers.put(deactivated);
        await db().parties.put(deactivated);
        if (activeCompany?.id && user?.uid) {
          await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "supplier", entityId: id, data: deactivated });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().suppliers.put(prev);
          await db().parties.put(prev);
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await set(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${id}`), sanitizeForFirebase(deactivated));
          await set(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`), sanitizeForFirebase(deactivated));
        }
      },
      queryKeys: [["suppliers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
      successToast: `Supplier "${supplier.name}" deactivated`,
      errorToast: "Couldn't deactivate supplier. Changes reverted.",
    });
  }

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }

    setSaving(true);
    try {
      let linkedLedgerId: string | undefined = undefined;

      // 1. Atomic Supplier + Accounts Payable Ledger creation
      if (activeCompany?.id && user?.uid) {
        const res = await createSupplierWithLedger({
          companyId: activeCompany.id,
          supplier: {
            ...editing,
            name: editing.name.trim(),
          },
          uid: user.uid,
          idempotencyKey: `mut_supp_${editing.id}`,
        });
        if (res.success && res.ledgerId) {
          linkedLedgerId = res.ledgerId;
        }
      }

      const supplierToSave: Supplier = {
        ...editing,
        name: editing.name.trim(),
        ledgerId: linkedLedgerId || editing.ledgerId,
        active: editing.active !== false,
      };

      const isNew = !rows.some((s) => s.id === supplierToSave.id);

      await performOptimisticMutation<Supplier>({
        entityType: "supplier",
        entityId: supplierToSave.id,
        action: isNew ? "create" : "update",
        companyId: activeCompany?.id,
        uid: user?.uid,
        optimisticData: supplierToSave,
        onOptimistic: () => {
          setCloudRows((prev) => {
            const exists = prev.some((s) => s.id === supplierToSave.id);
            if (exists) {
              return prev.map((s) => (s.id === supplierToSave.id ? supplierToSave : s));
            } else {
              return [supplierToSave, ...prev];
            }
          });
        },
        onRollback: (prev) => {
          setCloudRows((prevList) => {
            if (isNew) {
              return prevList.filter((s) => s.id !== supplierToSave.id);
            } else if (prev) {
              return prevList.map((s) => (s.id === prev.id ? prev : s));
            }
            return prevList;
          });
        },
        syncDexie: async () => {
          await db().suppliers.put(supplierToSave);
          await db().parties.put(supplierToSave);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "supplier",
              entityId: supplierToSave.id,
              data: supplierToSave,
            });
          }
        },
        rollbackDexie: async (prev) => {
          if (isNew) {
            await db().suppliers.delete(supplierToSave.id);
            await db().parties.delete(supplierToSave.id);
            if (activeCompany?.id) {
              await removeCachedEntity({ companyId: activeCompany.id, entityType: "supplier", entityId: supplierToSave.id });
            }
          } else if (prev) {
            await db().suppliers.put(prev);
          }
        },
        serverMutation: async () => {
          if (activeCompany?.id && firebaseDb) {
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${supplierToSave.id}`), sanitizeForFirebase(supplierToSave));
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${supplierToSave.id}`), sanitizeForFirebase(supplierToSave));
          }
        },
        queryKeys: [["suppliers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
        successToast: isNew ? "Supplier saved & linked to Accounts Payable" : "Supplier updated",
        errorToast: "Unable to save supplier. Please check your connection.",
      });

      setOpen(false);
    } catch (err) {
      console.error("Failed to save supplier:", err);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => r.active !== false).length;
  const inactiveCount = rows.filter((r) => r.active === false).length;

  return (
    <AppShell title="Suppliers">
      <PageHeader
        title="Suppliers"
        description="Manage vendor directory with automatic Accounts Payable ledger linking."
        actions={
          <Button onClick={openNew} className="gap-2 shadow-sm">
            <Truck className="h-4 w-4" /> Add supplier
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex-1">
          <ListToolbar query={q} onQuery={setQ} placeholder="Search by vendor name, company, mobile, GST…" />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)} className="w-full sm:w-auto">
          <TabsList className="h-9 w-full sm:w-auto text-xs grid grid-cols-3">
            <TabsTrigger value="ACTIVE">Active ({activeCount})</TabsTrigger>
            <TabsTrigger value="ALL">All ({rows.length})</TabsTrigger>
            <TabsTrigger value="INACTIVE">Inactive ({inactiveCount})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {initialLoading ? (
        <ListSkeleton columns={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === "INACTIVE" ? "No inactive suppliers" : "No suppliers yet"}
          description={
            statusFilter === "INACTIVE"
              ? "All suppliers are currently active."
              : q
              ? `No suppliers matching "${q}".`
              : "Add your first supplier to record purchase vouchers and track payables."
          }
          action={
            statusFilter !== "INACTIVE" && !q ? (
              <Button onClick={openNew} className="mt-2 gap-2">
                <Plus className="h-4 w-4" /> Add supplier
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/30 text-[11px] font-semibold text-muted-foreground uppercase border-b border-border/70">
                  <TableHead>Vendor Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((r) => {
                  const isInactive = r.active === false;
                  return (
                    <TableRow key={r.id} className={isInactive ? "opacity-60 bg-muted/20" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold">{r.name}</span>
                          {isInactive && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        {r.company ? <div className="text-xs text-muted-foreground">{r.company}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">{r.mobile || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.gstin || "—"}</TableCell>
                      <TableCell className="text-xs">{r.address || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit Supplier"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title={isInactive ? "Delete Supplier" : "Delete or Deactivate Supplier"}
                            onClick={() => promptDelete(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      <Pager {...pager} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rows.find((r) => r.id === editing.id) ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Vendor Name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name</Label>
              <Input
                value={editing.company ?? ""}
                onChange={(e) => setEditing({ ...editing, company: e.target.value })}
                placeholder="Vendor Corp"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mobile Number</Label>
              <Input
                value={editing.mobile ?? ""}
                onChange={(e) => setEditing({ ...editing, mobile: e.target.value })}
                placeholder="9876543210"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                value={editing.email ?? ""}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                placeholder="vendor@company.com"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">GSTIN</Label>
              <Input
                value={editing.gstin ?? ""}
                onChange={(e) => setEditing({ ...editing, gstin: e.target.value.toUpperCase() })}
                placeholder="27ABCDE1234F1Z5"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Address</Label>
              <Textarea
                rows={2}
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="Street address, city"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="text-xs">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving} className="text-xs">
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Saving Supplier…
                </>
              ) : (
                "Save Supplier"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Target-Specific Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title={
          deleteTarget?.usage.hasHistory
            ? `Deactivate "${deleteTarget.supplier.name}"?`
            : `Delete "${deleteTarget?.supplier.name}"?`
        }
        description={
          deleteTarget?.usage.hasHistory
            ? deleteTarget.usage.reason
            : `"${deleteTarget?.supplier.name}" will be permanently removed from supplier records.`
        }
        destructive={!deleteTarget?.usage.hasHistory}
        confirmText={deleteTarget?.usage.hasHistory ? "Deactivate" : "Delete Supplier"}
        busyText={deleteTarget?.usage.hasHistory ? "Deactivating…" : "Deleting…"}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.usage.hasHistory) {
            await deactivateSupplier(deleteTarget.supplier);
          } else {
            await removeSupplierPermanent(deleteTarget.supplier);
          }
          setDeleteTarget(null);
        }}
      />
    </AppShell>
  );
}
