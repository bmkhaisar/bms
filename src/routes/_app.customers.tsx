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
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ListToolbar, EmptyState, usePagination, Pager } from "@/components/app/ListHelpers";
import { Pencil, Plus, Trash2, UserPlus, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, cacheEntitiesBulk, getCachedEntities, removeCachedEntity } from "@/modules/sync/dexieCache";
import { ensureCustomerLedger } from "@/modules/accounting/services/partyLedgerSyncService";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "Customers — BMS NEXT" }] }),
  component: CustomersPage,
});

const empty: Customer = {
  id: "",
  name: "",
  mobile: "",
  email: "",
  gstin: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  company: "",
  openingBalance: 0,
  createdAt: 0,
};

export function CustomersPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 1. Initial cached retrieval + Realtime Firebase synchronization
  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    // Load from Dexie cache immediately for fast startup
    getCachedEntities<Customer>({
      uid: user.uid,
      companyId: activeCompany.id,
      entityType: "customer",
    }).then((cached) => {
      if (active && cached.length > 0) {
        setCloudRows(cached);
      }
    });

    if (!firebaseDb) return;

    const customersRef = ref(firebaseDb, `companyData/${activeCompany.id}/customers`);
    const onData = (snap: any) => {
      if (!active) return;
      if (snap.exists()) {
        const val = snap.val();
        const list: Customer[] = Object.values(val);
        setCloudRows(list);

        // Update Dexie cache in background
        cacheEntitiesBulk(
          list.map((c) => ({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "customer",
            entityId: c.id,
            data: c,
          }))
        );

        // Sync into local legacy Dexie store for seamless compatibility
        for (const c of list) {
          db().customers.put(c);
        }
      } else {
        setCloudRows([]);
      }
    };

    onValue(customersRef, onData);

    return () => {
      active = false;
      off(customersRef, "value", onData);
    };
  }, [activeCompany?.id, user?.uid]);

  // Combine rows preferring cloud/cache when active company exists, else dexie fallback
  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

  // Deep-link support: auto-filter and open customer editor if id or q present in URL
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
    const s = q.toLowerCase();
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
    setEditing({ ...r });
    setOpen(true);
  }

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Customer name is required");
      return;
    }

    setSaving(true);
    try {
      let linkedLedgerId: string | undefined = undefined;

      // Ensure Accounts Receivable subledger is created/linked in Chart of Accounts
      if (activeCompany?.id && user?.uid) {
        linkedLedgerId = await ensureCustomerLedger({
          companyId: activeCompany.id,
          customer: editing,
          uid: user.uid,
        });
      }

      const customerToSave: Customer = {
        ...editing,
        name: editing.name.trim(),
        ledgerId: linkedLedgerId,
      };

      // 1. Save to Firebase RTDB
      if (activeCompany?.id && firebaseDb) {
        const custRef = ref(firebaseDb, `companyData/${activeCompany.id}/customers/${customerToSave.id}`);
        await set(custRef, customerToSave);
      }

      // 2. Cache in local Dexie bms_cache_v1
      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "customer",
          entityId: customerToSave.id,
          data: customerToSave,
        });
      }

      // 3. Keep local legacy Dexie database updated
      await db().customers.put(customerToSave);

      toast.success("Customer saved & linked to Accounts Receivable");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save customer:", err);
      toast.error("Unable to save customer. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      if (activeCompany?.id && firebaseDb) {
        const custRef = ref(firebaseDb, `companyData/${activeCompany.id}/customers/${id}`);
        await rtdbRemove(custRef);
      }
      if (activeCompany?.id) {
        await removeCachedEntity({
          companyId: activeCompany.id,
          entityType: "customer",
          entityId: id,
        });
      }
      await db().customers.delete(id);
      toast.success("Customer deleted");
    } catch (err) {
      console.error("Failed to delete customer:", err);
      toast.error("Unable to delete customer");
    }
  }

  return (
    <AppShell title="Customers">
      <PageHeader
        title="Customers"
        description="Manage customer directory with automatic Accounts Receivable ledger linking."
        actions={
          <Button onClick={openNew} className="gap-2">
            <UserPlus className="h-4 w-4" /> Add customer
          </Button>
        }
      />

      <ListToolbar query={q} onQuery={setQ} placeholder="Search by name, company, mobile, GST, email…" />

      {rows.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Add your first customer to start creating invoices and quotations."
          action={
            <Button onClick={openNew} className="mt-2 gap-2">
              <Plus className="h-4 w-4" /> Add customer
            </Button>
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name / Entity</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Receivable Ledger</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.company ? <div className="text-xs text-muted-foreground">{r.company}</div> : null}
                    </TableCell>
                    <TableCell>{r.mobile || "—"}</TableCell>
                    <TableCell>{r.email || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.gstin || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        <BookOpen className="h-3.5 w-3.5 text-primary" />
                        <span>{r.ledgerId ? "Linked" : "Sundry Debtors"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(r.openingBalance || 0)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      <Pager {...pager} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing.createdAt && editing.name ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Customer Name *</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Individual or Business Name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company / Trade Name</Label>
              <Input
                value={editing.company ?? ""}
                onChange={(e) => setEditing({ ...editing, company: e.target.value })}
                placeholder="Optional registered trade name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Mobile Number</Label>
              <Input
                value={editing.mobile ?? ""}
                onChange={(e) => setEditing({ ...editing, mobile: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email Address</Label>
              <Input
                type="email"
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
                placeholder="29AAAAA0000A1Z5"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Opening Balance (₹)</Label>
              <Input
                type="number"
                value={editing.openingBalance || ""}
                onChange={(e) => setEditing({ ...editing, openingBalance: Number(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs">Billing Address</Label>
              <Textarea
                rows={2}
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="Door/Street, Area"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                placeholder="City"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State</Label>
              <Input
                value={editing.state ?? ""}
                onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                placeholder="State"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete Customer?"
        description="This customer will be removed. Existing historical transactions and ledgers will remain protected."
        onConfirm={() => {
          if (deleteId) remove(deleteId);
          setDeleteId(null);
        }}
      />
    </AppShell>
  );
}
