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
import { performOptimisticMutation } from "@/lib/mutationPipeline";
import { checkEntityHistoricalUsage, type HistoricalUsageResult } from "@/lib/historicalUsage";

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
  active: true,
  createdAt: 0,
};

export function PartiesPage() {
  const { user } = useAuth();
  const { activeCompany } = useActiveCompany();
  const dexieRows = useLive<Party>(() => db().parties.orderBy("name").toArray());
  const [cloudRows, setCloudRows] = useState<Party[]>([]);
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "CUSTOMER" | "SUPPLIER" | "ADVANCE" | "CREDIT" | "INACTIVE">("ALL");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Party>(emptyParty);
  const [saving, setSaving] = useState(false);
  const [selectedPartyForInsight, setSelectedPartyForInsight] = useState<string | null>(null);
  const [partyForAddressDrawer, setPartyForAddressDrawer] = useState<Party | null>(null);
  const [addressDrawerOpen, setAddressDrawerOpen] = useState(false);

  // Target for delete / deactivate modal
  const [deleteTarget, setDeleteTarget] = useState<{
    party: Party;
    usage: HistoricalUsageResult;
  } | null>(null);

  // 1. Initial cached retrieval + Realtime Firebase sync
  useEffect(() => {
    if (!activeCompany?.id || !user?.uid) return;

    let active = true;

    // Zero-flash immediate load from Dexie cache
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

  // Synchronize local dexieRows into cloudRows on mount if cloudRows was empty
  useEffect(() => {
    if (cloudRows.length === 0 && dexieRows.length > 0) {
      setCloudRows(dexieRows);
    }
  }, [dexieRows]);

  const rows = activeCompany?.id && cloudRows.length > 0 ? cloudRows : dexieRows;

  // Filter based on tab and search
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      // Status filter
      if (activeTab === "INACTIVE") {
        if (r.active !== false) return false;
      } else {
        if (r.active === false) return false; // Default: hide inactive from normal tabs
      }

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
      active: r.active !== false,
    });
    setOpen(true);
  }

  async function promptDelete(party: Party) {
    const usage = await checkEntityHistoricalUsage({
      entityType: "party",
      entityId: party.id,
    });
    setDeleteTarget({ party, usage });
  }

  async function removePartyPermanent(party: Party) {
    const id = party.id;
    await performOptimisticMutation<Party>({
      entityType: "party",
      entityId: id,
      action: "delete",
      companyId: activeCompany?.id,
      uid: user?.uid,
      capturePreviousState: () => party,
      onOptimistic: () => {
        // Immediate UI removal
        setCloudRows((prev) => prev.filter((p) => p.id !== id));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => [prev, ...list]);
        }
      },
      syncDexie: async () => {
        await db().parties.delete(id);
        await db().customers.delete(id);
        await db().suppliers.delete(id);
        if (activeCompany?.id) {
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "party", entityId: id });
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "customer", entityId: id });
          await removeCachedEntity({ companyId: activeCompany.id, entityType: "supplier", entityId: id });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().parties.put(prev);
          if (prev.partyType === "CUSTOMER" || prev.partyType === "BOTH") await db().customers.put(prev as any);
          if (prev.partyType === "SUPPLIER" || prev.partyType === "BOTH") await db().suppliers.put(prev as any);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "party", entityId: id, data: prev });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`));
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${id}`));
          await rtdbRemove(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${id}`));
        }
      },
      queryKeys: [
        ["parties", activeCompany?.id],
        ["customers", activeCompany?.id],
        ["suppliers", activeCompany?.id],
        ["dashboard", activeCompany?.id],
      ],
      successToast: `Party "${party.name}" deleted`,
      errorToast: "Couldn't delete party. It has been restored.",
    });
  }

  async function deactivateParty(party: Party) {
    const deactivatedParty: Party = { ...party, active: false };
    const id = party.id;

    await performOptimisticMutation<Party>({
      entityType: "party",
      entityId: id,
      action: "deactivate",
      companyId: activeCompany?.id,
      uid: user?.uid,
      optimisticData: deactivatedParty,
      capturePreviousState: () => party,
      onOptimistic: () => {
        setCloudRows((prev) => prev.map((p) => (p.id === id ? deactivatedParty : p)));
      },
      onRollback: (prev) => {
        if (prev) {
          setCloudRows((list) => list.map((p) => (p.id === prev.id ? prev : p)));
        }
      },
      syncDexie: async () => {
        await db().parties.put(deactivatedParty);
        if (deactivatedParty.partyType === "CUSTOMER" || deactivatedParty.partyType === "BOTH") {
          await db().customers.put(deactivatedParty as any);
        }
        if (deactivatedParty.partyType === "SUPPLIER" || deactivatedParty.partyType === "BOTH") {
          await db().suppliers.put(deactivatedParty as any);
        }
        if (activeCompany?.id && user?.uid) {
          await cacheEntity({
            uid: user.uid,
            companyId: activeCompany.id,
            entityType: "party",
            entityId: id,
            data: deactivatedParty,
          });
        }
      },
      rollbackDexie: async (prev) => {
        if (prev) {
          await db().parties.put(prev);
          if (prev.partyType === "CUSTOMER" || prev.partyType === "BOTH") await db().customers.put(prev as any);
          if (prev.partyType === "SUPPLIER" || prev.partyType === "BOTH") await db().suppliers.put(prev as any);
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({ uid: user.uid, companyId: activeCompany.id, entityType: "party", entityId: id, data: prev });
          }
        }
      },
      serverMutation: async () => {
        if (activeCompany?.id && firebaseDb) {
          await set(ref(firebaseDb, `companyData/${activeCompany.id}/parties/${id}`), sanitizeForFirebase(deactivatedParty));
          if (deactivatedParty.partyType === "CUSTOMER" || deactivatedParty.partyType === "BOTH") {
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/customers/${id}`), sanitizeForFirebase(deactivatedParty));
          }
          if (deactivatedParty.partyType === "SUPPLIER" || deactivatedParty.partyType === "BOTH") {
            await set(ref(firebaseDb, `companyData/${activeCompany.id}/suppliers/${id}`), sanitizeForFirebase(deactivatedParty));
          }
        }
      },
      queryKeys: [
        ["parties", activeCompany?.id],
        ["customers", activeCompany?.id],
        ["suppliers", activeCompany?.id],
        ["dashboard", activeCompany?.id],
      ],
      successToast: `Party "${party.name}" deactivated`,
      errorToast: "Couldn't deactivate party. Changes reverted.",
    });
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
        active: editing.active !== false,
        updatedAt: Date.now(),
      };

      const isNew =
        !cloudRows.some((p) => p.id === partyData.id) &&
        !dexieRows.some((p) => p.id === partyData.id);

      await performOptimisticMutation<Party>({
        entityType: "party",
        entityId: partyData.id,
        action: isNew ? "create" : "update",
        companyId: activeCompany?.id,
        uid: user?.uid,
        optimisticData: partyData,
        onOptimistic: () => {
          setCloudRows((prev) => {
            const exists = prev.some((p) => p.id === partyData.id);
            if (exists) {
              return prev.map((p) => (p.id === partyData.id ? partyData : p));
            } else {
              return [partyData, ...prev];
            }
          });
        },
        onRollback: (prev) => {
          setCloudRows((prevList) => {
            if (isNew) {
              return prevList.filter((p) => p.id !== partyData.id);
            } else if (prev) {
              return prevList.map((p) => (p.id === prev.id ? prev : p));
            }
            return prevList;
          });
        },
        syncDexie: async () => {
          await db().parties.put(partyData);
          if (partyData.partyType === "CUSTOMER" || partyData.partyType === "BOTH") {
            await db().customers.put(partyData as any);
          }
          if (partyData.partyType === "SUPPLIER" || partyData.partyType === "BOTH") {
            await db().suppliers.put(partyData as any);
          }
          if (activeCompany?.id && user?.uid) {
            await cacheEntity({
              uid: user.uid,
              companyId: activeCompany.id,
              entityType: "party",
              entityId: partyData.id,
              data: partyData,
            });
          }
        },
        rollbackDexie: async (prev) => {
          if (isNew) {
            await db().parties.delete(partyData.id);
            await db().customers.delete(partyData.id);
            await db().suppliers.delete(partyData.id);
            if (activeCompany?.id) {
              await removeCachedEntity({ companyId: activeCompany.id, entityType: "party", entityId: partyData.id });
            }
          } else if (prev) {
            await db().parties.put(prev);
            if (prev.partyType === "CUSTOMER" || prev.partyType === "BOTH") await db().customers.put(prev as any);
            if (prev.partyType === "SUPPLIER" || prev.partyType === "BOTH") await db().suppliers.put(prev as any);
          }
        },
        serverMutation: async () => {
          if (activeCompany?.id && user?.uid) {
            await createPartyWithLedger({
              companyId: activeCompany.id,
              party: partyData,
              uid: user.uid,
              idempotencyKey: `mut_party_${partyData.id}`,
            });
          }
        },
        queryKeys: [
          ["parties", activeCompany?.id],
          ["customers", activeCompany?.id],
          ["suppliers", activeCompany?.id],
          ["dashboard", activeCompany?.id],
        ],
        successToast: `Party "${partyData.name}" saved successfully`,
        errorToast: "Unable to save party. Draft preserved.",
      });

      setOpen(false);
    } catch (err) {
      console.error("Failed to save party:", err);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => r.active !== false).length;
  const inactiveCount = rows.filter((r) => r.active === false).length;

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
            <TabsList className="grid grid-cols-6 w-full sm:w-auto text-xs">
              <TabsTrigger value="ALL">All ({activeCount})</TabsTrigger>
              <TabsTrigger value="CUSTOMER">Customers</TabsTrigger>
              <TabsTrigger value="SUPPLIER">Suppliers</TabsTrigger>
              <TabsTrigger value="ADVANCE" className="text-emerald-600 dark:text-emerald-400">
                Advance
              </TabsTrigger>
              <TabsTrigger value="CREDIT">Credit</TabsTrigger>
              <TabsTrigger value="INACTIVE">Inactive ({inactiveCount})</TabsTrigger>
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
        <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="font-semibold text-xs">Party Name</TableHead>
                <TableHead className="font-semibold text-xs">Type</TableHead>
                <TableHead className="font-semibold text-xs">Policy</TableHead>
                <TableHead className="font-semibold text-xs">GSTIN / State</TableHead>
                <TableHead className="font-semibold text-xs">Location</TableHead>
                <TableHead className="font-semibold text-xs">Contact</TableHead>
                <TableHead className="font-semibold text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-xs">
                    {activeTab === "INACTIVE"
                      ? "No inactive parties found."
                      : q
                      ? `No parties found matching "${q}".`
                      : "No parties configured yet. Click 'Add Party' to create one."}
                  </TableCell>
                </TableRow>
              ) : (
                pager.items.map((party) => {
                  const isInactive = party.active === false;
                  return (
                    <TableRow key={party.id} className={isInactive ? "opacity-60 bg-muted/20 hover:bg-muted/30" : "hover:bg-muted/20"}>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedPartyForInsight(party.id)}
                            className="text-left font-medium text-xs text-foreground hover:text-primary hover:underline"
                          >
                            {party.name}
                          </button>
                          {isInactive && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        {party.tradingName && (
                          <div className="text-[11px] text-muted-foreground">{party.tradingName}</div>
                        )}
                        {party.addresses && party.addresses.length > 0 && (
                          <div className="text-[10px] text-primary/80 flex items-center gap-0.5 mt-0.5">
                            <MapPin className="h-2.5 w-2.5" />
                            {party.addresses.length} address{party.addresses.length > 1 ? "es" : ""} saved
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="py-2.5 text-xs">
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase font-semibold ${
                            party.partyType === "BOTH"
                              ? "border-purple-500 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30"
                              : party.partyType === "SUPPLIER"
                              ? "border-sky-500 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30"
                              : "border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                          }`}
                        >
                          {party.partyType === "BOTH"
                            ? "Cust + Supp"
                            : party.partyType || "Customer"}
                        </Badge>
                      </TableCell>

                      <TableCell className="py-2.5 text-xs">
                        {party.paymentPolicy === "ADVANCE" ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-[10px] gap-1 shadow-xs">
                            <Wallet className="h-3 w-3" />
                            Advance Only
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <ShieldCheck className="h-3 w-3 text-muted-foreground" />
                            Credit ({party.creditDays || 30}d)
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
                            title={isInactive ? "Delete Party" : "Delete or Deactivate Party"}
                            onClick={() => promptDelete(party)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
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
                {editing.id && rows.some(r => r.id === editing.id) ? "Edit Party Master" : "Create New Party Master"}
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
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CUSTOMER">Customer (Accounts Receivable)</SelectItem>
                    <SelectItem value="SUPPLIER">Supplier (Accounts Payable)</SelectItem>
                    <SelectItem value="BOTH">Both (Customer & Supplier Linked)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Payment Policy *</Label>
                <Select
                  value={editing.paymentPolicy || "CREDIT"}
                  onValueChange={(val: PaymentPolicy) => setEditing((p) => ({ ...p, paymentPolicy: val }))}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREDIT">Standard Credit (Post Bills & Track Due)</SelectItem>
                    <SelectItem value="ADVANCE">Advance Required (Strict Pre-Payment)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">GSTIN / Tax ID</Label>
                <Input
                  value={editing.gstin || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                  placeholder="27ABCDE1234F1Z5"
                  className="mt-1 h-8 font-mono"
                  maxLength={15}
                />
              </div>

              <div>
                <Label className="text-xs">PAN</Label>
                <Input
                  value={editing.pan || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, pan: e.target.value.toUpperCase() }))}
                  placeholder="ABCDE1234F"
                  className="mt-1 h-8 font-mono"
                  maxLength={10}
                />
              </div>

              <div>
                <Label className="text-xs">Mobile Number</Label>
                <Input
                  value={editing.mobile || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, mobile: e.target.value }))}
                  placeholder="+91 98765 43210"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Email Address</Label>
                <Input
                  value={editing.email || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, email: e.target.value }))}
                  placeholder="billing@marseng.com"
                  className="mt-1 h-8"
                />
              </div>

              <div className="md:col-span-2">
                <Label className="text-xs">Primary Billing Address</Label>
                <Textarea
                  value={editing.address || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Street name, plot number, industrial area..."
                  rows={2}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">City</Label>
                <Input
                  value={editing.city || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, city: e.target.value }))}
                  placeholder="Mumbai"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">State / Province</Label>
                <Input
                  value={editing.state || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, state: e.target.value }))}
                  placeholder="Maharashtra"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Country *</Label>
                <Input
                  value={editing.country || "India"}
                  onChange={(e) => setEditing((p) => ({ ...p, country: e.target.value }))}
                  placeholder="India, UAE, USA..."
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">{getPostalCodeLabel(editing.country)}</Label>
                <Input
                  value={editing.pincode || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, pincode: e.target.value }))}
                  placeholder={getPostalCodePlaceholder(editing.country)}
                  className="mt-1 h-8 font-mono"
                />
              </div>

              <div>
                <Label className="text-xs">Credit Limit (₹)</Label>
                <Input
                  type="number"
                  value={editing.creditLimit || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, creditLimit: Number(e.target.value) || 0 }))}
                  placeholder="0.00"
                  className="mt-1 h-8"
                />
              </div>

              <div>
                <Label className="text-xs">Credit Days</Label>
                <Input
                  type="number"
                  value={editing.creditDays || ""}
                  onChange={(e) => setEditing((p) => ({ ...p, creditDays: Number(e.target.value) || 30 }))}
                  placeholder="30"
                  className="mt-1 h-8"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 mt-3">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving} className="text-xs">
                Cancel
              </Button>
              <Button onClick={save} disabled={saving} className="text-xs">
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Saving Party…
                  </>
                ) : (
                  "Save Party"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Target-Specific Confirmation Dialog */}
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={
            deleteTarget?.usage.hasHistory
              ? `Deactivate "${deleteTarget.party.name}"?`
              : `Delete "${deleteTarget?.party.name}"?`
          }
          description={
            deleteTarget?.usage.hasHistory
              ? deleteTarget.usage.reason
              : `"${deleteTarget?.party.name}" will be permanently deleted from party records.`
          }
          destructive={!deleteTarget?.usage.hasHistory}
          confirmText={deleteTarget?.usage.hasHistory ? "Deactivate" : "Delete Party"}
          busyText={deleteTarget?.usage.hasHistory ? "Deactivating…" : "Deleting…"}
          onConfirm={async () => {
            if (!deleteTarget) return;
            if (deleteTarget.usage.hasHistory) {
              await deactivateParty(deleteTarget.party);
            } else {
              await removePartyPermanent(deleteTarget.party);
            }
            setDeleteTarget(null);
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
