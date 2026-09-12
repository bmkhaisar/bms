import {
  db,
  type Customer,
  type Supplier,
  type Product,
  type Invoice,
  type Quotation,
  type Receipt,
  type Purchase,
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
} from "lucide-react";

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const customers = useLive<Customer>(() => db().customers.limit(100).toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.limit(100).toArray());
  const products = useLive<Product>(() => db().products.limit(200).toArray());
  const invoices = useLive<Invoice>(() =>
    db().invoices.orderBy("createdAt").reverse().limit(50).toArray()
  );
  const quotations = useLive<Quotation>(() =>
    db().quotations.orderBy("createdAt").reverse().limit(50).toArray()
  );
  const receipts = useLive<Receipt>(() =>
    db().receipts.orderBy("createdAt").reverse().limit(50).toArray()
  );
  const purchases = useLive<Purchase>(() =>
    db().purchases.orderBy("createdAt").reverse().limit(50).toArray()
  );

  function go(url: string) {
    onOpenChange(false);
    if (typeof window !== "undefined") {
      window.location.href = url;
    } else {
      nav({ to: url as never });
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search customers, invoices (INV/...), products, quotations..." />
      <CommandList>
        <CommandEmpty>No matching records found.</CommandEmpty>

        {invoices.length > 0 && (
          <CommandGroup heading="Invoices">
            {invoices.map((inv) => (
              <CommandItem
                key={inv.id}
                value={`invoice ${inv.number} ${inv.customerSnapshot?.name ?? ""}`}
                onSelect={() =>
                  go(`/invoices?q=${encodeURIComponent(inv.number)}&id=${inv.id}`)
                }
              >
                <ReceiptIcon className="mr-2 h-4 w-4 text-primary" />
                <span className="font-mono font-medium">{inv.number}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  · {inv.customerSnapshot?.name || "Customer"} · ₹{inv.grandTotal}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {quotations.length > 0 && (
          <CommandGroup heading="Quotations">
            {quotations.map((q) => (
              <CommandItem
                key={q.id}
                value={`quotation ${q.number} ${q.customerSnapshot?.name ?? ""}`}
                onSelect={() =>
                  go(`/quotations?q=${encodeURIComponent(q.number)}&id=${q.id}`)
                }
              >
                <FileText className="mr-2 h-4 w-4 text-sky-600" />
                <span className="font-mono font-medium">{q.number}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  · {q.customerSnapshot?.name || "Customer"} · ₹{q.grandTotal}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {customers.length > 0 && (
          <CommandGroup heading="Customers">
            {customers.map((c) => (
              <CommandItem
                key={c.id}
                value={`customer ${c.name} ${c.mobile ?? ""} ${c.gstin ?? ""}`}
                onSelect={() =>
                  go(`/customers?q=${encodeURIComponent(c.name)}&id=${c.id}`)
                }
              >
                <Users className="mr-2 h-4 w-4 text-emerald-600" />
                <span className="font-medium">{c.name}</span>
                {c.company ? (
                  <span className="ml-1 text-xs text-muted-foreground">({c.company})</span>
                ) : null}
                {c.mobile ? (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {c.mobile}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {purchases.length > 0 && (
          <CommandGroup heading="Purchases">
            {purchases.map((pu) => (
              <CommandItem
                key={pu.id}
                value={`purchase ${pu.number} ${pu.supplierSnapshot?.name ?? ""}`}
                onSelect={() =>
                  go(`/purchases?q=${encodeURIComponent(pu.number)}&id=${pu.id}`)
                }
              >
                <ShoppingCart className="mr-2 h-4 w-4 text-indigo-600" />
                <span className="font-mono font-medium">{pu.number}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  · {pu.supplierSnapshot?.name || "Vendor"} · ₹{pu.grandTotal}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {suppliers.length > 0 && (
          <CommandGroup heading="Suppliers">
            {suppliers.map((s) => (
              <CommandItem
                key={s.id}
                value={`supplier ${s.name} ${s.mobile ?? ""}`}
                onSelect={() =>
                  go(`/suppliers?q=${encodeURIComponent(s.name)}&id=${s.id}`)
                }
              >
                <Truck className="mr-2 h-4 w-4 text-amber-600" />
                <span className="font-medium">{s.name}</span>
                {s.company ? (
                  <span className="ml-1 text-xs text-muted-foreground">({s.company})</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {receipts.length > 0 && (
          <CommandGroup heading="Receipts">
            {receipts.map((rec) => (
              <CommandItem
                key={rec.id}
                value={`receipt ${rec.number}`}
                onSelect={() =>
                  go(`/receipts?q=${encodeURIComponent(rec.number)}&id=${rec.id}`)
                }
              >
                <HandCoins className="mr-2 h-4 w-4 text-emerald-600" />
                <span className="font-mono font-medium">{rec.number}</span>
                <span className="ml-2 text-xs text-muted-foreground">· ₹{rec.amount}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {products.length > 0 && (
          <CommandGroup heading="Products">
            {products.map((p) => (
              <CommandItem
                key={p.id}
                value={`product ${p.name} ${p.sku ?? ""}`}
                onSelect={() =>
                  go(`/products?q=${encodeURIComponent(p.name)}&id=${p.id}`)
                }
              >
                <Package className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  ₹{p.sellingPrice}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
