import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomerInsightDrawer } from "./CustomerInsightDrawer";
import { SupplierInsightDrawer } from "./SupplierInsightDrawer";
import { normalizeName, normalizeSearchToken } from "@/modules/sync/searchNormalization";
import { formatMoney } from "@/lib/format";
import type { Customer, Supplier } from "@/lib/db";
import {
  Search,
  Plus,
  ChevronRight,
  Info,
  ShieldAlert,
  Check,
  Building2,
  Phone,
  User,
  X,
} from "lucide-react";

interface Props {
  type: "customer" | "supplier";
  value: string;
  parties: Array<Customer | Supplier>;
  onChange: (partyId: string) => void;
  onAddNew: (query?: string) => void;
  disabled?: boolean;
}

export function PartySearchSelect({
  type,
  value,
  parties,
  onChange,
  onAddNew,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedParty = parties.find((p) => p.id === value);

  const normQ = normalizeSearchToken(query);

  const filtered = parties.filter((p) => {
    if (!normQ) return true;
    if (normalizeName(p.name).includes(normQ)) return true;
    if (p.partyCode && p.partyCode.toLowerCase().includes(normQ)) return true;
    if (p.company && normalizeName(p.company).includes(normQ)) return true;
    if ((p as Customer).mobile && String((p as Customer).mobile).includes(query)) return true;
    if ((p as Customer).phone && String((p as Customer).phone).includes(query)) return true;
    if ((p as Customer).gstin && String((p as Customer).gstin).toLowerCase().includes(normQ)) return true;
    if (p.email && p.email.toLowerCase().includes(normQ)) return true;
    if ((p as Customer).city && normalizeName((p as Customer).city).includes(normQ)) return true;
    if ((p as Customer).pincode && String((p as Customer).pincode).includes(query)) return true;
    if (Array.isArray(p.aliases)) {
      for (const a of p.aliases) {
        if (normalizeName(a).includes(normQ)) return true;
      }
    }
    return false;
  });

  const isCustomer = type === "customer";
  const custRecord = isCustomer ? (selectedParty as Customer) : null;
  const creditLimit = custRecord?.creditLimit || 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="w-full justify-between h-9 text-xs font-normal bg-background"
            >
              {selectedParty ? (
                <span className="truncate font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{selectedParty.name}</span>
                  {selectedParty.partyCode && (
                    <span className="shrink-0 font-mono text-[10px] font-semibold text-primary">{selectedParty.partyCode}</span>
                  )}
                  {selectedParty.company && (
                    <span className="text-[11px] text-muted-foreground truncate">({selectedParty.company})</span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">Select {type === "customer" ? "Customer" : "Supplier"}…</span>
              )}
              <Search className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>

          <PopoverContent className="w-[340px] p-2 text-xs" align="start">
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                ref={inputRef}
                placeholder={`Type ${type} name, GSTIN, phone…`}
                className="h-8 pl-8 text-xs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1 scrollbar-hidden">
              {query && filtered.length === 0 && (
                <div className="p-2 text-center text-muted-foreground">
                  No matching {type} found.
                </div>
              )}

              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onAddNew(query);
                  }}
                  className="w-full text-left p-2 rounded-md hover:bg-primary/10 text-primary font-semibold flex items-center gap-1.5 transition-colors border border-dashed border-primary/40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  + Add "{query}" as a new {type}
                </button>
              )}

              {filtered.map((p) => {
                const isSelected = p.id === value;
                const pol = (p as any).paymentPolicy || "CREDIT";
                const locStr = [(p as Customer).city, (p as Customer).pincode].filter(Boolean).join(" - ");
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-accent/60 transition-colors ${
                      isSelected ? "bg-accent/80 font-semibold" : ""
                    }`}
                  >
                    <div className="space-y-0.5 truncate pr-2">
                      <div className="truncate text-foreground flex items-center gap-1.5">
                        <span className="font-medium">{p.name}</span>
                        {p.company && (
                          <span className="text-[10px] text-muted-foreground font-normal">({p.company})</span>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 h-4 font-semibold ${
                            pol === "ADVANCE"
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                          }`}
                        >
                          {pol}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate flex items-center gap-2">
                        {p.partyCode && <span className="font-mono font-semibold text-primary">{p.partyCode}</span>}
                        {p.gstin && <span className="font-mono">{p.gstin}</span>}
                        {(p as Customer).mobile && <span>{(p as Customer).mobile}</span>}
                        {locStr && <span>&bull; {locStr}</span>}
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {selectedParty && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setInsightOpen(true)}
            className="h-9 px-2.5 gap-1 shrink-0 text-xs font-semibold text-primary hover:bg-primary/10"
            title={`View ${selectedParty.name} Financial Insight`}
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Insight</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Credit Limit & Terms if Customer */}
      {isCustomer && (creditLimit > 0 || typeof custRecord?.creditDays === "number") && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {creditLimit > 0 && (
            <>
              <span>Credit Limit:</span>
              <span className="font-mono font-medium text-foreground">{formatMoney(creditLimit)}</span>
            </>
          )}
          {typeof custRecord?.creditDays === "number" && (
            <span>{creditLimit > 0 ? "·" : ""} Terms: {custRecord.creditDays === 0 ? "Due Immediately (0d)" : `${custRecord.creditDays} days`}</span>
          )}
        </div>
      )}

      {/* Slide-over Insights */}
      {isCustomer ? (
        <CustomerInsightDrawer
          customerId={value || null}
          open={insightOpen}
          onOpenChange={setInsightOpen}
        />
      ) : (
        <SupplierInsightDrawer
          supplierId={value || null}
          open={insightOpen}
          onOpenChange={setInsightOpen}
        />
      )}
    </div>
  );
}
