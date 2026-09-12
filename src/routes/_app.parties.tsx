import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, uid, type Party, type PartyType, type PaymentPolicy, type PartyAddress } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ListToolbar, EmptyState, usePagination, Pager } from "@/components/app/ListHelpers";
import { Pencil, Plus, Trash2, Users, MapPin, Eye, ShieldCheck, Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, onValue, off, set, remove as rtdbRemove } from "firebase/database";
import { cacheEntity, cacheEntitiesBulk, getCachedEntities, removeCachedEntity } from "@/modules/sync/dexieCache";
import { createPartyWithLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { CustomerInsightDrawer } from "@/components/app/CustomerInsightDrawer";
import { AddressDrawer } from "@/components/app/AddressDrawer";
import { isIndia, getPostalCodeLabel, getPostalCodePlaceholder, validatePostalCode } from "@/lib/countryValidation";

export const Route = createFileRoute("/_app/parties")({
  head: () => ({ meta: [{ title: "Party Master — BMS NEXT" }] }),
  component: PartiesPage,
});

const emptyParty: Party = {
  id: "",
  name: "",
  tradingName: "",
  partyType: "CUSTOMER",
  paymentPolicy: "CREDIT",
  mobile: "",
  phone: "",
  alternatePhone: "",
  email: "",
  gstin: "",
  pan: "",
  company: "",
  address: "",
  billingAddress: "",
  shippingAddress: "",
  city: "",
  district: "",
  state: "",
  stateCode: "",
  country: "India",
  pincode: "",
  contactPerson: "",
  creditLimit: 0,
  creditDays: 30,
  openingBalance: 0,
  taxRegistrationType: "regular",
  createdAt: 0,
};

export function PartiesPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Party>(() => db().parties.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Party[]>([]);
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "CUSTOMER" | "SUPPLIER" | "ADVANCE" | "CREDIT">("ALL");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Party>(emptyParty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPartyForInsight, setSelectedPartyForInsight] = useState<string | null>(null);
  const [partyForAddressDrawer, setPartyForAddressDrawer] = useState<Party | null>(null);
  const [addressDrawerOpen, setAddressDrawerOpen] = useState(false);

  // 1. Initial cached retrieval + Realtime Firebase sync
  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    getCachedEntities<Party>({
      uid: user.uid,
      companyId: activeCompany.id,
      entityType: "party",
    }).then((cached) => {
      if (active && cached.length > 0) {
        setCloudRows(cached);
      }
    });

    const rtdb = firebaseDb;
    if (!rtdb) return;

    const partiesRef = ref(rtdb, `companyData/${activeCompany.id}/parties`);
    const onData = (snap: any) => {
      if (!active) return;
      if (snap.exists()) {
        const val = snap.val();
        const list: Party[] = Object.values(val);
        setCloudRows(list);

        cacheEntitiesBulk(
          list.map((p) => ({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "party",
            entityId: p.id,
            data: p,
          }))
        );

        for (const p of list) {
          db().parties.put(p);
          if (p.partyType === "CUSTOMER" || p.partyType === "BOTH") {
            db().customers.put(p as any);
          }
          if (p.partyType === "SUPPLIER" || p.partyType === "BOTH") {
            db().suppliers.put(p as any);
          }
        }
      } else {
        // Fallback: If no dedicated /parties yet, hydrate from /customers and /suppliers
        const customersRef = ref(rtdb, `companyData/${activeCompany.id}/customers`);
        onValue(customersRef, (custSnap) => {
          if (!active) return;
          if (custSnap.exists()) {
            const custList: Party[] = Object.values(custSnap.val()).map((c: any) => ({
              ...c,
              partyType: c.partyType || "CUSTOMER",
              paymentPolicy: c.paymentPolicy || "CREDIT",
              country: c.country || "India",
            }));
            setCloudRows(custList);
            for (const p of custList) {
              db().parties.put(p);
            }
          }
        }, { onlyOnce: true });
      }
    };

    onValue(partiesRef, onData);

    return () => {
      active = false;
      off(partiesRef, "value", onData);
    };
  }, [activeCompany?.id, user?.uid]);

  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

  // Filter based on tab and search
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // Tab filter
      if (activeTab === "CUSTOMER" && r.partyType !== "CUSTOMER" && r.partyType !== "BOTH") return false;
      if (activeTab === "SUPPLIER" && r.partyType !== "SUPPLIER" && r.partyType !== "BOTH") return false;
      if (activeTab === "ADVANCE" && r.paymentPolicy !== "ADVANCE") return false;
      if (activeTab === "CREDIT" && r.paymentPolicy !== "CREDIT") return false;

      // Text query filter
      const s = q.toLowerCase().trim();
      if (!s) return true;
      return (
        r.name.toLowerCase().includes(s) ||
        (r.tradingName ?? "").toLowerCase().includes(s) ||
        (r.mobile ?? "").includes(s) ||
        (r.phone ?? "").includes(s) ||
        (r.email ?? "").toLowerCase().includes(s) ||
        (r.gstin ?? "").toLowerCase().includes(s) ||
        (r.city ?? "").toLowerCase().includes(s) ||
        (r.state ?? "").toLowerCase().includes(s) ||
        (r.country ?? "").toLowerCase().includes(s) ||
        (r.pincode ?? "").includes(s) ||
        (r.aliases ?? []).some((a) => a.toLowerCase().includes(s))
      );
    });
  }, [rows, activeTab, q]);

  const pager = usePagination(filtered, 12);

  function openNew() {
    setEditing({
      ...emptyParty,
      id: uid(),
      state: activeCompany?.state || "",
      country: activeCompany?.country || "India",
      createdAt: Date.now(),
    });
    setOpen(true);
  }

  function openEdit(r: Party) {
    setEditing({
      ...r,
      country: r.country || activeCompany?.country || "India",
      paymentPolicy: r.paymentPolicy || "CREDIT",
      partyType: r.partyType || "CUSTOMER",
    });
    setOpen(true);
  }

  async function save() {
    if (!editing.name.trim()) {
      toast.error("Party Name is required");
      return;
    }
    if (!editing.country?.trim()) {
      toast.error("Country is mandatory per client requirements");
      return;
    }
    const postalVal = validatePostalCode(editing.pincode, editing.country, { required: false });
    if (!postalVal.valid) {
      toast.error(postalVal.error || "Invalid postal code");
      return;
    }

    setSaving(true);
    try {
      const partyData: Party = {
        ...editing,
        name: editing.name.trim(),
        tradingName: editing.tradingName?.trim() || undefined,
        partyType: editing.partyType || "CUSTOMER",
        paymentPolicy: editing.paymentPolicy || "CREDIT",
        country: editing.country.trim() || "India",
        pincode: editing.pincode?.trim() || undefined,
        gstin: editing.gstin?.trim() ? editing.gstin.trim().toUpperCase() : undefined,
        creditLimit: Number(editing.creditLimit) || 0,
        creditDays: Number(editing.creditDays) || 30,
        updatedAt: Date.now(),
      };

      if (activeCompany?.id && user?.uid) {
        await createPartyWithLedger({
          companyId: activeCompany.id,
          party: partyData,
          uid: user.uid,
          idempotencyKey: `mut_party_${partyData.id}`,
        });
      }

      await db().parties.put(partyData);
      if (partyData.partyType === "CUSTOMER" || partyData.partyType === "BOTH") {
        await db().customers.put(partyData as any);
      }
      if (partyData.partyType === "SUPPLIER" || partyData.partyType === "BOTH") {
        await db().suppliers.put(partyData as any);
      }

      toast.success(`Party "${partyData.name}" saved successfully`);
      setOpen(false);
    } catch (err) {
      console.error("Failed to save party:", err);
      toast.error("Unable to save party. Draft preserved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Party Master">
      <div className="space-y-4">
        <PageHeader
          title="Party Master"
          description="Unified business ledger directory for Customers and Suppliers with Advance/Credit policy control and address reuse."
          actions={
            <Button onClick={openNew} className="gap-1.5 shadow-sm">
              <Plus className="h-4 w-4" /> Add Party
            </Button>
          }
        />

        {/* Tab Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full sm:w-auto">
            <TabsList className="grid grid-cols-5 w-full sm:w-auto text-xs">
              <TabsTrigger value="ALL">All ({rows.length})</TabsTrigger>
              <TabsTrigger value="CUSTOMER">Customers</TabsTrigger>
              <TabsTrigger value="SUPPLIER">Suppliers</TabsTrigger>
              <TabsTrigger value="ADVANCE" className="text-emerald-600 dark:text-emerald-400">
                Advance
              </TabsTrigger>
              <TabsTrigger value="CREDIT">Credit</TabsTrigger>
            </TabsList>
          </Tabs>

          <Input
            placeholder="Search party by name, GSTIN, city, country, pincode..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-full sm:w-72 text-xs"
          />
        </div>

        {/* Parties Table */}
        <Card className="p-0 overflow-hidden shadow-xs">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs font-semibold">Party Name</TableHead>
                <TableHead className="text-xs font-semibold">Type</TableHead>
                <TableHead className="text-xs font-semibold">Payment Policy</TableHead>
                <TableHead className="text-xs font-semibold">GSTIN / State</TableHead>
                <TableHead className="text-xs font-semibold">Location</TableHead>
                <TableHead className="text-xs font-semibold">Contact</TableHead>
                <TableHead className="text-right text-xs font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-xs text-muted-foreground">
                    No parties match the current filter or search.
                  </TableCell>
                </TableRow>
              ) : (
                pager.items.map((party: Party) => (
                  <TableRow key={party.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="py-2.5">
                      <div className="font-semibold text-xs text-foreground">{party.name}</div>
                      {party.tradingName && (
                        <div className="text-[10px] text-muted-foreground">T/A: {party.tradingName}</div>
                      )}
                    </TableCell>

                    <TableCell className="py-2.5">
                      <Badge
                        variant={party.partyType === "BOTH" ? "default" : "secondary"}
                        className="text-[10px] font-medium"
                      >
                        {party.partyType || "CUSTOMER"}
                      </Badge>
                    </TableCell>

                    <TableCell className="py-2.5">
                      {party.paymentPolicy === "ADVANCE" ? (
                        <Badge variant="outline" className="text-[10px] font-semibold border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1">
                          <Wallet className="h-2.5 w-2.5" /> ADVANCE
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-semibold border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400">
                          CREDIT ({party.creditDays ?? 30}d)
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="py-2.5 text-xs">
                      <div className="font-mono text-[11px]">{party.gstin || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{party.state || "—"}</div>
                    </TableCell>

                    <TableCell className="py-2.5 text-xs">
                      <div>{[party.city, party.pincode].filter(Boolean).join(" - ") || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{party.country || "India"}</div>
                    </TableCell>

                    <TableCell className="py-2.5 text-xs">
                      <div>{party.mobile || party.phone || "—"}</div>
                      {party.contactPerson && (
                        <div className="text-[10px] text-muted-foreground">{party.contactPerson}</div>
                      )}
                    </TableCell>

                    <TableCell className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="View Ledger & Profile"
                          onClick={() => setSelectedPartyForInsight(party.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-primary"
                          title="Manage Addresses"
                          onClick={() => {
                            setPartyForAddressDrawer(party);
                            setAddressDrawerOpen(true);
                          }}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit Party"
                          onClick={() => openEdit(party)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          title="Delete Party"
                          onClick={() => setDeleteId(party.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Pager page={pager.page} totalPages={pager.totalPages} next={pager.next} prev={pager.prev} />
        </Card>

        {/* Party Create / Edit Dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <Users className="h-5 w-5 text-primary" />
                {editing.id ? "Edit Party Master" : "Create New Party Master"}
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 py-2 text-xs">
              <div>
                <Label className="text-xs">Party Legal Name *</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Mars Engineering Ltd"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Trading Name / Brand (Optional)</Label>
                <Input
                  value={editing.tradingName || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, tradingName: e.target.value }))}
                  placeholder="e.g. Mars Tech"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Party Type *</Label>
                <Select
                  value={editing.partyType || "CUSTOMER"}
                  onValueChange={(val: PartyType) => setEditing((p) => ({ ...p, partyType: val }))}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CUSTOMER">Customer (Buyer)</SelectItem>
                    <SelectItem value="SUPPLIER">Supplier (Vendor)</SelectItem>
                    <SelectItem value="BOTH">Both (Customer & Supplier)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-primary">Payment Policy * (PRD § 10)</Label>
                <Select
                  value={editing.paymentPolicy || "CREDIT"}
                  onValueChange={(val: PaymentPolicy) => setEditing((p) => ({ ...p, paymentPolicy: val }))}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADVANCE">ADVANCE — Requires receipt before billing</SelectItem>
                    <SelectItem value="CREDIT">CREDIT — Invoice permitted prior to receipt</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editing.paymentPolicy === "CREDIT" && (
                <>
                  <div>
                    <Label className="text-xs">Credit Limit (₹)</Label>
                    <Input
                      type="number"
                      value={editing.creditLimit || ""}
                      onChange={(e) => setEditing((p) => ({ ...p, creditLimit: Number(e.target.value) }))}
                      placeholder="e.g. 200000"
                      className="mt-1 h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Credit Days</Label>
                    <Input
                      type="number"
                      value={editing.creditDays || ""}
                      onChange={(e) => setEditing((p) => ({ ...p, creditDays: Number(e.target.value) }))}
                      placeholder="e.g. 30"
                      className="mt-1 h-8"
                    />
                  </div>
                </>
              )}

              <div>
                <Label className="text-xs">GSTIN</Label>
                <Input
                  value={editing.gstin || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, gstin: e.target.value }))}
                  placeholder="15-digit GSTIN"
                  className="mt-1 h-8 font-mono"
                />
              </div>

              <div>
                <Label className="text-xs">PAN</Label>
                <Input
                  value={editing.pan || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, pan: e.target.value }))}
                  placeholder="10-digit PAN"
                  className="mt-1 h-8 font-mono"
                />
              </div>

              <div>
                <Label className="text-xs">Mobile / Phone</Label>
                <Input
                  value={editing.mobile || editing.phone || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, mobile: e.target.value, phone: e.target.value }))}
                  placeholder="Primary phone"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  value={editing.email || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))}
                  placeholder="billing@party.com"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Contact Person</Label>
                <Input
                  value={editing.contactPerson || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, contactPerson: e.target.value }))}
                  placeholder="Contact name"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Country * (Mandatory PRD § 5)</Label>
                <Input
                  value={editing.country || "India"}
                  onChange={(e) => setEditing((p) => ({ ...p, country: e.target.value }))}
                  placeholder="India"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">State *</Label>
                <Input
                  value={editing.state || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, state: e.target.value }))}
                  placeholder="State"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">City</Label>
                <Input
                  value={editing.city || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, city: e.target.value }))}
                  placeholder="City"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">{getPostalCodeLabel(editing.country)} {isIndia(editing.country) ? "(6 digits)" : ""}</Label>
                <Input
                  value={editing.pincode || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, pincode: e.target.value }))}
                  placeholder={getPostalCodePlaceholder(editing.country)}
                  className="mt-1 h-8"
                />
              </div>

              <div className="md:col-span-2">
                <Label className="text-xs">Billing Address Line 1</Label>
                <Input
                  value={editing.billingAddress || editing.address || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, billingAddress: e.target.value, address: e.target.value }))}
                  placeholder="Street, Building, Unit"
                  className="mt-1 h-8"
                />
              </div>

              <div className="md:col-span-2">
                <Label className="text-xs">Notes / Commercial Terms</Label>
                <Textarea
                  value={editing.notes || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Internal notes or agreed commercial terms..."
                  rows={2}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Save Party
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(o) => !o && setDeleteId(null)}
          title="Delete this Party?"
          destructive
          confirmText="Delete"
          onConfirm={async () => {
            if (!deleteId) return;
            await db().parties.delete(deleteId);
            await db().customers.delete(deleteId);
            await db().suppliers.delete(deleteId);
            if (activeCompany?.id && firebaseDb) {
              await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${deleteId}`));
              await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${deleteId}`));
              await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${deleteId}`));
            }
            toast.success("Party deleted");
            setDeleteId(null);
          }}
        />

        {/* Customer / Party Insight Drawer */}
        <CustomerInsightDrawer
          open={!!selectedPartyForInsight}
          onOpenChange={(o) => !o && setSelectedPartyForInsight(null)}
          customerId={selectedPartyForInsight}
        />

        {/* Address Drawer for adding multiple addresses */}
        <AddressDrawer
          open={addressDrawerOpen}
          onOpenChange={setAddressDrawerOpen}
          party={partyForAddressDrawer}
          onAddressSaved={(addr) => {
            if (partyForAddressDrawer) {
              const updated = {
                ...partyForAddressDrawer,
                addresses: [...(partyForAddressDrawer.addresses || []), addr],
              };
              setPartyForAddressDrawer(updated);
            }
          }}
        />
      </div>
    </AppShell>
  );
}
