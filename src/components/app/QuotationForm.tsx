import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, Copy, GripVertical, Save, X,
} from "lucide-react";
import { toast } from "sonner";
import { QuickCreateCustomerDrawer } from "./QuickCreateCustomerDrawer";
import { QuickCreateProductModal } from "./QuickCreateProductModal";
import { PartySearchSelect } from "./PartySearchSelect";
import { CustomerInsightDrawer } from "./CustomerInsightDrawer";
import { PartyAddressSelect } from "./PartyAddressSelect";
import { formatAddressLines } from "./AddressDrawer";
import { LineItemsEditor } from "./LineItemsEditor";
import { GeneralInformationEditor } from "./GeneralInformationEditor";
import { TechnicalSpecificationsEditor } from "./TechnicalSpecificationsEditor";
import { StructuredTermsEditor } from "./StructuredTermsEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  db, uid, type Quotation, type LineItem, type Customer, type Product, type ExtraCharge,
  type SizePreset, type TermsTemplate, type GeneralInfoTemplate, type TechSpecTemplate,
  type BankAccount, type QuotationTemplate, type TermItem, type GeneralInfoField, type TechSpecSection,
  type AddressSnapshot, type QuotationSection, type SectionRow, type StructuredTermItem,
} from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { computeLine, computeTotals, round2 } from "@/lib/calc";
import { formatMoney, toDateInput, fromDateInput } from "@/lib/format";

interface Props {
  initial: Quotation;
  onSave: (q: Quotation) => Promise<void> | void;
  onCancel: () => void;
}

