import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Customer } from "@/lib/db";
import { useLive } from "@/lib/useLive";
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
import { Pencil, Plus, Trash2, UserPlus, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, removeCachedEntity } from "@/modules/sync/dexieCache";
import { createCustomerWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { CustomerInsightDrawer } from "@/components/app/CustomerInsightDrawer";
import { performOptimisticMutation } from "@/lib/mutationPipeline";
import { checkEntityHistoricalUsage, type HistoricalUsageResult } from "@/lib/historicalUsage";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "Customers — BMS NEXT" }] }),
  component: CustomersPage,
});

const empty: Customer = {
  id: "",
  name: "",
  mobile: "",
  phone: "",
  email: "",
  company: "",
  gstin: "",
  pan: "",
  address: "",
  city: "",
  state: "",
  stateCode: "",
  country: "India",
  pincode: "",
  openingBalance: 0,
  active: true,
  createdAt: 0,
};

function CustomersPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const [, setCloudRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ALL" | "INACTIVE">("ACTIVE");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer>(empty);
  const [saving, setSaving] = useState(false);
  const [selectedCustomerIdForDrawer, setSelectedCustomerIdForDrawer] = useState<string | null>(null);

  // Target for delete / deactivate modal
  const [deleteTarget, setDeleteTarget] = useState<{
    customer: Customer;
    usage: HistoricalUsageResult;
  } | null>(null);

  // The company-level ordered realtime synchronizer is the single read owner.
  const rows = dexieRows;

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
      (r.email ?? "").toLowerCase().includes(s) ||
      (r.gstin ?? "").toLowerCase().includes(s) ||
      (r.company ?? "").toLowerCase().includes(s)
    );
  });
  const pager = usePagination(filtered, 10);

  function openNew() {
    setEditing({ ...empty, id: uid(), createdAt: Date.now() });
    setOpen(true);
  }

  function openEdit(r: Customer) {
    setEditing({ ...r, active: r.active !== false });
    setOpen(true);
  }

  async function promptDelete(customer: Customer) {
    const usage = await checkEntityHistoricalUsage({
      entityType: "customer",
      entityId: customer.id,
    });
    setDeleteTarget({ customer, usage });
  }

  async function removeCustomerPermanent(customer: Customer) {
    const id = customer.id;
    await performOptimisticMutation<Customer>({
      entityType: "customer",
      entityId: id,
      action: "delete",
      companyId: activeCompany?.id,
      uid: user?.uid,
      capturePreviousState: () => customer,
      onOptimistic: () => {
        setCloudRows((prev) => prev.filter((c) => c.id !== id));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => [prev, ...list]);
        }
      },
      syncDexie: async () => {
        await db().customers.delete(id);
        await db().parties.delete(id);
        if (activeCompany?.id) {
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "customer", entityId: id });
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "party", entityId: id });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().customers.put(prev);
          await db().parties.put(prev);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "customer", entityId: id, data: prev });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${id}`));
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`));
        }
      },
      queryKeys: [["customers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
      successToast: `Customer "${customer.name}" deleted`,
      errorToast: "Couldn't delete customer. It has been restored.",
    });
  }

  async function deactivateCustomer(customer: Customer) {
    const deactivated: Customer = { ...customer, active: false };
    const id = customer.id;

    await performOptimisticMutation<Customer>({
      entityType: "customer",
      entityId: id,
      action: "deactivate",
      companyId: activeCompany?.id,
      uid: user?.uid,
      optimisticData: deactivated,
      capturePreviousState: () => customer,
      onOptimistic: () => {
        setCloudRows((prev) => prev.map((c) => (c.id === id ? deactivated : c)));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => list.map((c) => (c.id === prev.id ? prev : c)));
        }
      },
      syncDexie: async () => {
        await db().customers.put(deactivated);
        await db().parties.put(deactivated);
        if (activeCompany?.id && user?.uid) {
          await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "customer", entityId: id, data: deactivated });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().customers.put(prev);
          await db().parties.put(prev);
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await set(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${id}`), sanitizeForFirebase(deactivated));
          await set(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`), sanitizeForFirebase(deactivated));
        }
      },
      queryKeys: [["customers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
      successToast: `Customer "${customer.name}" deactivated`,
      errorToast: "Couldn't deactivate customer. Changes reverted.",
    });
  }

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Customer name is required");
      return;
    }

    setSaving(true);
    try {
      let linkedLedgerId: string | undefined = undefined;

      // 1. Atomic Customer + Accounts Receivable Ledger creation
      if (activeCompany?.id && user?.uid) {
        const res = await createCustomerWithLedger({
          companyId: activeCompany.id,
          customer: {
            ...editing,
            name: editing.name.trim(),
          },
          uid: user.uid,
          idempotencyKey: `mut_cust_${editing.id}`,
        });
        if (res.success && res.ledgerId) {
          linkedLedgerId = res.ledgerId;
        }
      }

      const customerToSave: Customer = {
        ...editing,
        name: editing.name.trim(),
        ledgerId: linkedLedgerId || editing.ledgerId,
        active: editing.active !== false,
      };

      const isNew =
        !rows.some((c) => c.id === customerToSave.id) &&
        !dexieRows.some((c) => c.id === customerToSave.id);

      await performOptimisticMutation<Customer>({
        entityType: "customer",
        entityId: customerToSave.id,
        action: isNew ? "create" : "update",
        companyId: activeCompany?.id,
        uid: user?.uid,
        optimisticData: customerToSave,
        onOptimistic: () => {
          setCloudRows((prev) => {
            const exists = prev.some((c) => c.id === customerToSave.id);
            if (exists) {
              return prev.map((c) => (c.id === customerToSave.id ? customerToSave : c));
            } else {
              return [customerToSave, ...prev];
            }
          });
        },
        onRollback: (prev) => {
          setCloudRows((prevList) => {
            if (isNew) {
              return prevList.filter((c) => c.id !== customerToSave.id);
            } else if (prev) {
              return prevList.map((c) => (c.id === prev.id ? prev : c));
            }
            return prevList;
          });
        },
        syncDexie: async () => {
          await db().customers.put(customerToSave);
          await db().parties.put(customerToSave);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "customer",
              entityId: customerToSave.id,
              data: customerToSave,
            });
          }
        },
        rollbackDexie: async (prev) => {
          if (isNew) {
            await db().customers.delete(customerToSave.id);
            await db().parties.delete(customerToSave.id);
            if (activeCompany?.id) {
              await removeCachedEntity({ companyId: activeCompany.id, entityType: "customer", entityId: customerToSave.id });
            }
          } else if (prev) {
            await db().customers.put(prev);
          }
        },
        serverMutation: async () => {
          if (activeCompany?.id && firebaseDb) {
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${customerToSave.id}`), sanitizeForFirebase(customerToSave));
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${customerToSave.id}`), sanitizeForFirebase(customerToSave));
          }
        },
        queryKeys: [["customers", activeCompany?.id], ["parties", activeCompany?.id], ["dashboard", activeCompany?.id]],
        successToast: isNew ? "Customer saved & linked to Accounts Receivable" : "Customer updated",
        errorToast: "Unable to save customer. Please check your connection.",
      });

      setOpen(false);
    } catch (err) {
      console.error("Failed to save customer:", err);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => r.active !== false).length;
  const inactiveCount = rows.filter((r) => r.active === false).length;

  return (
    <AppShell title="Customers">
      <PageHeader
        title="Customers"
        description="Manage customer directory with automatic Accounts Receivable ledger linking."
        actions={
          <Button onClick={openNew} className="gap-2 shadow-sm">
            <UserPlus className="h-4 w-4" /> Add customer
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex-1">
          <ListToolbar query={q} onQuery={setQ} placeholder="Search by name, company, mobile, GST, email…" />
        </div>
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)} className="w-full sm:w-auto">
          <TabsList className="h-9 w-full sm:w-auto text-xs grid grid-cols-3">
            <TabsTrigger value="ACTIVE">Active ({activeCount})</TabsTrigger>
            <TabsTrigger value="ALL">All ({rows.length})</TabsTrigger>
            <TabsTrigger value="INACTIVE">Inactive ({inactiveCount})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === "INACTIVE" ? "No inactive customers" : "No customers yet"}
          description={
            statusFilter === "INACTIVE"
              ? "All customers are currently active."
              : q
              ? `No customers matching "${q}".`
              : "Add your first customer to start creating invoices and quotations."
          }
          action={
            statusFilter !== "INACTIVE" && !q ? (
              <Button onClick={openNew} className="mt-2 gap-2">
                <Plus className="h-4 w-4" /> Add customer
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Location</TableHead>
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
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerIdForDrawer(r.id)}
                            className="font-semibold text-foreground hover:text-primary hover:underline text-left"
                          >
                            {r.name}
                          </button>
                          {isInactive && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        {r.company ? <div className="text-xs text-muted-foreground">{r.company}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.mobile ? <div>{r.mobile}</div> : null}
                        {r.email ? <div className="text-muted-foreground">{r.email}</div> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.gstin || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-primary"
                            title="View Customer Profile & Ledger"
                            onClick={() => setSelectedCustomerIdForDrawer(r.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit Customer"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            title={isInactive ? "Delete Customer" : "Delete or Deactivate Customer"}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{rows.find((r) => r.id === editing.id) ? "Edit Customer" : "Add Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Person or Legal Name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name</Label>
              <Input
                value={editing.company ?? ""}
                onChange={(e) => setEditing({ ...editing, company: e.target.value })}
                placeholder="Enterprise Ltd"
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
                placeholder="billing@customer.com"
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
            <div className="space-y-1">
              <Label className="text-xs">PAN</Label>
              <Input
                value={editing.pan ?? ""}
                onChange={(e) => setEditing({ ...editing, pan: e.target.value.toUpperCase() })}
                placeholder="ABCDE1234F"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Billing Address</Label>
              <Textarea
                rows={2}
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="Street address, building, floor"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                placeholder="Mumbai"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State</Label>
              <Input
                value={editing.state ?? ""}
                onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                placeholder="Maharashtra"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Country</Label>
              <Input
                value={editing.country ?? "India"}
                onChange={(e) => setEditing({ ...editing, country: e.target.value })}
                placeholder="India"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pincode</Label>
              <Input
                value={editing.pincode ?? ""}
                onChange={(e) => setEditing({ ...editing, pincode: e.target.value })}
                placeholder="400001"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Limit (₹)</Label>
              <Input
                type="number"
                value={editing.creditLimit || ""}
                onChange={(e) => setEditing({ ...editing, creditLimit: Number(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Days</Label>
              <Input
                type="number"
                min="0"
                value={typeof editing.creditDays === "number" ? editing.creditDays : 0}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setEditing({ ...editing, creditDays: isNaN(val) ? 0 : Math.max(0, val) });
                }}
                placeholder="0"
              />
              <p className="text-[10px] text-muted-foreground">0 = payment due immediately</p>
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
                  Saving Customer…
                </>
              ) : (
                "Save Customer"
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
            ? `Deactivate "${deleteTarget.customer.name}"?`
            : `Delete "${deleteTarget?.customer.name}"?`
        }
        description={
          deleteTarget?.usage.hasHistory
            ? deleteTarget.usage.reason
            : `"${deleteTarget?.customer.name}" will be permanently removed from customer records.`
        }
        destructive={!deleteTarget?.usage.hasHistory}
        confirmText={deleteTarget?.usage.hasHistory ? "Deactivate" : "Delete Customer"}
        busyText={deleteTarget?.usage.hasHistory ? "Deactivating…" : "Deleting…"}
        onConfirm={async () => {
          if (!deleteTarget) return;
          if (deleteTarget.usage.hasHistory) {
            await deactivateCustomer(deleteTarget.customer);
          } else {
            await removeCustomerPermanent(deleteTarget.customer);
          }
          setDeleteTarget(null);
        }}
      />

      <CustomerInsightDrawer
        customerId={selectedCustomerIdForDrawer}
        open={Boolean(selectedCustomerIdForDrawer)}
        onOpenChange={(o) => !o && setSelectedCustomerIdForDrawer(null)}
      />
    </AppShell>
  );
}
