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

import {
  db, uid, type Quotation, type LineItem, type Customer, type Product, type ExtraCharge,
  type SizePreset, type TermsTemplate, type GeneralInfoTemplate, type TechSpecTemplate,
  type BankAccount, type QuotationTemplate, type TermItem, type GeneralInfoField, type TechSpecSection,
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

  const totals = computeTotals(q.items, false);
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
    const finalQ: Quotation = {
      ...q,
      customerSnapshot: cust,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      gstTotal: totals.gstTotal,
      extraChargesTotal: round2(extrasTotal),
      roundOff,
      grandTotal: grand,
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
          <TabsContent value="details">
            <Card className="p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Customer *">
                  <Select value={q.customerId || ""} onValueChange={v => setQ({ ...q, customerId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
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
                <Field label="Contact Person">
                  <Input value={q.contactPerson || ""} onChange={e => setQ({ ...q, contactPerson: e.target.value })} />
                </Field>
                <Field label="Contact Phone">
                  <Input value={q.contactPhone || ""} onChange={e => setQ({ ...q, contactPhone: e.target.value })} />
                </Field>
                <Field label="Contact Email">
                  <Input value={q.contactEmail || ""} onChange={e => setQ({ ...q, contactEmail: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Remarks">
                  <Textarea rows={3} value={q.notes || ""} onChange={e => setQ({ ...q, notes: e.target.value })} />
                </Field>
              </div>
            </Card>
          </TabsContent>

          {/* ============ ITEMS ============ */}
          <TabsContent value="items">
            <Card className="p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Drag rows to reorder. Click a product to auto-fill.</div>
                <Button size="sm" className="gap-2" onClick={addRow}><Plus className="h-4 w-4" /> Add row</Button>
              </div>
              <div className="space-y-3 sm:hidden">
                {itemsWithIds.length === 0 && (
                  <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">No items yet. Tap "Add row".</div>
                )}
                {itemsWithIds.map((it, i) => (
                  <div key={it._rid} className="rounded-md border bg-card p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Item {i + 1}</div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" title="Duplicate" onClick={() => duplicateRow(i)}><Copy className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Delete" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Select value={it.productId || "custom"} onValueChange={v => v === "custom" ? updateItem(i, { productId: "" }) : pickProduct(i, v)}>
                        <SelectTrigger className="h-10"><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom item</SelectItem>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input className="h-10" value={it.name} onChange={e => updateItem(i, { name: e.target.value })} placeholder="Item name" />
                      <Textarea className="min-h-20 text-sm" placeholder="Description / specifications" value={it.description || ""} onChange={e => updateItem(i, { description: e.target.value })} />
                      <SizePicker
                        value={it.size || ""}
                        onChange={v => updateItem(i, { size: v })}
                        productSizes={products.find(p => p.id === it.productId)?.defaultSizes || []}
                        sizes={sizes}
                        onSave={saveSizeIfNew}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input className="h-10 text-right" type="number" step="0.01" value={it.quantity} onChange={e => updateItem(i, { quantity: Number(e.target.value) })} placeholder="Qty" />
                        <Input className="h-10" value={it.unit} onChange={e => updateItem(i, { unit: e.target.value })} placeholder="Unit" />
                        <Input className="h-10 text-right" type="number" step="0.01" value={it.rate} onChange={e => updateItem(i, { rate: Number(e.target.value) })} placeholder="Rate" />
                        <Input className="h-10 text-right" type="number" step="0.01" value={it.discountPct} onChange={e => updateItem(i, { discountPct: Number(e.target.value) })} placeholder="Disc%" />
                        <Input className="h-10 text-right" type="number" step="0.01" value={it.gstRate} onChange={e => updateItem(i, { gstRate: Number(e.target.value) })} placeholder="GST%" />
                        <div className="flex h-10 items-center justify-end rounded-md bg-muted/40 px-3 font-mono text-sm font-semibold">{formatMoney(it.total)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden max-w-full overflow-x-auto scrollbar-hidden rounded-md border sm:block">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={itemsWithIds.map(x => x._rid)} strategy={verticalListSortingStrategy}>
                    <Table className="min-w-[920px]">
                      <TableHeader className="bg-muted/60">
                        <TableRow>
                          <TableHead className="w-6"></TableHead>
                          <TableHead className="w-[24%]">Product</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Disc%</TableHead>
                          <TableHead className="text-right">GST%</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="w-20"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itemsWithIds.length === 0 && (
                          <TableRow><TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">No items yet. Click "Add row".</TableCell></TableRow>
                        )}
                        {itemsWithIds.map((it, i) => (
                          <SortableRow key={it._rid} id={it._rid}>
                            {(dragHandleProps) => (
                              <>
                                <TableCell>
                                  <button {...dragHandleProps} className="cursor-grab text-muted-foreground hover:text-foreground" aria-label="Drag">
                                    <GripVertical className="h-4 w-4" />
                                  </button>
                                </TableCell>
                                <TableCell>
                                  <Select value={it.productId || "custom"} onValueChange={v => v === "custom" ? updateItem(i, { productId: "" }) : pickProduct(i, v)}>
                                    <SelectTrigger className="h-9 min-w-[180px]"><SelectValue placeholder="Select product" /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="custom">Custom item</SelectItem>
                                      {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Input className="mt-1 h-8" value={it.name} onChange={e => updateItem(i, { name: e.target.value })} placeholder="Item name" />
                                  <Textarea className="mt-1 h-14 text-xs" placeholder="Description / specifications" value={it.description || ""} onChange={e => updateItem(i, { description: e.target.value })} />
                                </TableCell>
                                <TableCell>
                                  <SizePicker
                                    value={it.size || ""}
                                    onChange={v => updateItem(i, { size: v })}
                                    productSizes={products.find(p => p.id === it.productId)?.defaultSizes || []}
                                    sizes={sizes}
                                    onSave={saveSizeIfNew}
                                  />
                                </TableCell>
                                <TableCell><Input className="h-9 w-20 text-right" type="number" step="0.01" value={it.quantity} onChange={e => updateItem(i, { quantity: Number(e.target.value) })} /></TableCell>
                                <TableCell><Input className="h-9 w-16" value={it.unit} onChange={e => updateItem(i, { unit: e.target.value })} /></TableCell>
                                <TableCell><Input className="h-9 w-24 text-right" type="number" step="0.01" value={it.rate} onChange={e => updateItem(i, { rate: Number(e.target.value) })} /></TableCell>
                                <TableCell><Input className="h-9 w-16 text-right" type="number" step="0.01" value={it.discountPct} onChange={e => updateItem(i, { discountPct: Number(e.target.value) })} /></TableCell>
                                <TableCell><Input className="h-9 w-16 text-right" type="number" step="0.01" value={it.gstRate} onChange={e => updateItem(i, { gstRate: Number(e.target.value) })} /></TableCell>
                                <TableCell className="text-right font-mono">{formatMoney(it.total)}</TableCell>
                                <TableCell className="text-right">
                                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => duplicateRow(i)}><Copy className="h-4 w-4" /></Button>
                                  <Button size="icon" variant="ghost" title="Delete" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </TableCell>
                              </>
                            )}
                          </SortableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </SortableContext>
                </DndContext>
              </div>
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

              <div className="ml-auto max-w-md rounded-md border bg-muted/30 p-4 text-sm">
                <Row label="Subtotal" v={formatMoney(totals.subtotal)} />
                <Row label="Discount" v={`- ${formatMoney(totals.discountTotal)}`} />
                <Row label="GST" v={formatMoney(totals.gstTotal)} />
                {(q.extraCharges || []).filter(c => c.amount).map((c, i) => (
                  <Row key={i} label={c.label || "Extra"} v={formatMoney(c.amount)} />
                ))}
                <Row label="Round Off" v={formatMoney(roundOff)} />
                <div className="mt-2 flex justify-between border-t pt-2 text-lg font-semibold">
                  <span>Grand Total</span><span className="font-mono">{formatMoney(grand)}</span>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* ============ GENERAL INFO ============ */}
          <TabsContent value="general">
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Label className="text-xs">Apply template:</Label>
                <Select value={q.generalInfoTemplateId || ""} onValueChange={applyGeneralInfo}>
                  <SelectTrigger className="w-64"><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    {genTemplates.length === 0 && <SelectItem value="__none__" disabled>Create templates in Masters</SelectItem>}
                    {genTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => setQ({ ...q, generalInfoSnapshot: [...(q.generalInfoSnapshot || []), { key: "", label: "", value: "" }] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add field
                </Button>
                {q.generalInfoSnapshot?.length ? (
                  <Button size="sm" variant="ghost" onClick={() => setQ({ ...q, generalInfoSnapshot: [], generalInfoTemplateId: undefined })}>Clear</Button>
                ) : null}
              </div>
              <div className="space-y-2">
                {(q.generalInfoSnapshot || []).length === 0 && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No general information added — page will be omitted from PDF/DOCX.</div>
                )}
                {(q.generalInfoSnapshot || []).map((f, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_auto]">
                    <Input placeholder="Label (e.g. Configuration)" value={f.label} onChange={e => updateGeneralField(i, { label: e.target.value })} />
                    <Textarea rows={1} placeholder="Value" value={f.value} onChange={e => updateGeneralField(i, { value: e.target.value })} />
                    <Button size="icon" variant="ghost" onClick={() => {
                      const list = [...(q.generalInfoSnapshot || [])]; list.splice(i, 1); setQ({ ...q, generalInfoSnapshot: list });
                    }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ============ TECHNICAL SPEC ============ */}
          <TabsContent value="tech">
            <SectionEditor
              title="Technical Specifications"
              value={q.techSpecSnapshot || []}
              onChange={v => setQ({ ...q, techSpecSnapshot: v })}
              templates={techTemplates.filter(t => t.kind !== "electrical")}
              onApplyTemplate={applyTechSpec}
            />
          </TabsContent>

          {/* ============ ELECTRICAL ============ */}
          <TabsContent value="electrical">
            <SectionEditor
              title="Electrical / Additional Specifications"
              value={q.electricalSnapshot || []}
              onChange={v => setQ({ ...q, electricalSnapshot: v })}
              templates={techTemplates.filter(t => t.kind === "electrical")}
              onApplyTemplate={applyTechSpec}
            />
          </TabsContent>

          {/* ============ TERMS & BANK ============ */}
          <TabsContent value="terms">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium">Terms & Conditions</div>
                  <Select value={q.termsTemplateId || ""} onValueChange={applyTermsTemplate}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Load template" /></SelectTrigger>
                    <SelectContent>
                      {termsTemplates.length === 0 && <SelectItem value="__none__" disabled>Create in Masters</SelectItem>}
                      {termsTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? " ★" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {q.termsTemplateId ? (
                  <div className="space-y-1.5">
                    {(termsTemplates.find(t => t.id === q.termsTemplateId)?.terms || []).map(t => {
                      const active = (q.termsSnapshot || []).includes(t.text);
                      return (
                        <div key={t.id} className="flex items-start gap-2 rounded-md border p-2">
                          <Checkbox checked={active} onCheckedChange={() => toggleTerm(t.text)} />
                          <div className={`text-sm ${active ? "" : "text-muted-foreground line-through"}`}>{t.text}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Textarea rows={8} placeholder="One term per line" value={q.terms || ""} onChange={e => {
                    const lines = e.target.value.split("\n").map(x => x.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
                    setQ({ ...q, terms: e.target.value, termsSnapshot: lines });
                  }} />
                )}
              </Card>

              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium">Bank Details</div>
                  <Select value={q.bankAccountId || ""} onValueChange={applyBank}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Select bank" /></SelectTrigger>
                    <SelectContent>
                      {banks.length === 0 && <SelectItem value="__none__" disabled>Add in Masters</SelectItem>}
                      {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.bankName}{b.isDefault ? " ★" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {q.bankSnapshot ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <div className="font-semibold">{q.bankSnapshot.bankName}</div>
                    <div>A/C Name: {q.bankSnapshot.accountName}</div>
                    <div>A/C No: <span className="font-mono">{q.bankSnapshot.accountNo}</span></div>
                    <div>IFSC: <span className="font-mono">{q.bankSnapshot.ifsc}</span></div>
                    {q.bankSnapshot.upi && <div>UPI: <span className="font-mono">{q.bankSnapshot.upi}</span></div>}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No bank selected.</div>
                )}
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
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