export function QuotationForm({ initial, onSave, onCancel }: Props) {
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const sizes = useLive<SizePreset>(() => db().sizes.orderBy("label").toArray());
  const termsTemplates = useLive<TermsTemplate>(() => db().termsTemplates.orderBy("name").toArray());
  const genTemplates = useLive<GeneralInfoTemplate>(() => db().generalInfoTemplates.orderBy("name").toArray());
  const techTemplates = useLive<TechSpecTemplate>(() => db().techSpecTemplates.orderBy("name").toArray());
  const banks = useLive<BankAccount>(() => db().bankAccounts.orderBy("bankName").toArray());
  const quoteTemplates = useLive<QuotationTemplate>(() => db().quotationTemplates.orderBy("name").toArray());

  const [q, setQ] = useState<Quotation>(initial);
  const [saving, setSaving] = useState(false);
  const [rowIds, setRowIds] = useState<string[]>(() => initial.items.map(() => uid()));
  const [quickCustomerOpen, setQuickCustomerOpen] = useState(false);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [insightCustomerId, setInsightCustomerId] = useState<string | null>(null);
  const [pendingGstMode, setPendingGstMode] = useState<"item_wise" | "overall" | null>(null);

  useEffect(() => {
    setQ(initial);
    setRowIds(initial.items.map(() => uid()));
  }, [initial.id]);

  useEffect(() => {
    setRowIds(ids => q.items.map((_, idx) => ids[idx] || uid()));
  }, [q.items.length]);

  // Ensure ids stable on items for dnd
  const itemsWithIds = useMemo(
    () => q.items.map((it, idx) => ({ ...it, _rid: rowIds[idx] || `row-${idx}` })),
    [q.items, rowIds],
  );

  const totals = computeTotals(q.items, false, {
    gstCalculationMode: q.gstCalculationMode,
    overallGstRate: q.overallGstRate,
  });
  const extrasTotal = (q.extraCharges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const beforeRound = totals.subtotal - totals.discountTotal + totals.gstTotal + extrasTotal;
  const grand = Math.round(beforeRound);
  const roundOff = round2(grand - beforeRound);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function updateItem(i: number, patch: Partial<LineItem>) {
    setQ(prev => {
      const next = [...prev.items];
      next[i] = computeLine({ ...next[i], ...patch });
      return { ...prev, items: next };
    });
  }
  function addRow() {
    setRowIds(ids => [...ids, uid()]);
    setQ({ ...q, items: [...q.items, computeLine({ productId: "", name: "", quantity: 1, rate: 0, discountPct: 0, gstRate: 0, unit: "pcs" })] });
  }
  function pickProduct(i: number, productId: string) {
    const p = products.find(x => x.id === productId);
    if (!p) { updateItem(i, { productId: "" }); return; }
    updateItem(i, {
      productId: p.id, name: p.name, hsn: p.hsn, unit: p.unit, rate: p.sellingPrice, gstRate: p.gstRate,
      description: p.specifications || p.description || "",
    });
  }
  function duplicateRow(i: number) {
    const next = [...q.items];
    next.splice(i + 1, 0, { ...q.items[i] });
    setRowIds(ids => {
      const copy = [...ids];
      copy.splice(i + 1, 0, uid());
      return copy;
    });
    setQ({ ...q, items: next });
  }
  function removeRow(i: number) {
    const next = [...q.items]; next.splice(i, 1);
    setRowIds(ids => ids.filter((_, idx) => idx !== i));
    setQ({ ...q, items: next });
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = itemsWithIds.findIndex(it => it._rid === active.id);
    const to = itemsWithIds.findIndex(it => it._rid === over.id);
    if (from < 0 || to < 0) return;
    setRowIds(ids => arrayMove(ids, from, to));
    setQ({ ...q, items: arrayMove(q.items, from, to) });
  }
  async function saveSizeIfNew(label: string) {
    const t = label.trim();
    if (!t) return;
    if (sizes.some(s => s.label.toLowerCase() === t.toLowerCase())) return;
    await db().sizes.put({ id: uid(), label: t, createdAt: Date.now() });
    toast.success(`Saved size "${t}"`);
  }

  function applyTermsTemplate(id: string) {
    const t = termsTemplates.find(x => x.id === id);
    if (!t) return;
    setQ({
      ...q,
      termsTemplateId: id,
      termsSnapshot: t.terms.filter(x => x.enabled).map(x => x.text),
      terms: t.terms.filter(x => x.enabled).map((x, i) => `${i + 1}. ${x.text}`).join("\n"),
    });
  }
  function toggleTerm(text: string) {
    const list = q.termsSnapshot || [];
    const next = list.includes(text) ? list.filter(x => x !== text) : [...list, text];
    setQ({ ...q, termsSnapshot: next, terms: next.map((x, i) => `${i + 1}. ${x}`).join("\n") });
  }

  function applyGeneralInfo(id: string) {
    const t = genTemplates.find(x => x.id === id);
    if (!t) return;
    setQ({ ...q, generalInfoTemplateId: id, generalInfoSnapshot: [...t.fields] });
  }
  function updateGeneralField(i: number, patch: Partial<GeneralInfoField>) {
    const list = [...(q.generalInfoSnapshot || [])];
    list[i] = { ...list[i], ...patch };
    setQ({ ...q, generalInfoSnapshot: list });
  }

  function applyTechSpec(id: string) {
    const t = techTemplates.find(x => x.id === id);
    if (!t) return;
    if (t.kind === "electrical") {
      setQ({ ...q, electricalSnapshot: t.sections.map(s => ({ title: s.title, rows: [...s.rows] })) });
    } else {
      setQ({ ...q, techSpecTemplateId: id, techSpecSnapshot: t.sections.map(s => ({ title: s.title, rows: [...s.rows] })) });
    }
  }

  function applyBank(id: string) {
    const b = banks.find(x => x.id === id);
    if (!b) return;
    setQ({ ...q, bankAccountId: id, bankSnapshot: b });
  }

  async function handleSave() {
    if (!q.customerId) { toast.error("Select a customer"); return; }
    if (!q.items.length) { toast.error("Add at least one item"); return; }
    setSaving(true);
    const cust = customers.find(c => c.id === q.customerId);
    
    // Resolve authoritative Bill To snapshot
    const billToSnapshot: AddressSnapshot = (q as any).billToSnapshot || (q as any).billingAddressSnapshot || {
      partyName: cust?.name || "",
      tradingName: cust?.tradingName,
      gstin: cust?.gstin,
      pan: cust?.pan,
      address: q.billingAddress || cust?.billingAddress || cust?.address || "",
      addressLine1: q.billingAddress || cust?.billingAddress || cust?.address || "",
      city: cust?.city,
      district: cust?.district,
      state: cust?.state,
      stateCode: cust?.stateCode,
      country: cust?.country || "India",
      pincode: cust?.pincode,
      phone: q.contactPhone || cust?.phone || cust?.mobile,
      contactPerson: q.contactPerson || cust?.contactPerson,
    };

    const isSameAsBilling = q.sameAsBilling !== false;
    const shipToPartyId = isSameAsBilling ? q.customerId : (q.shipToPartyId || q.customerId);
    const shipToParty = shipToPartyId ? customers.find(c => c.id === shipToPartyId) || cust : cust;
    
    const shippingAddressSnapshot: AddressSnapshot | undefined = isSameAsBilling
      ? billToSnapshot
      : (q.shippingAddressSnapshot || {
          partyName: shipToParty?.name || cust?.name || "",
          tradingName: shipToParty?.tradingName,
          gstin: shipToParty?.gstin,
          address: q.shippingAddress || shipToParty?.billingAddress || shipToParty?.address || "",
          addressLine1: q.shippingAddress || shipToParty?.billingAddress || shipToParty?.address || "",
          city: shipToParty?.city || cust?.city,
          district: shipToParty?.district,
          state: shipToParty?.state || cust?.state,
          stateCode: shipToParty?.stateCode,
          country: shipToParty?.country || "India",
          pincode: shipToParty?.pincode || cust?.pincode,
          phone: shipToParty?.phone || cust?.phone,
          contactPerson: shipToParty?.contactPerson || cust?.contactPerson,
        });

    const finalQ: Quotation = {
      ...q,
      customerId: q.customerId,
      customerSnapshot: cust,
      billToPartyId: q.customerId,
      billToSnapshot,
      billingAddressId: (q as any).billingAddressId,
      billingAddressSnapshot: (q as any).billingAddressSnapshot || billToSnapshot,
      billingAddress: q.billingAddress || formatAddressLines(billToSnapshot),
      sameAsBilling: isSameAsBilling,
      shipToPartyId,
      shipToPartySnapshot: isSameAsBilling ? billToSnapshot : (q.shipToPartySnapshot || shippingAddressSnapshot),
      shippingAddressId: isSameAsBilling ? (q as any).billingAddressId : q.shippingAddressId,
      shippingAddressSnapshot,
      shippingAddress: isSameAsBilling ? (q.billingAddress || formatAddressLines(billToSnapshot)) : (q.shippingAddress || formatAddressLines(shippingAddressSnapshot)),
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      gstTotal: totals.gstTotal,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      extraChargesTotal: round2(extrasTotal),
      roundOff,
      grandTotal: grand,
      gstCalculationMode: q.gstCalculationMode || "item_wise",
      overallGstRate: q.overallGstRate,
      includeGeneralInfo: q.includeGeneralInfo !== false,
      includeTechSpecs: q.includeTechSpecs !== false,
      includeTerms: q.includeTerms !== false,
      includeBankDetails: q.includeBankDetails !== false,
      bankAccountId: q.bankAccountId,
      bankSnapshot: q.bankSnapshot,
      bankDetailsSnapshot: q.bankSnapshot || q.bankDetailsSnapshot,
      termsSnapshot: q.termsSnapshot,
      structuredTerms: q.structuredTerms,
      structuredTermsSnapshot: q.structuredTerms && q.structuredTerms.length > 0 ? [{ title: "Terms & Conditions", format: "numbered", items: q.structuredTerms }] : q.structuredTermsSnapshot,
      structuredSections: q.structuredSections,
      generalInformationSnapshot: q.structuredSections?.filter(s => s.type === "GENERAL_INFO") || q.generalInformationSnapshot,
      technicalSpecificationSnapshot: q.structuredSections?.filter(s => s.type === "SPEC_TABLE") || q.technicalSpecificationSnapshot,
    };
    // Save any custom sizes typed in items
    for (const it of finalQ.items) if (it.size) await saveSizeIfNew(it.size);
    try {
      await onSave(finalQ);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:px-4 sm:py-3">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">Quotation</div>
          <div className="truncate text-base font-semibold sm:text-lg">{q.number}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5"><X className="h-4 w-4" /> <span className="hidden sm:inline">Cancel</span></Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden p-3 sm:p-4">
        <Tabs defaultValue="details" className="space-y-4">
          <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-2 overflow-x-auto scrollbar-hidden bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:-mt-4 sm:px-4">
            <TabsList className="inline-flex w-max flex-nowrap gap-1">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="charges">Charges & Totals</TabsTrigger>
              <TabsTrigger value="general">General Info</TabsTrigger>
              <TabsTrigger value="tech">Technical</TabsTrigger>
              <TabsTrigger value="electrical">Electrical</TabsTrigger>
              <TabsTrigger value="terms">Terms & Bank</TabsTrigger>
            </TabsList>
          </div>


          {/* ============ DETAILS ============ */}
          <TabsContent value="details" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* BILL TO */}
              <Card className="p-4 space-y-3 border-border/70 shadow-xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    BILL TO (Customer / Sundry Debtor)
                  </div>
                  {q.customerId && (
                    <button
                      type="button"
                      onClick={() => setInsightCustomerId(q.customerId)}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      Financial History
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Party / Customer *</Label>
                  <PartySearchSelect
                    type="customer"
                    value={q.customerId || ""}
                    parties={customers}
                    onChange={(id: string) => {
                      const cust = customers.find(c => c.id === id);
                      setQ(prev => ({
                        ...prev,
                        customerId: id,
                        customerSnapshot: cust || undefined,
                        billToPartyId: id,
                        shipToPartyId: prev.sameAsBilling !== false ? id : prev.shipToPartyId || id,
                      }));
                    }}
                    onAddNew={() => setQuickCustomerOpen(true)}
                  />
                </div>
                <div className="space-y-1.5">
                  <PartyAddressSelect
                    party={customers.find(c => c.id === q.customerId)}
                    selectedAddressId={(q as any).billingAddressId}
                    onChange={(snapshot, addressId) => {
                      setQ(prev => {
                        const formatted = formatAddressLines(snapshot);
                        const isSame = prev.sameAsBilling !== false;
                        return {
                          ...prev,
                          billingAddressId: addressId,
                          billingAddressSnapshot: snapshot,
                          billingAddress: formatted,
                          ...(isSame ? {
                            shippingAddressId: addressId,
                            shippingAddressSnapshot: snapshot,
                            shippingAddress: formatted,
                          } : {}),
                        };
                      });
                    }}
                    label="Billing Address (Saved Party Master)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Field label="Contact Person">
                    <Input value={q.contactPerson || ""} placeholder="Contact person" onChange={e => setQ({ ...q, contactPerson: e.target.value })} />
                  </Field>
                  <Field label="Contact Phone">
                    <Input value={q.contactPhone || ""} placeholder="Phone / Mobile" onChange={e => setQ({ ...q, contactPhone: e.target.value })} />
                  </Field>
                </div>
                <Field label="Contact Email">
                  <Input value={q.contactEmail || ""} placeholder="Billing / Accounts Email" onChange={e => setQ({ ...q, contactEmail: e.target.value })} />
                </Field>
              </Card>

              {/* SHIP TO */}
              <Card className="p-4 space-y-3 border-border/70 shadow-xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    SHIP TO (Delivery Destination / Consignee)
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="quote-same-as-billing"
                      checked={q.sameAsBilling !== false}
                      onCheckedChange={(checked) => {
                        const isChecked = checked === true;
                        setQ(prev => {
                          const billSnapshot = (prev as any).billingAddressSnapshot;
                          const billAddr = prev.billingAddress;
                          return {
                            ...prev,
                            sameAsBilling: isChecked,
                            ...(isChecked ? {
                              shipToPartyId: prev.customerId,
                              shippingAddressId: (prev as any).billingAddressId,
                              shippingAddressSnapshot: billSnapshot,
                              shippingAddress: billAddr,
                            } : {}),
                          };
                        });
                      }}
                    />
                    <Label htmlFor="quote-same-as-billing" className="text-xs cursor-pointer select-none font-medium">
                      Same as Billing Address
                    </Label>
                  </div>
                </div>

                {q.sameAsBilling !== false ? (
                  <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-center text-xs text-muted-foreground leading-relaxed">
                    <p className="font-medium text-foreground mb-1">Shipping destination is identical to Billing Address.</p>
                    <p className="text-[11px]">Uncheck "Same as Billing Address" if delivery goes to another site, warehouse, factory, or third-party consignee.</p>
                    {q.billingAddress && (
                      <div className="mt-3 rounded border border-border/50 bg-background/80 p-2 text-left text-[11px] font-mono text-muted-foreground whitespace-pre-line">
                        {q.billingAddress}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Ship To Party / Consignee</Label>
                      <PartySearchSelect
                        type="customer"
                        value={q.shipToPartyId || q.customerId || ""}
                        parties={customers}
                        onChange={(id: string) => {
                          const p = customers.find(c => c.id === id);
                          setQ(prev => ({
                            ...prev,
                            shipToPartyId: id,
                            shipToPartySnapshot: p ? {
                              partyName: p.name,
                              tradingName: p.tradingName,
                              gstin: p.gstin,
                              address: p.billingAddress || p.address,
                              city: p.city,
                              state: p.state,
                              country: p.country,
                              pincode: p.pincode,
                              phone: p.phone,
                            } : undefined,
                          }));
                        }}
                        onAddNew={() => setQuickCustomerOpen(true)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <PartyAddressSelect
                        party={customers.find(c => c.id === (q.shipToPartyId || q.customerId))}
                        selectedAddressId={q.shippingAddressId}
                        onChange={(snapshot, addressId) => {
                          setQ(prev => ({
                            ...prev,
                            shippingAddressId: addressId,
                            shippingAddressSnapshot: snapshot,
                            shippingAddress: formatAddressLines(snapshot),
                          }));
                        }}
                        label="Shipping / Site Destination (Saved Party Master)"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Custom Shipping / Site Address Details</Label>
                      <Textarea
                        rows={2}
                        value={q.shippingAddress || ""}
                        onChange={e => setQ({ ...q, shippingAddress: e.target.value })}
                        placeholder="Site / delivery address, gate no, contact person at site…"
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Document Details Card */}
            <Card className="p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                Document Details & Schedule
              </div>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <Field label="Date">
                  <Input type="date" value={toDateInput(q.date)} onChange={e => setQ({ ...q, date: fromDateInput(e.target.value) })} />
                </Field>
                <Field label="Valid Until">
                  <Input type="date" value={q.validity ? toDateInput(q.validity) : ""} onChange={e => setQ({ ...q, validity: e.target.value ? fromDateInput(e.target.value) : undefined })} />
                </Field>
                <Field label="Prepared By">
                  <Input value={q.preparedBy || ""} onChange={e => setQ({ ...q, preparedBy: e.target.value })} />
                </Field>
                <Field label="Site / Location">
                  <Input value={q.siteLocation || ""} onChange={e => setQ({ ...q, siteLocation: e.target.value })} />
                </Field>
                <Field label="Template">
                  <Select value={q.templateId || ""} onValueChange={v => setQ({ ...q, templateId: v })}>
                    <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent>
                      {quoteTemplates.length === 0 && <SelectItem value="__none__" disabled>No templates</SelectItem>}
                      {quoteTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? " (default)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Remarks / Internal Notes">
                  <Textarea rows={2} value={q.notes || ""} onChange={e => setQ({ ...q, notes: e.target.value })} placeholder="Internal notes, customer payment terms, special instructions…" />
                </Field>
              </div>
            </Card>
          </TabsContent>

          {/* ============ ITEMS ============ */}
          <TabsContent value="items">
            <Card className="p-3">
              <LineItemsEditor
                items={q.items}
                onChange={(items) => setQ({ ...q, items })}
                mode="sales"
                isIgst={false}
                enableGst={true}
                customerId={q.customerId}
              />
            </Card>
          </TabsContent>

          {/* ============ CHARGES & TOTALS ============ */}
          <TabsContent value="charges">
            <Card className="p-4">
              <div className="mb-4">
                <div className="mb-2 text-sm font-medium">Extra Charges</div>
                <div className="space-y-2">
                  {(q.extraCharges || []).map((c, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={c.label} placeholder="Label (e.g. Transportation)" onChange={e => {
                        const list = [...(q.extraCharges || [])]; list[i] = { ...list[i], label: e.target.value }; setQ({ ...q, extraCharges: list });
                      }} />
                      <Input type="number" step="0.01" value={c.amount} className="w-40" onChange={e => {
                        const list = [...(q.extraCharges || [])]; list[i] = { ...list[i], amount: Number(e.target.value) }; setQ({ ...q, extraCharges: list });
                      }} />
                      <Button size="icon" variant="ghost" onClick={() => {
                        const list = [...(q.extraCharges || [])]; list.splice(i, 1); setQ({ ...q, extraCharges: list });
                      }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["Transportation", "Installation", "Unloading", "Miscellaneous"].map(label => (
                    <Button key={label} size="sm" variant="outline" onClick={() => {
                      if ((q.extraCharges || []).some(x => x.label === label)) return;
                      setQ({ ...q, extraCharges: [...(q.extraCharges || []), { label, amount: 0 }] });
                    }}><Plus className="mr-1 h-3 w-3" />{label}</Button>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setQ({ ...q, extraCharges: [...(q.extraCharges || []), { label: "", amount: 0 }] })}>
                    <Plus className="mr-1 h-3 w-3" /> Custom
                  </Button>
                </div>
              </div>

              {/* GST Calculation Mode & Totals Panel */}
              <div className="mt-4 flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="p-3.5 rounded-lg border bg-card/80 max-w-md w-full space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-bold text-foreground">GST Calculation Mode</Label>
                      <p className="text-[11px] text-muted-foreground">Choose line-wise taxes or a single overall document rate</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Select
                      value={q.gstCalculationMode || "item_wise"}
                      onValueChange={(val: "item_wise" | "overall") => {
                        if (val === "overall" && (q.gstCalculationMode || "item_wise") === "item_wise") {
                          const hasDiverse = q.items.some(it => (it.gstRate || 0) > 0);
                          if (hasDiverse) {
                            setPendingGstMode("overall");
                            return;
                          }
                        }
                        setQ({ ...q, gstCalculationMode: val, overallGstRate: q.overallGstRate ?? 18 });
                      }}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs font-semibold">
                        <SelectValue placeholder="GST Mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="item_wise">Item-wise GST</SelectItem>
                        <SelectItem value="overall">Overall GST</SelectItem>
                      </SelectContent>
                    </Select>

                    {q.gstCalculationMode === "overall" && (
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={String(q.overallGstRate ?? 18)}
                          onValueChange={(val) => setQ({ ...q, overallGstRate: Number(val) })}
                        >
                          <SelectTrigger className="w-24 h-8 text-xs font-mono font-bold">
                            <SelectValue placeholder="Rate" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0%</SelectItem>
                            <SelectItem value="5">5%</SelectItem>
                            <SelectItem value="12">12%</SelectItem>
                            <SelectItem value="18">18% (Standard)</SelectItem>
                            <SelectItem value="28">28%</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground font-medium">Rate</span>
                      </div>
                    )}
                  </div>
                  {q.gstCalculationMode === "overall" && (
                    <p className="text-[10px] text-muted-foreground italic">
                      Overall {q.overallGstRate ?? 18}% GST applied to eligible taxable lines and charges. Exempt items remain protected at 0%.
                    </p>
                  )}
                </div>

                <div className="max-w-md w-full rounded-md border bg-muted/30 p-4 text-sm">
                  <Row label="Subtotal" v={formatMoney(totals.subtotal)} />
                  <Row label="Discount" v={`- ${formatMoney(totals.discountTotal)}`} />
                  <Row
                    label={q.gstCalculationMode === "overall" ? `GST (Overall ${q.overallGstRate ?? 18}%)` : "GST"}
                    v={formatMoney(totals.gstTotal)}
                  />
                  {(q.extraCharges || []).filter(c => c.amount).map((c, i) => (
                    <Row key={i} label={c.label || "Extra"} v={formatMoney(c.amount)} />
                  ))}
                  <Row label="Round Off" v={formatMoney(roundOff)} />
                  <div className="mt-2 flex justify-between border-t pt-2 text-lg font-semibold">
                    <span>Grand Total</span><span className="font-mono">{formatMoney(grand)}</span>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ============ GENERAL INFO ============ */}
          <TabsContent value="general">
            <GeneralInformationEditor
              enabled={q.includeGeneralInfo !== false}
              onEnabledChange={(v) => setQ({ ...q, includeGeneralInfo: v })}
              rows={
                (q.structuredSections?.find(s => s.type === "GENERAL_INFO")?.rows) ||
                (q.generalInfoSnapshot?.map((f, i) => ({
                  id: f.key || uid(),
                  label: f.label,
                  value: f.value,
                  order: i + 1,
                  valueType: "TEXT" as const,
                })) || [])
              }
              onChange={(rows) => {
                const otherSecs = (q.structuredSections || []).filter(s => s.type !== "GENERAL_INFO");
                const genSec: QuotationSection = {
                  id: "sec-gen-info",
                  type: "GENERAL_INFO",
                  title: "General Information",
                  order: 0,
                  rows,
                };
                setQ({
                  ...q,
                  structuredSections: [genSec, ...otherSecs],
                  generalInfoSnapshot: rows.map(r => ({ key: r.id, label: r.label, value: r.value })),
                });
              }}
              templates={genTemplates}
              selectedTemplateId={q.generalInfoTemplateId}
              onApplyTemplate={(templateId) => {
                const tmpl = genTemplates.find(t => t.id === templateId);
                if (!tmpl) return;
                const rows: SectionRow[] = tmpl.fields.map((f, i) => ({
                  id: uid(),
                  label: f.label,
                  value: f.value,
                  valueType: "TEXT",
                  order: i + 1,
                }));
                const otherSecs = (q.structuredSections || []).filter(s => s.type !== "GENERAL_INFO");
                const genSec: QuotationSection = {
                  id: "sec-gen-info",
                  type: "GENERAL_INFO",
                  title: tmpl.name || "General Information",
                  order: 0,
                  rows,
                };
                setQ({
                  ...q,
                  generalInfoTemplateId: templateId,
                  structuredSections: [genSec, ...otherSecs],
                  generalInfoSnapshot: rows.map(r => ({ key: r.id, label: r.label, value: r.value })),
                });
              }}
            />
          </TabsContent>

          {/* ============ TECHNICAL SPEC ============ */}
          <TabsContent value="tech">
            <TechnicalSpecificationsEditor
              enabled={q.includeTechSpecs !== false}
              onEnabledChange={(v) => setQ({ ...q, includeTechSpecs: v })}
              sections={(q.structuredSections || []).filter(s => s.type === "SPEC_TABLE")}
              onChange={(specSecs) => {
                const genSecs = (q.structuredSections || []).filter(s => s.type === "GENERAL_INFO");
                setQ({
                  ...q,
                  structuredSections: [...genSecs, ...specSecs],
                  techSpecSnapshot: specSecs.map(s => ({
                    title: s.title,
                    rows: (s.rows || []).map(r => ({ label: r.label, value: r.value })),
                  })),
                });
              }}
              templates={techTemplates}
              onApplyTemplate={(templateId) => {
                const tmpl = techTemplates.find(t => t.id === templateId);
                if (!tmpl) return;
                const newSections: QuotationSection[] = tmpl.sections.map((sec, idx) => ({
                  id: uid(),
                  type: "SPEC_TABLE",
                  title: sec.title,
                  order: idx + 1,
                  rows: sec.rows.map((r, rIdx) => ({
                    id: uid(),
                    label: r.label,
                    value: r.value,
                    order: rIdx + 1,
                  })),
                }));
                const genSecs = (q.structuredSections || []).filter(s => s.type === "GENERAL_INFO");
                setQ({
                  ...q,
                  techSpecTemplateId: templateId,
                  structuredSections: [...genSecs, ...newSections],
                  techSpecSnapshot: tmpl.sections.map(s => ({ title: s.title, rows: [...s.rows] })),
                });
              }}
            />
          </TabsContent>

          {/* ============ TERMS & BANK ============ */}
          <TabsContent value="terms">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <StructuredTermsEditor
                  enabled={q.includeTerms !== false}
                  onEnabledChange={(v) => setQ({ ...q, includeTerms: v })}
                  terms={q.structuredTerms || []}
                  onChange={(terms) => setQ({
                    ...q,
                    structuredTerms: terms,
                    termsSnapshot: terms.map(t => t.text),
                    terms: terms.map((t, i) => `${i + 1}. ${t.text}`).join("\n"),
                  })}
                  templates={termsTemplates}
                  onApplyTemplate={(templateId) => {
                    const tmpl = termsTemplates.find(t => t.id === templateId);
                    if (!tmpl) return;
                    const items: StructuredTermItem[] = (tmpl.structuredTerms && tmpl.structuredTerms.length > 0)
                      ? tmpl.structuredTerms.map((t, idx) => ({ ...t, id: uid(), order: idx + 1 }))
                      : (tmpl.terms || []).filter(t => t.enabled).map((t, idx) => ({
                          id: uid(),
                          order: idx + 1,
                          text: t.text,
                          format: "NUMBERED",
                        }));
                    setQ({
                      ...q,
                      termsTemplateId: templateId,
                      structuredTerms: items,
                      termsSnapshot: items.map(x => x.text),
                      terms: items.map((x, i) => `${i + 1}. ${x.text}`).join("\n"),
                    });
                  }}
                  documentType="quotation"
                />
              </div>

              <div className="space-y-4">
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Bank Settlement Details</div>
                      <div className="text-xs text-muted-foreground">Bank account printed on document</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium">Show on PDF</span>
                      <Switch
                        checked={q.includeBankDetails !== false}
                        onCheckedChange={(v) => setQ({ ...q, includeBankDetails: v })}
                      />
                    </div>
                  </div>

                  {q.includeBankDetails !== false && (
                    <>
                      <div className="mb-3">
                        <Select value={q.bankAccountId || ""} onValueChange={applyBank}>
                          <SelectTrigger><SelectValue placeholder="Select company bank account" /></SelectTrigger>
                          <SelectContent>
                            {banks.length === 0 && <SelectItem value="__none__" disabled>Add bank in Masters / Settings</SelectItem>}
                            {banks.map(b => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.bankName} — {b.accountNo} {b.isDefault ? " ★" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {q.bankSnapshot ? (
                        <div className="rounded-md border bg-muted/30 p-3.5 text-xs space-y-1.5">
                          <div className="font-bold text-sm text-foreground">{q.bankSnapshot.bankName}</div>
                          <div><span className="text-muted-foreground">A/C Name:</span> <span className="font-semibold">{q.bankSnapshot.accountName}</span></div>
                          <div><span className="text-muted-foreground">A/C No:</span> <span className="font-mono font-semibold">{q.bankSnapshot.accountNo}</span></div>
                          <div><span className="text-muted-foreground">IFSC:</span> <span className="font-mono font-semibold">{q.bankSnapshot.ifsc}</span></div>
                          {q.bankSnapshot.branch && <div><span className="text-muted-foreground">Branch:</span> {q.bankSnapshot.branch}</div>}
                          {q.bankSnapshot.upi && <div><span className="text-muted-foreground">UPI:</span> <span className="font-mono">{q.bankSnapshot.upi}</span></div>}
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">No bank selected.</div>
                      )}
                    </>
                  )}
                </Card>

                {/* Signatory & Stamp Document Appearance Override */}
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Signatory & Stamp (Document Appearance)</div>
                      <div className="text-xs text-muted-foreground">
                        Use company defaults or customize signature and stamp visibility for this quotation.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Use Company Default</span>
                      <Switch
                        checked={!q.signatoryOverride}
                        onCheckedChange={(useDefault) => {
                          setQ({
                            ...q,
                            signatoryOverride: useDefault ? undefined : {
                              showSignature: true,
                              showStamp: true,
                              showSignatoryName: true,
                              showDesignation: true,
                              showSignatureDate: true,
                              signatureDateMode: "document_date",
                            },
                          });
                        }}
                      />
                    </div>
                  </div>

                  {q.signatoryOverride && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 rounded-lg border bg-muted/20 p-3">
                      <div className="flex items-center justify-between rounded-md border bg-background p-2.5">
                        <span className="text-xs">Show Signature</span>
                        <Switch
                          checked={q.signatoryOverride.showSignature ?? true}
                          onCheckedChange={(v) =>
                            setQ({
                              ...q,
                              signatoryOverride: { ...q.signatoryOverride, showSignature: v },
                            })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border bg-background p-2.5">
                        <span className="text-xs">Show Stamp</span>
                        <Switch
                          checked={q.signatoryOverride.showStamp ?? true}
                          onCheckedChange={(v) =>
                            setQ({
                              ...q,
                              signatoryOverride: { ...q.signatoryOverride, showStamp: v },
                            })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border bg-background p-2.5">
                        <span className="text-xs">Show Signatory Name</span>
                        <Switch
                          checked={q.signatoryOverride.showSignatoryName ?? true}
                          onCheckedChange={(v) =>
                            setQ({
                              ...q,
                              signatoryOverride: { ...q.signatoryOverride, showSignatoryName: v },
                            })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border bg-background p-2.5">
                        <span className="text-xs">Show Designation</span>
                        <Switch
                          checked={q.signatoryOverride.showDesignation ?? true}
                          onCheckedChange={(v) =>
                            setQ({
                              ...q,
                              signatoryOverride: { ...q.signatoryOverride, showDesignation: v },
                            })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border bg-background p-2.5 sm:col-span-2">
                        <span className="text-xs">Show Signature Date</span>
                        <Switch
                          checked={q.signatoryOverride.showSignatureDate ?? true}
                          onCheckedChange={(v) =>
                            setQ({
                              ...q,
                              signatoryOverride: { ...q.signatoryOverride, showSignatureDate: v },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <QuickCreateCustomerDrawer
        open={quickCustomerOpen}
        onOpenChange={setQuickCustomerOpen}
        onCustomerCreated={(c) => {
          setQ(prev => ({ ...prev, customerId: c.id }));
        }}
      />
      <QuickCreateProductModal
        open={quickProductOpen}
        onOpenChange={setQuickProductOpen}
        onProductCreated={(p) => {
          setQ(prev => {
            const next = [...prev.items];
            const newItem = computeLine({
              productId: p.id,
              name: p.name,
              hsn: p.hsn,
              unit: p.unit,
              rate: p.sellingPrice,
              gstRate: p.gstRate,
              description: p.specifications || p.description || "",
              quantity: 1,
              discountPct: 0,
            });
            next.push(newItem);
            return { ...prev, items: next };
          });
        }}
      />
      <CustomerInsightDrawer
        customerId={insightCustomerId}
        open={Boolean(insightCustomerId)}
        onOpenChange={(o) => !o && setInsightCustomerId(null)}
      />

      <AlertDialog open={!!pendingGstMode} onOpenChange={(open) => !open && setPendingGstMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Overall GST Rate?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing to Overall GST will apply the document-level rate ({q.overallGstRate ?? 18}%) across all eligible taxable items and charges for this quotation.
              Individual product master settings will not be permanently deleted.
              Exempt and nil-rated items remain protected at 0%.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingGstMode(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setQ({ ...q, gstCalculationMode: "overall", overallGstRate: q.overallGstRate ?? 18 });
                setPendingGstMode(null);
                toast.info(`Overall GST ${q.overallGstRate ?? 18}% applied to quotation`);
              }}
            >
              Apply Overall GST
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Row({ label, v }: { label: string; v: string }) {
  return <div className="flex justify-between py-0.5"><span className="text-muted-foreground">{label}</span><span className="font-mono">{v}</span></div>;
}

function SortableRow({
  id, children,
}: {
  id: string;
  children: (dragHandleProps: any) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? "hsl(var(--muted))" : undefined,
  };
  return (
    <TableRow ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </TableRow>
  );
}

function SizePicker({
  value, onChange, sizes, productSizes, onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  sizes: SizePreset[];
  productSizes: string[];
  onSave: (label: string) => Promise<void>;
}) {
  const isKnown = (v: string) => sizes.some(s => s.label === v) || productSizes.includes(v);
  const [custom, setCustom] = useState(!!value && !isKnown(value));
  useEffect(() => {
    if (value && !isKnown(value)) setCustom(true);
    else if (value && isKnown(value)) setCustom(false);
    // when value is empty, leave `custom` as-is so user can type in custom mode
  }, [value, sizes, productSizes]);
  const options = Array.from(new Set([...productSizes, ...sizes.map(s => s.label)]));
  if (custom) {
    return (
      <div className="flex w-full gap-1 sm:w-auto">
        <Input className="h-9 min-w-0 flex-1 sm:w-32" value={value} onChange={e => onChange(e.target.value)} placeholder="Custom" onBlur={() => value.trim() && onSave(value)} />
        <Button size="icon" variant="ghost" onClick={() => { setCustom(false); onChange(""); }}><X className="h-3 w-3" /></Button>
      </div>
    );
  }
  return (
    <Select value={value || "__pick__"} onValueChange={v => {
      if (v === "__custom__") { setCustom(true); onChange(""); }
      else if (v === "__pick__") onChange("");
      else onChange(v);
    }}>
      <SelectTrigger className="h-9 w-full sm:w-32"><SelectValue placeholder="Size" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__pick__">— none —</SelectItem>
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        <SelectItem value="__custom__">+ Custom…</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SectionEditor({
  title, value, onChange, templates, onApplyTemplate,
}: {
  title: string;
  value: TechSpecSection[];
  onChange: (v: TechSpecSection[]) => void;
  templates: TechSpecTemplate[];
  onApplyTemplate: (id: string) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Select onValueChange={onApplyTemplate}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Load template" /></SelectTrigger>
          <SelectContent>
            {templates.length === 0 && <SelectItem value="__none__" disabled>Create in Masters</SelectItem>}
            {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => onChange([...value, { title: "New section", rows: [] }])}>
          <Plus className="mr-1 h-3 w-3" /> Add section
        </Button>
        {value.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChange([])}>Clear</Button>}
      </div>
      {value.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Empty — this page will be omitted from PDF/DOCX.
        </div>
      )}
      <div className="space-y-4">
        {value.map((sec, si) => (
          <div key={si} className="rounded-md border p-3">
            <div className="mb-2 flex gap-2">
              <Input value={sec.title} onChange={e => {
                const list = [...value]; list[si] = { ...list[si], title: e.target.value }; onChange(list);
              }} placeholder="Section title" className="font-medium" />
              <Button size="icon" variant="ghost" onClick={() => { const list = [...value]; list.splice(si, 1); onChange(list); }}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="space-y-1.5">
              {sec.rows.map((r, ri) => (
                <div key={ri} className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_auto]">
                  <Input value={r.label} placeholder="Label" onChange={e => {
                    const list = [...value]; const rows = [...list[si].rows]; rows[ri] = { ...rows[ri], label: e.target.value };
                    list[si] = { ...list[si], rows }; onChange(list);
                  }} />
                  <Textarea rows={1} value={r.value} placeholder="Value" onChange={e => {
                    const list = [...value]; const rows = [...list[si].rows]; rows[ri] = { ...rows[ri], value: e.target.value };
                    list[si] = { ...list[si], rows }; onChange(list);
                  }} />
                  <Button size="icon" variant="ghost" onClick={() => {
                    const list = [...value]; const rows = [...list[si].rows]; rows.splice(ri, 1);
                    list[si] = { ...list[si], rows }; onChange(list);
                  }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => {
                const list = [...value]; list[si] = { ...list[si], rows: [...list[si].rows, { label: "", value: "" }] }; onChange(list);
              }}><Plus className="mr-1 h-3 w-3" /> Add row</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
