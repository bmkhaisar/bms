import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Supplier } from "@/lib/db";
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
import { Pencil, Plus, Trash2, Truck, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, cacheEntitiesBulk, getCachedEntities, removeCachedEntity } from "@/modules/sync/dexieCache";
import { ensureSupplierLedger } from "@/modules/accounting/services/partyLedgerSyncService";

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
  createdAt: 0,
};

export function SuppliersPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 1. Initial cached retrieval + Realtime Firebase synchronization
  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    // Load from Dexie cache immediately for fast startup
    getCachedEntities<Supplier>({
      uid: user.uid,
      companyId: activeCompany.id,
      entityType: "supplier",
    }).then((cached) => {
      if (active && cached.length > 0) {
        setCloudRows(cached);
      }
    });

    if (!firebaseDb) return;

    const suppliersRef = ref(firebaseDb, `companyData/${activeCompany.id}/suppliers`);
    const onData = (snap: any) => {
      if (!active) return;
      if (snap.exists()) {
        const val = snap.val();
        const list: Supplier[] = Object.values(val);
        setCloudRows(list);

        // Update Dexie cache in background
        cacheEntitiesBulk(
          list.map((s) => ({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "supplier",
            entityId: s.id,
            data: s,
          }))
        );

        // Sync into local legacy Dexie store
        for (const s of list) {
          db().suppliers.put(s);
        }
      } else {
        setCloudRows([]);
      }
    };

    onValue(suppliersRef, onData);

    return () => {
      active = false;
      off(suppliersRef, "value", onData);
    };
  }, [activeCompany?.id, user?.uid]);

  // Prefer cloud/cached rows when active company is present
  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

  // Deep-link support: auto-filter and open supplier editor if id or q present in URL
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
    setEditing({ ...r });
    setOpen(true);
  }

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }

    setSaving(true);
    try {
      let linkedLedgerId: string | undefined = undefined;

      // Ensure Accounts Payable subledger is created/linked in Chart of Accounts
      if (activeCompany?.id && user?.uid) {
        linkedLedgerId = await ensureSupplierLedger({
          companyId: activeCompany.id,
          supplier: editing,
          uid: user.uid,
        });
      }

      const supplierToSave: Supplier = {
        ...editing,
        name: editing.name.trim(),
        ledgerId: linkedLedgerId,
      };

      // 1. Save to Firebase RTDB
      if (activeCompany?.id && firebaseDb) {
        const suppRef = ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${supplierToSave.id}`);
        await set(suppRef, supplierToSave);
      }

      // 2. Cache in local Dexie bms_cache_v1
      if (activeCompany?.id && user?.uid) {
        await cacheEntity({
          uid: user.uid,
          companyId: activeCompany.id,
          entityType: "supplier",
          entityId: supplierToSave.id,
          data: supplierToSave,
        });
      }

      // 3. Keep local legacy Dexie database updated
      await db().suppliers.put(supplierToSave);

      toast.success("Supplier saved & linked to Accounts Payable");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save supplier:", err);
      toast.error("Unable to save supplier. Please check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      if (activeCompany?.id && firebaseDb) {
        const suppRef = ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${id}`);
        await rtdbRemove(suppRef);
      }
      if (activeCompany?.id) {
        await removeCachedEntity({
          companyId: activeCompany.id,
          entityType: "supplier",
          entityId: id,
        });
      }
      await db().suppliers.delete(id);
      toast.success("Supplier deleted");
    } catch (err) {
      console.error("Failed to delete supplier:", err);
      toast.error("Unable to delete supplier");
    }
  }

  return (
    <AppShell title="Suppliers">
      <PageHeader
        title="Suppliers"
        description="Manage vendor directory with automatic Accounts Payable ledger linking."
        actions={
          <Button onClick={openNew} className="gap-2">
            <Truck className="h-4 w-4" /> Add supplier
          </Button>
        }
      />

      <ListToolbar query={q} onQuery={setQ} placeholder="Search by vendor name, company, mobile, GST…" />

      {rows.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          description="Add your first supplier to record purchase vouchers and track payables."
          action={
            <Button onClick={openNew} className="mt-2 gap-2">
              <Plus className="h-4 w-4" /> Add supplier
            </Button>
          }
        />
      ) : (
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Name / Entity</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Payable Ledger</TableHead>
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
                        <span>{r.ledgerId ? "Linked" : "Sundry Creditors"}</span>
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
            <DialogTitle>{editing.createdAt && editing.name ? "Edit Supplier" : "New Supplier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Supplier / Vendor Name *</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Business or Contact Name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company Name</Label>
              <Input
                value={editing.company ?? ""}
                onChange={(e) => setEditing({ ...editing, company: e.target.value })}
                placeholder="Enterprise or Registered Entity"
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
                placeholder="accounts@vendor.com"
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
              <Label className="text-xs">Address</Label>
              <Textarea
                rows={2}
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="Vendor registered address"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Delete Supplier?"
        description="This supplier will be removed. Existing historical transactions and ledgers will remain protected."
        onConfirm={() => {
          if (deleteId) remove(deleteId);
          setDeleteId(null);
        }}
      />
    </AppShell>
  );
}
