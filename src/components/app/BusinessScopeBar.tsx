import { useState } from "react";
import { Building2, Calendar, GitCompare, ChevronDown } from "lucide-react";
import { useBusinessScope } from "@/modules/company/context/BusinessScopeContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DatePreset, ComparisonMode } from "@/modules/accounting/services/reportingScope";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  this_fy: "This Financial Year",
  mtd: "MTD (Month to Date)",
  custom: "Custom Range",
  all_time: "All Time",
};

export function BusinessScopeBar({
  showComparison = true,
  className = "",
}: {
  showComparison?: boolean;
  className?: string;
}) {
  const {
    activeBranchId,
    activeBranch,
    branches,
    isOwner,
    switchBranch,
    financialYears,
    activeFinancialYear,
    switchFinancialYear,
    datePreset,
    dateRange,
    customFrom,
    customTo,
    setDatePreset,
    setCustomDateRange,
    comparisonMode,
    setComparisonMode,
  } = useBusinessScope();

  const [tempFrom, setTempFrom] = useState(customFrom || dateRange.fromDate);
  const [tempTo, setTempTo] = useState(customTo || dateRange.toDate);
  const [customOpen, setCustomOpen] = useState(false);

  function applyCustomDates() {
    if (tempFrom && tempTo) {
      setCustomDateRange(tempFrom, tempTo);
      setCustomOpen(false);
    }
  }

  // Active scope summary text e.g. "Main Branch • 1 Apr 2026 – 31 Mar 2027"
  const branchLabel = activeBranchId === "all" ? "All Branches" : (activeBranch?.name || "Main Branch");

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 bg-muted/20 px-3.5 py-1.5 text-xs text-muted-foreground backdrop-blur-xs sm:px-6 no-print ${className}`}
    >
      {/* Left side: Branch, FY, and Date Filter */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 1. Branch Selector */}
        {branches.length > 1 || isOwner ? (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
            <Select value={activeBranchId} onValueChange={(val) => switchBranch(val)}>
              <SelectTrigger className="h-7 w-[140px] sm:w-[160px] text-xs font-medium border-border/70 bg-background/80 shadow-2xs">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                {isOwner && (
                  <SelectItem value="all" className="text-xs font-medium">
                    All Branches (Consolidated)
                  </SelectItem>
                )}
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">
                    {b.name} {b.code ? `(${b.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary/60 text-foreground font-medium text-xs border border-border/40">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{branches[0]?.name || "Main Branch"}</span>
          </div>
        )}

        <div className="hidden h-3.5 w-px bg-border/80 sm:block" />

        {/* 2. Financial Year Selector */}
        {financialYears.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select
              value={activeFinancialYear?.id || ""}
              onValueChange={(val) => switchFinancialYear(val)}
            >
              <SelectTrigger className="h-7 w-[125px] sm:w-[135px] text-xs font-medium border-border/70 bg-background/80 shadow-2xs">
                <SelectValue placeholder="FY" />
              </SelectTrigger>
              <SelectContent>
                {financialYears.map((fy) => (
                  <SelectItem key={fy.id} value={fy.id} className="text-xs">
                    {fy.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="hidden h-3.5 w-px bg-border/80 sm:block" />

        {/* 3. Reusable Date Filter System */}
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
          <Select
            value={datePreset}
            onValueChange={(val: DatePreset) => {
              if (val === "custom") {
                setCustomOpen(true);
              } else {
                setDatePreset(val);
              }
            }}
          >
            <SelectTrigger className="h-7 w-[140px] sm:w-[160px] text-xs font-medium border-border/70 bg-background/80 shadow-2xs">
              <SelectValue>{DATE_PRESET_LABELS[datePreset] || "Date Range"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today" className="text-xs">Today</SelectItem>
              <SelectItem value="yesterday" className="text-xs">Yesterday</SelectItem>
              <SelectItem value="this_week" className="text-xs">This Week</SelectItem>
              <SelectItem value="this_month" className="text-xs">This Month</SelectItem>
              <SelectItem value="last_month" className="text-xs">Last Month</SelectItem>
              <SelectItem value="this_quarter" className="text-xs">This Quarter</SelectItem>
              <SelectItem value="this_fy" className="text-xs">This Financial Year</SelectItem>
              <SelectItem value="mtd" className="text-xs">MTD (Month to Date)</SelectItem>
              <SelectItem value="custom" className="text-xs">Custom Range…</SelectItem>
              <SelectItem value="all_time" className="text-xs">All Time</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Date Range Popover */}
          <Popover open={customOpen} onOpenChange={setCustomOpen}>
            <PopoverTrigger asChild>
              <span className="sr-only">Custom Range Picker</span>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 text-xs" align="start">
              <div className="space-y-3">
                <div className="font-semibold text-foreground text-xs">Select Custom Period</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">From</Label>
                    <Input
                      type="date"
                      value={tempFrom}
                      onChange={(e) => setTempFrom(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      value={tempTo}
                      onChange={(e) => setTempTo(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setCustomOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={applyCustomDates}
                    disabled={!tempFrom || !tempTo}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* 4. Comparison Switcher (for analytical views) */}
        {showComparison && (
          <div className="hidden items-center gap-1.5 lg:flex">
            <GitCompare className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            <Select
              value={comparisonMode}
              onValueChange={(val: ComparisonMode) => setComparisonMode(val)}
            >
              <SelectTrigger className="h-7 w-[125px] text-[11px] font-medium border-border/60 bg-background/60 shadow-2xs">
                <SelectValue placeholder="Compare" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">No Comparison</SelectItem>
                <SelectItem value="lmtd" className="text-xs">vs LMTD</SelectItem>
                <SelectItem value="prev_month" className="text-xs">vs Prev Month</SelectItem>
                <SelectItem value="prev_fy" className="text-xs">vs Prev FY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Right side: Subtle active scope indicator */}
      <div className="hidden items-center gap-2 text-[11px] text-muted-foreground/80 md:flex">
        <span className="font-medium text-foreground/80">{branchLabel}</span>
        <span>•</span>
        <span>{dateRange.label || `${dateRange.fromDate} to ${dateRange.toDate}`}</span>
      </div>
    </div>
  );
}
