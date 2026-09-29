import {
  db,
  type Customer,
  type Supplier,
  type Product,
  type Invoice,
  type Quotation,
  type Receipt,
  type Purchase,
  type CreditNote,
  type Party,
} from "@/lib/db";
import { useLive } from "@/lib/useLive";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";
import {
  Users,
  Truck,
  Package,
  FileText,
  Receipt as ReceiptIcon,
  HandCoins,
  ShoppingCart,
  RotateCcw,
  BookOpen,
  Zap,
} from "lucide-react";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { searchCachedEntitiesRecords } from "@/modules/sync/dexieCache";
import type { CachedEntity } from "@/modules/sync/types";
import { useState, useEffect, useMemo } from "react";
import { firebaseDb } from "@/config/firebase";
import { ref, onValue, off } from "firebase/database";
import type { Ledger } from "@/modules/accounting/types";
import { formatMoney } from "@/lib/format";

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const { activeCompany, activeBranchId, branches, isOwner } = useActiveCompany();
  const [query, setQuery] = useState("");
  const [cachedMatches, setCachedMatches] = useState<CachedEntity[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);

  // Authorized branch set for the current user
  const authorizedBranchIds = useMemo(() => new Set(branches.map((b) => b.id)), [branches]);

  const isBranchAllowed = (entityBranchId?: string): boolean => {
    if (isOwner) return true;
    if (!entityBranchId) return true; // Master entities or non-branch records are permitted
    if (activeBranchId !== "all" && entityBranchId !== activeBranchId) return false;
    return authorizedBranchIds.has(entityBranchId);
  };

  const customers = useLive<Customer>(() => db().customers.limit(60).toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.limit(60).toArray());
  const parties = useLive<Party>(() => db().parties.limit(80).toArray());
  const products = useLive<Product>(() => db().products.limit(100).toArray());
  const invoices = useLive<Invoice>(() =>
    db().invoices.orderBy("createdAt").reverse().limit(40).toArray()
  );
  const quotations = useLive<Quotation>(() =>
    db().quotations.orderBy("createdAt").reverse().limit(40).toArray()
  );
  const receipts = useLive<Receipt>(() =>
    db().receipts.orderBy("createdAt").reverse().limit(40).toArray()
  );
  const purchases = useLive<Purchase>(() =>
    db().purchases.orderBy("createdAt").reverse().limit(40).toArray()
  );
  const creditNotes = useLive<CreditNote>(() =>
    db().creditNotes.orderBy("createdAt").reverse().limit(40).toArray()
  );

  // Realtime ledgers for chart of accounts search
  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) {
      setLedgers([]);
      return;
    }
    const ledgersRef = ref(firebaseDb, `companyData/${activeCompany.id}/ledgers`);
    const onData = (snap: any) => {
      if (snap.exists()) {
        setLedgers(Object.values(snap.val()));
      } else {
        setLedgers([]);
      }
    };
    onValue(ledgersRef, onData);
    return () => off(ledgersRef, "value", onData);
  }, [activeCompany?.id]);

  useEffect(() => {
    if (!activeCompany?.id || !query.trim() || query.trim().length < 2) {
      setCachedMatches([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchCachedEntitiesRecords(activeCompany.id, query.trim(), 25).then((matches) => {
        if (active) {
          const authorizedMatches = matches.filter((m) =>
            isBranchAllowed(m.branchId || (m.data as any)?.branchId)
          );
          setCachedMatches(authorizedMatches);
        }
      });
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeCompany?.id, query, activeBranchId, isOwner, authorizedBranchIds]);

  function go(url: string) {
    onOpenChange(false);
    nav({ to: url as any });
  }

  const q = query.toLowerCase().trim();

  // Filtered in-memory records with strict branch authorization
  const matchedInvoices = (q
    ? invoices.filter((i) =>
        isBranchAllowed(i.branchId) &&
        ((i.number || "").toLowerCase().includes(q) ||
          (i.customerSnapshot?.name || "").toLowerCase().includes(q))
      )
    : invoices.filter((i) => isBranchAllowed(i.branchId))
  ).slice(0, 5);

  const matchedQuotations = (q
    ? quotations.filter((qt) =>
        isBranchAllowed(qt.branchId) &&
        ((qt.number || "").toLowerCase().includes(q) ||
          (qt.customerSnapshot?.name || "").toLowerCase().includes(q))
      )
    : quotations.filter((qt) => isBranchAllowed(qt.branchId))
  ).slice(0, 5);

  const matchedPurchases = (q
    ? purchases.filter((pu) =>
        isBranchAllowed(pu.branchId) &&
        ((pu.number || "").toLowerCase().includes(q) ||
          (pu.supplierInvoiceNumber || "").toLowerCase().includes(q) ||
          (pu.supplierSnapshot?.name || "").toLowerCase().includes(q))
      )
    : purchases.filter((pu) => isBranchAllowed(pu.branchId))
  ).slice(0, 5);

  const matchedReceipts = (q
    ? receipts.filter((rc) =>
        isBranchAllowed(rc.branchId) &&
        (((rc.number || (rc as any).receiptNumber || "").toLowerCase().includes(q)) ||
          (((rc as any).customerName || (rc as any).partyName || "").toLowerCase().includes(q)))
      )
    : receipts.filter((rc) => isBranchAllowed(rc.branchId))
  ).slice(0, 5);

  const matchedCreditNotes = (q
    ? creditNotes.filter((cn) =>
        isBranchAllowed(cn.branchId) &&
        (((cn.number || "").toLowerCase().includes(q)) ||
          ((cn.originalInvoiceNumber || "").toLowerCase().includes(q)) ||
          (((cn as any).customerName || (cn as any).partyName || "").toLowerCase().includes(q)))
      )
    : creditNotes.filter((cn) => isBranchAllowed(cn.branchId))
  ).slice(0, 5);

  const matchedParties = q ? parties.filter((p) =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.partyCode || "").toLowerCase().includes(q) ||
    (p.gstin || "").toLowerCase().includes(q) ||
    (p.phone || p.mobile || "").includes(q)
  ) : parties.slice(0, 5);

  const matchedProducts = q ? products.filter((pr) =>
    (pr.name || "").toLowerCase().includes(q) ||
    ((pr as any).code || pr.sku || "").toLowerCase().includes(q) ||
    (pr.hsn || "").includes(q)
  ) : products.slice(0, 5);

  const matchedLedgers = q ? ledgers.filter((l) =>
    (l.name || "").toLowerCase().includes(q) ||
    (l.code || "").includes(q)
  ) : ledgers.slice(0, 5);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search invoices, quotes, receipts, purchases, credit notes, parties, products, ledgers…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matching records found.</CommandEmpty>

        {/* 1. Fast Cache Index Matches */}
        {cachedMatches.length > 0 && (
          <CommandGroup heading="Instant Cache Results">
            {cachedMatches.map((m) => {
              const entity = m.data as any;
              let link = "/";
              let label = entity?.name || entity?.number || m.entityId;
              let subtext = "";
              if (m.entityType === "invoices") {
                link = `/invoices?q=${encodeURIComponent(entity?.number || "")}&id=${m.entityId}`;
                subtext = `Invoice · ${entity?.customerSnapshot?.name || ""} · ${formatMoney(entity?.grandTotal || entity?.total || 0)}`;
              } else if (m.entityType === "quotations") {
                link = `/quotations?q=${encodeURIComponent(entity?.number || "")}&id=${m.entityId}`;
                subtext = `Quotation · ${formatMoney(entity?.grandTotal || entity?.total || 0)}`;
              } else if (m.entityType === "parties" || m.entityType === "customers") {
                link = `/parties?q=${encodeURIComponent(entity?.name || "")}&id=${m.entityId}`;
                subtext = `Party · ${entity?.phone || entity?.mobile || entity?.gstin || ""}`;
              } else if (m.entityType === "products") {
                link = `/products?q=${encodeURIComponent(entity?.name || "")}&id=${m.entityId}`;
                subtext = `Product · ${formatMoney(entity?.sellingPrice || entity?.price || 0)}`;
              } else if (m.entityType === "purchases") {
                link = `/purchases?q=${encodeURIComponent(entity?.supplierInvoiceNumber || entity?.number || "")}&id=${m.entityId}`;
                subtext = `Purchase · ${entity?.supplierSnapshot?.name || ""} · ${formatMoney(entity?.grandTotal || entity?.total || 0)}`;
              }
              return (
                <CommandItem
                  key={`cached-${m.entityType}-${m.entityId}`}
                  value={`fast ${m.entityType} ${label} ${entity?.supplierInvoiceNumber || ""} ${subtext}`}
                  onSelect={() => go(link)}
                >
                  <Zap className="mr-2 h-4 w-4 text-amber-500 shrink-0" />
                  <span className="font-medium text-foreground">{label}</span>
                  <span className="ml-2 text-xs text-muted-foreground truncate">{subtext}</span>
                  <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase font-semibold text-muted-foreground shrink-0">
                    {m.entityType}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* 2. Invoices */}
        {matchedInvoices.length > 0 && (
          <CommandGroup heading="Invoices">
            {matchedInvoices.map((inv) => (
              <CommandItem
                key={inv.id}
                value={`invoice ${inv.number} ${inv.customerSnapshot?.name ?? ""}`}
                onSelect={() => go(`/invoices?q=${encodeURIComponent(inv.number)}&id=${inv.id}`)}
              >
                <ReceiptIcon className="mr-2 h-4 w-4 text-primary shrink-0" />
                <span className="font-mono font-medium">{inv.number}</span>
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  · {inv.customerSnapshot?.name || "Customer"} · {formatMoney(inv.grandTotal ?? 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 3. Quotations */}
        {matchedQuotations.length > 0 && (
          <CommandGroup heading="Quotations">
            {matchedQuotations.map((qt) => (
              <CommandItem
                key={qt.id}
                value={`quotation ${qt.number} ${qt.customerSnapshot?.name ?? ""}`}
                onSelect={() => go(`/quotations?q=${encodeURIComponent(qt.number)}&id=${qt.id}`)}
              >
                <FileText className="mr-2 h-4 w-4 text-sky-600 shrink-0" />
                <span className="font-mono font-medium">{qt.number}</span>
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  · {qt.customerSnapshot?.name || "Customer"} · {formatMoney(qt.grandTotal ?? 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 4. Purchases */}
        {matchedPurchases.length > 0 && (
          <CommandGroup heading="Purchases">
            {matchedPurchases.map((pu) => (
              <CommandItem
                key={pu.id}
                value={`purchase ${pu.number} ${pu.supplierInvoiceNumber ?? ""} ${pu.supplierSnapshot?.name ?? ""}`}
                onSelect={() =>
                  go(`/purchases?q=${encodeURIComponent(pu.supplierInvoiceNumber || pu.number)}&id=${pu.id}`)
                }
              >
                <ShoppingCart className="mr-2 h-4 w-4 text-indigo-600 shrink-0" />
                <span className="font-mono font-medium">{pu.number}</span>
                {pu.supplierInvoiceNumber && (
                  <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    Inv: {pu.supplierInvoiceNumber}
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  · {pu.supplierSnapshot?.name || "Vendor"} · {formatMoney(pu.grandTotal ?? 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 5. Receipts */}
        {matchedReceipts.length > 0 && (
          <CommandGroup heading="Receipts">
            {matchedReceipts.map((rec) => (
              <CommandItem
                key={rec.id}
                value={`receipt ${rec.number || (rec as any).receiptNumber || ""} ${(rec as any).customerName || (rec as any).partyName || ""}`}
                onSelect={() =>
                  go(`/receipts?q=${encodeURIComponent(rec.number || (rec as any).receiptNumber || "")}&id=${rec.id}`)
                }
              >
                <HandCoins className="mr-2 h-4 w-4 text-emerald-600 shrink-0" />
                <span className="font-mono font-medium">{rec.number || (rec as any).receiptNumber}</span>
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  · {(rec as any).customerName || (rec as any).partyName || "Party"} · {formatMoney(rec.amount || 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 6. Credit Notes / Sales Returns */}
        {matchedCreditNotes.length > 0 && (
          <CommandGroup heading="Credit Notes & Sales Returns">
            {matchedCreditNotes.map((cn) => (
              <CommandItem
                key={cn.id}
                value={`credit-note ${cn.number} ${cn.originalInvoiceNumber || ""} ${(cn as any).customerName || (cn as any).partyName || ""}`}
                onSelect={() => go(`/sales-returns?q=${encodeURIComponent(cn.number)}&id=${cn.id}`)}
              >
                <RotateCcw className="mr-2 h-4 w-4 text-rose-600 shrink-0" />
                <span className="font-mono font-medium">{cn.number}</span>
                {cn.originalInvoiceNumber && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    (against {cn.originalInvoiceNumber})
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground truncate">
                  · {(cn as any).customerName || (cn as any).partyName || "Customer"} · {formatMoney(cn.grandTotal || (cn as any).total || 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 7. Parties (Party Master) */}
        {matchedParties.length > 0 && (
          <CommandGroup heading="Parties (Customers & Suppliers)">
            {matchedParties.map((p) => (
              <CommandItem
                key={p.id}
                value={`party ${p.name} ${p.partyCode || ""} ${p.gstin || ""} ${p.phone || p.mobile || ""}`}
                onSelect={() => go(`/parties?q=${encodeURIComponent(p.name)}&id=${p.id}`)}
              >
                <Users className="mr-2 h-4 w-4 text-teal-600 shrink-0" />
                <span className="font-medium text-foreground">{p.name}</span>
                {p.partyCode && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    ({p.partyCode})
                  </span>
                )}
                {p.gstin && (
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {p.gstin}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 8. Products & Stock */}
        {matchedProducts.length > 0 && (
          <CommandGroup heading="Products & Stock">
            {matchedProducts.map((pr) => (
              <CommandItem
                key={pr.id}
                value={`product ${pr.name} ${(pr as any).code || pr.sku || ""} ${pr.hsn || ""}`}
                onSelect={() => go(`/products?q=${encodeURIComponent(pr.name)}&id=${pr.id}`)}
              >
                <Package className="mr-2 h-4 w-4 text-indigo-500 shrink-0" />
                <span className="font-medium text-foreground">{pr.name}</span>
                {(pr as any).code && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    ({(pr as any).code})
                  </span>
                )}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {formatMoney(pr.sellingPrice || (pr as any).price || 0)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* 9. Ledgers (Double-Entry Accounts) */}
        {matchedLedgers.length > 0 && (
          <CommandGroup heading="Chart of Accounts & Ledgers">
            {matchedLedgers.map((l) => (
              <CommandItem
                key={l.id}
                value={`ledger ${l.name} ${l.code || ""} ${(l as any).groupName || l.groupId || ""}`}
                onSelect={() => go(`/ledger?q=${encodeURIComponent(l.name)}&id=${l.id}`)}
              >
                <BookOpen className="mr-2 h-4 w-4 text-amber-600 shrink-0" />
                <span className="font-medium text-foreground">{l.name}</span>
                {l.code && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    ({l.code})
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground uppercase font-mono">
                  {(l as any).groupName || l.groupId}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
