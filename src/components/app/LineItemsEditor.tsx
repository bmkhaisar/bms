import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { db, type LineItem, type Product, type PricingBasis, type MeasurementEntry, type ProductSizePreference, type SizeSnapshot, type SizePreset } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { computeLine, computeTotals } from "@/lib/calc";
import { formatMoney } from "@/lib/format";
import { Plus, Trash2, Calculator, Info, Search, PackagePlus, ArrowRight, Check, Ruler, ChevronDown } from "lucide-react";
import { QuickCreateProductModal } from "./QuickCreateProductModal";
import { MeasurementDialog } from "./MeasurementDialog";
import { ProductInsightDrawer } from "./ProductInsightDrawer";
import { getPricingIntelligence, type PricingIntelligence } from "@/modules/pricing/priceHistoryService";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { normalizeName, normalizeSearchToken } from "@/modules/sync/searchNormalization";
import { rememberProductSize } from "@/modules/inventory/productSizeService";
import { authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";
import { parseSizeSnapshot, extractDimensionFromString, formatDisplaySize } from "@/lib/sizeResolution";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function LineItemsEditor({
  items,
  onChange,
  mode = "sales",
  isIgst = false,
  enableGst = true,
  gstCalculationMode = "item_wise",
  customerId,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  mode?: "sales" | "purchase";
  isIgst?: boolean;
  enableGst?: boolean;
  gstCalculationMode?: "item_wise" | "overall";
  customerId?: string;
}) {
  const { activeCompany } = useActiveCompany();
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());
  const productSizes = useLive<ProductSizePreference>(() => db().productSizes.orderBy("lastUsedAt").reverse().toArray());
  const masterSizes = useLive<SizePreset>(() => db().sizes.orderBy("label").toArray());

  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openProductModal, setOpenProductModal] = useState(false);
  const [quickAddIndex, setQuickAddIndex] = useState<number | null>(null);
  const [modalDefaultName, setModalDefaultName] = useState("");
  const [modalDefaultRate, setModalDefaultRate] = useState(0);

  // Measurement Dialog State
  const [measuringIndex, setMeasuringIndex] = useState<number | null>(null);

  // Product Insight Drawer State
  const [insightProductId, setInsightProductId] = useState<string | null>(null);

  // Pricing Intelligence cache per row
  const [rowPricing, setRowPricing] = useState<Record<number, PricingIntelligence>>({});

  function update(i: number, patch: Partial<LineItem>) {
    const next = [...items];
    next[i] = computeLine({ ...next[i], ...patch });
    onChange(next);
  }

  // Load pricing intelligence when product or customer changes
  useEffect(() => {
    if (!activeCompany?.id) return;
    items.forEach((it, idx) => {
      if (it.productId) {
        getPricingIntelligence({
          companyId: activeCompany.id,
          productId: it.productId,
          customerId,
          targetUnit: it.unit,
        }).then((pi) => {
          setRowPricing((prev) => ({ ...prev, [idx]: pi }));
        });
      }
    });
  }, [items.map((i) => i.productId).join(","), customerId, activeCompany?.id]);

  const [savingProductDescId, setSavingProductDescId] = useState<string | null>(null);
  const [dismissedPrompts, setDismissedPrompts] = useState<Record<number, boolean>>({});

  function sizeOptions(productId?: string, item?: Partial<LineItem>): SizeSnapshot[] {
    const unique = new Map<string, SizeSnapshot>();

    // 1. If productId exists, look up remembered and default sizes for this product
    if (productId) {
      const product = products.find((p) => p.id === productId);
      const remembered = productSizes
        .filter((s) => s.productId === productId)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.isFavorite) - Number(a.isFavorite) || b.usageCount - a.usageCount || b.lastUsedAt - a.lastUsedAt);
      const defaults = (product?.defaultSizes || []).map((label) => parseSizeSnapshot(label));

      if (product) {
        const fromProdName = extractDimensionFromString(product.name);
        if (fromProdName) {
          const snap = parseSizeSnapshot(fromProdName);
          unique.set(snap.label.trim().toLowerCase(), snap);
        }
        const fromProdSpecs = extractDimensionFromString(product.specifications || product.description);
        if (fromProdSpecs) {
          const snap = parseSizeSnapshot(fromProdSpecs);
          unique.set(snap.label.trim().toLowerCase(), snap);
        }
      }

      [...remembered, ...defaults].forEach((s) => {
        const snap = parseSizeSnapshot(s);
        if (snap.label) unique.set(snap.label.trim().toLowerCase(), snap);
      });
    }

    // 2. Check current item's name/description for dimensions
    if (item?.name) {
      const fromItemName = extractDimensionFromString(item.name);
      if (fromItemName) {
        const snap = parseSizeSnapshot(fromItemName);
        unique.set(snap.label.trim().toLowerCase(), snap);
      }
    }
    if (item?.description) {
      const fromItemDesc = extractDimensionFromString(item.description);
      if (fromItemDesc) {
        const snap = parseSizeSnapshot(fromItemDesc);
        unique.set(snap.label.trim().toLowerCase(), snap);
      }
    }

    // 3. Include Master size presets (from db().sizes)
    (masterSizes || []).forEach((m) => {
      const snap = parseSizeSnapshot(m.label);
      if (snap.label) unique.set(snap.label.trim().toLowerCase(), snap);
    });

    // 4. Include company-wide recently used product sizes
    (productSizes || []).slice(0, 10).forEach((s) => {
      const snap = parseSizeSnapshot(s);
      if (snap.label) unique.set(snap.label.trim().toLowerCase(), snap);
    });

    return Array.from(unique.values()).slice(0, 15);
  }

  function pickProduct(i: number, p: Product) {
    const defaultRate = mode === "sales" ? p.sellingPrice : p.purchasePrice;
    const basis: PricingBasis = p.pricingBasis || "per_unit";
    const prodDesc = p.defaultDescription || p.description || "";
    const sizes = sizeOptions(p.id);
    const extracted = extractDimensionFromString(p.name) || extractDimensionFromString(p.specifications || p.description);
    const initialSize = sizes.length > 0
      ? sizes[0]
      : extracted
        ? parseSizeSnapshot(extracted)
        : undefined;

    update(i, {
      productId: p.id,
      name: p.name,
      productName: p.name,
      productNameSnapshot: p.name,
      description: prodDesc,
      descriptionSnapshot: prodDesc,
      hsn: p.hsn,
      unit: p.unit || "PCS",
      uomSnapshot: p.unit || "PCS",
      rate: defaultRate,
      rateSnapshot: defaultRate,
      gstRate: enableGst ? p.gstRate : 0,
      pricingBasis: basis,
      quantity: basis === "fixed" ? 1 : items[i].quantity || 1,
      ...(initialSize ? { size: initialSize.label, sizeSnapshot: initialSize } : {}),
    });
    setActiveSearchIndex(null);
    setSearchQuery("");
  }

  async function handleUpdateProductDefault(productId: string, newDescription: string, rowIndex: number) {
    if (!activeCompany?.id || !productId) return;
    const p = products.find((prod) => prod.id === productId);
    if (!p) return;

    setSavingProductDescId(productId);
    try {
      const updated: Product = {
        ...p,
        defaultDescription: newDescription,
      };
      await authoritativeSaveEntity({
        companyId: activeCompany.id,
        kind: "product",
        entity: updated,
        action: "update",
      });
      toast.success("Product default description updated");
      setDismissedPrompts((prev) => ({ ...prev, [rowIndex]: true }));
    } catch (err: any) {
      console.error("Failed to update product default description:", err);
      toast.error(err?.message || "Failed to update product default description");
    } finally {
      setSavingProductDescId(null);
    }
  }


  async function applySize(i: number, size: SizeSnapshot) {
    update(i, { size: size.label, sizeSnapshot: { ...size } });
    const productId = items[i]?.productId;
    if (activeCompany?.id && productId) {
      try {
        await rememberProductSize({ companyId: activeCompany.id, productId, size });
      } catch (error) {
        console.warn("Product size suggestion could not be saved:", error);
      }
    }
  }

  function addRow() {
    onChange([
      ...items,
      computeLine({
        productId: "",
        name: "",
        quantity: 1,
        rate: 0,
        discountPct: 0,
        gstRate: enableGst ? 18 : 0,
        unit: "PCS",
        pricingBasis: "per_unit",
      }),
    ]);
  }

  function removeRow(i: number) {
    const n = [...items];
    n.splice(i, 1);
    onChange(n);
  }

  // Keyboard shortcut: Alt+A to add row
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        addRow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);

  // High-Speed Priority-Ranked Product Search (PRD § 23)
  // Priority: 1. Exact SKU -> 2. Prefix SKU -> 3. Prefix Name -> 4. Substring Name -> 5. Alias -> 6. Description/HSN
  function getFilteredProducts(q: string): Product[] {
    const norm = normalizeSearchToken(q);
    if (!norm) return products.slice(0, 15);

    const matches: { product: Product; rank: number }[] = [];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const skuLower = p.sku ? p.sku.toLowerCase() : "";
      const normName = normalizeName(p.name);

      if (skuLower === norm) {
        matches.push({ product: p, rank: 1 });
        continue;
      }
      if (skuLower.startsWith(norm)) {
        matches.push({ product: p, rank: 2 });
        continue;
      }
      if (normName.startsWith(norm)) {
        matches.push({ product: p, rank: 3 });
        continue;
      }
      if (normName.includes(norm)) {
        matches.push({ product: p, rank: 4 });
        continue;
      }
      if (Array.isArray(p.aliases)) {
        let aliasMatched = false;
        for (const a of p.aliases) {
          if (normalizeName(a).includes(norm)) {
            matches.push({ product: p, rank: 5 });
            aliasMatched = true;
            break;
          }
        }
        if (aliasMatched) continue;
      }
      if (p.hsn && p.hsn.toLowerCase().includes(norm)) {
        matches.push({ product: p, rank: 6 });
        continue;
      }
      if (p.description && p.description.toLowerCase().includes(norm)) {
        matches.push({ product: p, rank: 7 });
      }
    }

    return matches
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 25)
      .map((m) => m.product);
  }

  return (
    <div className="space-y-3">
      {/* Mobile Card View */}
      <div className="space-y-3 sm:hidden">
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">
            No items. Tap "Add line item" to begin.
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border bg-card/90 backdrop-blur p-3 shadow-sm space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-foreground">Item {i + 1}</div>
              <div className="flex items-center gap-1">
                {it.productId && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-primary"
                    onClick={() => setInsightProductId(it.productId)}
                    title="Product Insight"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => removeRow(i)}
                  aria-label="Remove item"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Input
                className="h-8"
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value, productNameSnapshot: e.target.value })}
                placeholder="Product name"
              />
              <Textarea
                className="min-h-[44px] text-xs py-1.5 resize-y bg-background font-normal"
                value={it.description || ""}
                onChange={(e) => update(i, { description: e.target.value, descriptionSnapshot: e.target.value })}
                placeholder="Item description (specifications, features)..."
              />
              {(() => {
                const linkedProduct = products.find((p) => p.id === it.productId);
                const prodDefaultDesc = linkedProduct?.defaultDescription || linkedProduct?.description || "";
                const hasChangedDesc = Boolean(it.description && it.description.trim() !== prodDefaultDesc.trim());
                if (!hasChangedDesc || dismissedPrompts[i] || !it.productId) return null;
                return (
                  <div className="flex flex-wrap items-center justify-between gap-1 p-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-900 dark:text-amber-200">
                    <span className="font-medium">Changed from Product default</span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] hover:bg-amber-500/20"
                        onClick={() => setDismissedPrompts((prev) => ({ ...prev, [i]: true }))}
                      >
                        Document Only
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-5 px-2 text-[10px] bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 font-medium"
                        disabled={savingProductDescId === it.productId}
                        onClick={() => handleUpdateProductDefault(it.productId, it.description || "", i)}
                      >
                        {savingProductDescId === it.productId ? "Updating..." : "Update Product Default"}
                      </Button>
                    </div>
                  </div>
                );
              })()}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Size</div>
                <ProductSizeField
                  value={it.size || ""}
                  options={sizeOptions(it.productId, it)}
                  productId={it.productId}
                  onApply={(size) => applySize(i, size)}
                  onDirectChange={(val) => {
                    update(i, { size: val, sizeSnapshot: val ? parseSizeSnapshot(val) : undefined });
                  }}
                  onBlur={(val) => {
                    if (val && val.trim() && it.productId) {
                      applySize(i, parseSizeSnapshot(val));
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 text-right font-mono flex-1"
                    type="number"
                    step="0.01"
                    value={it.quantity || ""}
                    onChange={(e) => update(i, { quantity: Number(e.target.value) || 0 })}
                    placeholder="Qty"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 text-primary shrink-0"
                    onClick={() => setMeasuringIndex(i)}
                    title="Size / Measurement"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input
                  className="h-8 text-right font-mono"
                  type="number"
                  step="0.01"
                  value={it.rate || ""}
                  onChange={(e) => update(i, { rate: Number(e.target.value) || 0 })}
                  placeholder="Rate (₹)"
                />
              </div>
              {it.measurementSummary && (
                <div className="text-[11px] text-muted-foreground font-mono bg-muted/40 px-2 py-1 rounded flex items-center justify-between">
                  <span className="truncate">{it.measurementSummary}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-[10px] text-primary"
                    onClick={() => setMeasuringIndex(i)}
                  >
                    Edit Size
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 font-mono font-semibold">
                <span>Line Total:</span>
                <span>{formatMoney(it.total)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden max-w-full overflow-x-auto scrollbar-hidden rounded-xl border border-border/60 bg-card/85 backdrop-blur sm:block">
        <Table className="min-w-[1020px] text-xs">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[27%]">Product / Description</TableHead>
              <TableHead className="w-40">Size</TableHead>
              <TableHead className="w-20">Pricing Basis</TableHead>
              <TableHead className="w-20">HSN/SAC</TableHead>
              <TableHead className="w-24 text-right">Qty & Unit</TableHead>
              <TableHead className="w-24 text-right">Rate (₹)</TableHead>
              <TableHead className="w-16 text-right">Disc %</TableHead>
              {enableGst && gstCalculationMode !== "overall" && <TableHead className="w-20 text-right">GST %</TableHead>}
              <TableHead className="text-right">Line Total</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={enableGst && gstCalculationMode !== "overall" ? 10 : 9}
                  className="py-8 text-center text-xs text-muted-foreground"
                >
                  No items. Click "+ Add Line Item" or press <kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">Alt+A</kbd> to begin.
                </TableCell>
              </TableRow>
            )}

            {items.map((it, i) => {
              const pi = rowPricing[i];
              return (
                <TableRow key={i} className="group align-top">
                  {/* Product Combobox Cell */}
                  <TableCell className="space-y-1">
                    <Popover
                      open={activeSearchIndex === i}
                      onOpenChange={(isOpen) => {
                        if (isOpen) {
                          setActiveSearchIndex(i);
                          setSearchQuery(it.name || "");
                        } else {
                          setActiveSearchIndex(null);
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="h-8 text-xs bg-background cursor-pointer"
                            value={it.name || ""}
                            onChange={(e) => update(i, { name: e.target.value, productNameSnapshot: e.target.value })}
                            placeholder="Type to search or enter product name…"
                          />
                          {it.productId && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                              onClick={() => setInsightProductId(it.productId)}
                              title="Product Insight"
                            >
                              <Info className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </PopoverTrigger>

                      <PopoverContent className="w-[380px] p-2 text-xs" align="start">
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search catalog by name, SKU, alias, HSN…"
                            className="h-8 pl-8 text-xs"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                          />
                        </div>

                        <div className="max-h-[160px] overflow-y-auto space-y-1 scrollbar-thin">
                          {searchQuery && getFilteredProducts(searchQuery).length === 0 && (
                            <div className="p-2 text-center text-muted-foreground">
                              No catalog match.
                            </div>
                          )}

                          {searchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuickAddIndex(i);
                                setModalDefaultName(searchQuery);
                                setModalDefaultRate(it.rate || 0);
                                setActiveSearchIndex(null);
                                setOpenProductModal(true);
                              }}
                              className="w-full text-left p-2 rounded-md hover:bg-primary/10 text-primary font-semibold flex items-center gap-1.5 transition-colors border border-dashed border-primary/40"
                            >
                              <PackagePlus className="h-3.5 w-3.5" />
                              + Add "{searchQuery}" as a new product
                            </button>
                          )}

                          {getFilteredProducts(searchQuery).map((p) => (
                            <div
                              key={p.id}
                              onClick={() => pickProduct(i, p)}
                              className={`flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-accent/60 transition-colors ${
                                it.productId === p.id ? "bg-accent/80 font-semibold" : ""
                              }`}
                            >
                              <div className="space-y-0.5 truncate pr-2">
                                <div className="truncate text-foreground font-medium">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-2 font-mono">
                                  {p.sku && <span>SKU: {p.sku}</span>}
                                  <span>{p.unit}</span>
                                  {p.hsn && <span>HSN: {p.hsn}</span>}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-bold">{formatMoney(p.sellingPrice)}</div>
                                {p.currentStock !== undefined && (
                                  <div className="text-[9px] text-muted-foreground">
                                    Stock: {p.currentStock}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Multiline Expandable Item Description (PRD § 5) */}
                    <Textarea
                      className="min-h-[44px] max-h-[120px] text-xs py-1.5 resize-y bg-background font-normal"
                      value={it.description || ""}
                      onChange={(e) => update(i, { description: e.target.value, descriptionSnapshot: e.target.value })}
                      placeholder="Item description (specifications, features)..."
                    />

                    {/* Changed from Product default banner (PRD § 3 & Correction #6, #7) */}
                    {(() => {
                      const linkedProduct = products.find((p) => p.id === it.productId);
                      const prodDefaultDesc = linkedProduct?.defaultDescription || linkedProduct?.description || "";
                      const hasChangedDesc = Boolean(it.description && it.description.trim() !== prodDefaultDesc.trim());
                      if (!hasChangedDesc || dismissedPrompts[i] || !it.productId) return null;
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-1 p-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-900 dark:text-amber-200">
                          <span className="font-medium">Changed from Product default</span>
                          <div className="flex items-center gap-1.5 ml-auto">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[10px] hover:bg-amber-500/20"
                              onClick={() => setDismissedPrompts((prev) => ({ ...prev, [i]: true }))}
                            >
                              Document Only
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-5 px-2 text-[10px] bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 font-medium"
                              disabled={savingProductDescId === it.productId}
                              onClick={() => handleUpdateProductDefault(it.productId, it.description || "", i)}
                            >
                              {savingProductDescId === it.productId ? "Updating..." : "Update Product Default"}
                            </Button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Measurement Summary Badge / Multi-row details */}
                    {it.measurementSummary && (
                      <div className="text-[11px] text-muted-foreground font-mono bg-muted/30 px-2 py-0.5 rounded flex items-center justify-between">
                        <span>{it.measurementSummary}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1 text-[10px] text-primary"
                          onClick={() => setMeasuringIndex(i)}
                        >
                          Edit
                        </Button>
                      </div>
                    )}

                    {/* Subtle Pricing Intelligence Pill (Item 13) */}
                    {pi && it.productId && (
                      <div className="flex flex-wrap gap-1 text-[10px] pt-0.5">
                        <button
                          type="button"
                          onClick={() => update(i, { rate: pi.standardRate })}
                          className="px-1.5 py-0.2 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground font-mono transition-colors"
                          title="Click to apply standard catalog rate"
                        >
                          Std: {formatMoney(pi.standardRate)}
                        </button>
                        {pi.lastSoldRate !== null && (
                          <button
                            type="button"
                            onClick={() => update(i, { rate: pi.lastSoldRate! })}
                            className="px-1.5 py-0.2 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-mono transition-colors"
                            title={`Apply last sold rate: ${formatMoney(pi.lastSoldRate)} / ${it.unit || pi.unit}`}
                          >
                            Last Sold: {formatMoney(pi.lastSoldRate)} / {it.unit || pi.unit}
                          </button>
                        )}
                        {pi.customerLastRate !== null && (
                          <button
                            type="button"
                            onClick={() => update(i, { rate: pi.customerLastRate! })}
                            className="px-1.5 py-0.2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono font-medium transition-colors"
                            title={`Apply customer last rate: ${formatMoney(pi.customerLastRate)} / ${it.unit || pi.unit}${pi.isUomConverted ? " (converted from alternate unit)" : ""}`}
                          >
                            Cust Last: {formatMoney(pi.customerLastRate)} / {it.unit || pi.unit}
                            {pi.isUomConverted ? " (converted)" : ""}
                          </button>
                        )}
                      </div>
                    )}

                    {/* One-off custom item save to master checkbox */}
                    {!it.productId && it.name.trim() && (
                      <div className="flex items-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground">
                        <Checkbox
                          id={`save-master-${i}`}
                          checked={it.saveToMaster ?? false}
                          onCheckedChange={(c) => update(i, { saveToMaster: Boolean(c) })}
                          className="h-3 w-3"
                        />
                        <label htmlFor={`save-master-${i}`} className="cursor-pointer">
                          Save this item to Products catalog
                        </label>
                      </div>
                    )}
                  </TableCell>

                  {/* First-class Size field with product-specific recent and saved suggestions */}
                  <TableCell>
                    <ProductSizeField
                      value={it.size || ""}
                      options={sizeOptions(it.productId, it)}
                      productId={it.productId}
                      onApply={(size) => applySize(i, size)}
                      onDirectChange={(val) => {
                        update(i, { size: val, sizeSnapshot: val ? parseSizeSnapshot(val) : undefined });
                      }}
                      onBlur={(val) => {
                        if (val && val.trim() && it.productId) {
                          applySize(i, parseSizeSnapshot(val));
                        }
                      }}
                    />
                  </TableCell>

                  {/* Pricing Basis */}
                  <TableCell>
                    <Select
                      value={it.pricingBasis || "per_unit"}
                      onValueChange={(v) => {
                        const pb = v as PricingBasis;
                        let defaultUom = it.unit;
                        if (pb === "per_area" && it.unit === "PCS") defaultUom = "SQFT";
                        if (pb === "per_length" && it.unit === "PCS") defaultUom = "FT";
                        if (pb === "per_weight" && it.unit === "PCS") defaultUom = "KG";
                        update(i, { pricingBasis: pb, unit: defaultUom });
                      }}
                    >
                      <SelectTrigger className="h-8 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_unit">Per Unit</SelectItem>
                        <SelectItem value="per_area">Per Area</SelectItem>
                        <SelectItem value="per_length">Per Length</SelectItem>
                        <SelectItem value="per_weight">Per Weight</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>

                  {/* HSN/SAC */}
                  <TableCell>
                    <Input
                      className="h-8 w-20 font-mono text-xs"
                      value={it.hsn ?? ""}
                      onChange={(e) => update(i, { hsn: e.target.value })}
                      placeholder="HSN"
                    />
                  </TableCell>

                  {/* Qty & Unit with Dimension Calculator Trigger */}
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      {it.pricingBasis !== "fixed" && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 text-primary shrink-0"
                          onClick={() => setMeasuringIndex(i)}
                          title="Open Measurement / Size Calculator"
                        >
                          <Calculator className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Input
                        className="h-8 w-16 text-right font-mono text-xs"
                        type="number"
                        step="0.01"
                        value={it.pricingBasis === "fixed" ? 1 : it.quantity || ""}
                        disabled={it.pricingBasis === "fixed"}
                        onChange={(e) => update(i, { quantity: Number(e.target.value) || 0 })}
                      />
                      <Input
                        className="h-8 w-14 text-center font-mono text-xs uppercase"
                        value={it.unit || "PCS"}
                        onChange={(e) => update(i, { unit: e.target.value.toUpperCase() })}
                      />
                    </div>
                  </TableCell>

                  {/* Rate */}
                  <TableCell>
                    <Input
                      className="h-8 w-24 text-right font-mono text-xs"
                      type="number"
                      step="0.01"
                      value={it.rate || ""}
                      onChange={(e) => update(i, { rate: Number(e.target.value) || 0 })}
                    />
                  </TableCell>

                  {/* Disc % */}
                  <TableCell>
                    <Input
                      className="h-8 w-16 text-right font-mono text-xs"
                      type="number"
                      step="0.01"
                      value={it.discountPct || ""}
                      onChange={(e) => update(i, { discountPct: Number(e.target.value) || 0 })}
                    />
                  </TableCell>

                  {/* GST % (Only shown in item-wise mode) */}
                  {enableGst && gstCalculationMode !== "overall" && (
                    <TableCell>
                      <Select
                        value={String(it.gstRate)}
                        onValueChange={(v) => update(i, { gstRate: Number(v) })}
                      >
                        <SelectTrigger className="h-8 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">0%</SelectItem>
                          <SelectItem value="5">5%</SelectItem>
                          <SelectItem value="12">12%</SelectItem>
                          <SelectItem value="18">18%</SelectItem>
                          <SelectItem value="28">28%</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}

                  {/* Line Total */}
                  <TableCell className="text-right font-mono font-semibold pt-3.5">
                    {formatMoney(it.total)}
                  </TableCell>

                  {/* Delete Button */}
                  <TableCell className="text-center pt-2.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(i)}
                      tabIndex={-1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add Line Item <kbd className="hidden sm:inline text-[10px] text-muted-foreground bg-muted px-1 rounded">Alt+A</kbd>
        </Button>
      </div>

      {/* Measurement Dialog */}
      {measuringIndex !== null && items[measuringIndex] && (
        <MeasurementDialog
          open={measuringIndex !== null}
          onOpenChange={(isOpen) => !isOpen && setMeasuringIndex(null)}
          pricingBasis={items[measuringIndex].pricingBasis || "per_area"}
          unit={items[measuringIndex].unit || "Sq Ft"}
          initialMeasurements={items[measuringIndex].measurements}
          onApply={({ quantity, measurements, measurementSummary }) => {
            update(measuringIndex, { quantity, measurements, measurementSummary });
          }}
        />
      )}

      {/* Product Insight Drawer */}
      <ProductInsightDrawer
        productId={insightProductId}
        open={Boolean(insightProductId)}
        onOpenChange={(isOpen) => !isOpen && setInsightProductId(null)}
      />

      {/* Quick Create Product Modal */}
      <QuickCreateProductModal
        open={openProductModal}
        onOpenChange={setOpenProductModal}
        defaultName={modalDefaultName}
        defaultRate={modalDefaultRate}
        onProductCreated={(p) => {
          if (quickAddIndex !== null) {
            pickProduct(quickAddIndex, p);
          }
        }}
      />
    </div>
  );
}

function ProductSizeField({
  value,
  options,
  productId,
  onApply,
  onDirectChange,
  onBlur,
}: {
  value: string;
  options: SizeSnapshot[];
  productId?: string;
  onApply: (size: SizeSnapshot) => void;
  onDirectChange?: (val: string) => void;
  onBlur?: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  function commitCustom() {
    const next = custom.trim();
    if (!next) return;
    const snap = parseSizeSnapshot(next);
    onApply(snap);
    setCustom("");
    setOpen(false);
  }

  return (
    <div className="relative flex items-center w-full min-w-[130px]">
      <Input
        value={value}
        onChange={(e) => onDirectChange?.(e.target.value)}
        onBlur={(e) => onBlur?.(e.target.value)}
        placeholder="e.g. 20' × 10' × 8.5'"
        className="h-8 pr-7 text-xs bg-background font-normal"
        title="Enter custom size or click arrow to choose saved/recent sizes"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 h-8 w-7 px-0 text-muted-foreground hover:text-foreground shrink-0 rounded-l-none"
            title="Choose recent, saved, or preset sizes"
          >
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2 text-xs">
          <div className="mb-1.5 flex items-center justify-between font-semibold text-foreground border-b pb-1.5">
            <span className="flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5 text-primary" /> Product Sizes
            </span>
            {value && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
                Current: {value}
              </span>
            )}
          </div>
          {options.length > 0 ? (
            <div className="mb-2 max-h-48 overflow-y-auto space-y-0.5 scrollbar-thin">
              <div className="px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Recent / Saved Sizes
              </div>
              {options.map((size) => {
                const isSelected = value.trim().toLowerCase() === size.label.trim().toLowerCase();
                return (
                  <button
                    type="button"
                    key={size.label.toLowerCase()}
                    onClick={() => {
                      onApply(size);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                      isSelected ? "bg-accent/80 font-semibold text-foreground" : "text-foreground/90"
                    )}
                  >
                    <span>{size.label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mb-2 rounded-md bg-muted/40 px-2 py-2 text-[11px] text-muted-foreground">
              No saved sizes for this product yet. Type custom size below or in the field directly.
            </div>
          )}
          <div className="border-t pt-2 space-y-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Custom Size
            </div>
            <div className="flex gap-1.5">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  }
                }}
                placeholder="20' × 10' × 8.5'"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={!custom.trim()}
                onClick={commitCustom}
              >
                Use
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Saved as a recent suggestion for this Product.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
