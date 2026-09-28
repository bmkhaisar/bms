import { useActiveCompany } from "../context/ActiveCompanyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, ChevronsUpDown, Calendar, GitBranch, Layers } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

export function CompanySwitcher() {
  const {
    companies,
    activeCompany,
    activeMembership,
    financialYears,
    activeFinancialYear,
    branches,
    activeBranchId,
    activeBranch,
    isAllBranches,
    isOwner,
    switchCompany,
    switchFinancialYear,
    switchBranch,
  } = useActiveCompany();
  const nav = useNavigate();

  if (!activeCompany) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => nav({ to: "/select-company" as any })}
        className="w-full justify-start gap-2 text-xs"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span>Select Company</span>
      </Button>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Company Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between p-2 text-left hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                {activeCompany.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-foreground">
                  <span className="truncate">{activeCompany.name}</span>
                  {(activeCompany.isDemo || activeCompany.organizationType === "DEMO") && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0 tracking-wider">
                      DEMO
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge variant="outline" className="text-[10px] px-1 py-0 uppercase">
                    {activeMembership?.role || "viewer"}
                  </Badge>
                  {activeCompany.gstin && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {activeCompany.gstin}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">My Companies</DropdownMenuLabel>
          {companies.map((c) => {
            const isCurrent = c.id === activeCompany.id;
            return (
              <DropdownMenuItem
                key={c.id}
                onClick={() => switchCompany(c.id)}
                className="flex items-center justify-between text-xs"
              >
                <div className="truncate">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">{c.name}</span>
                    {(c.isDemo || c.organizationType === "DEMO") && (
                      <span className="text-[9px] px-1 py-0 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0 font-semibold">
                        DEMO
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground capitalize">{c.role}</div>
                </div>
                {isCurrent && <Check className="h-4 w-4 text-primary ml-2 shrink-0" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Branch Selector (PRD § 12) */}
      {(branches.length > 0 || isOwner) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full justify-between px-2 text-[11px] font-normal text-muted-foreground bg-background/50 border-border/70"
            >
              <div className="flex items-center gap-1.5 truncate">
                {isAllBranches ? (
                  <Layers className="h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">
                  Branch: {isAllBranches ? "All Branches (Consolidated)" : activeBranch?.name || "Select Branch"}
                </span>
              </div>
              <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Branch Context</DropdownMenuLabel>

            {/* Owner Consolidated View Option (PRD § 12, 13) */}
            {isOwner && (
              <DropdownMenuItem
                onClick={() => switchBranch("all")}
                className="flex items-center justify-between text-xs font-medium"
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span>All Branches (Consolidated)</span>
                </div>
                {isAllBranches && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            )}

            {isOwner && branches.length > 0 && <DropdownMenuSeparator />}

            {/* Assigned Branches List */}
            {branches.map((b) => {
              const isSelected = !isAllBranches && activeBranchId === b.id;
              return (
                <DropdownMenuItem
                  key={b.id}
                  onClick={() => switchBranch(b.id)}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{b.name}</span>
                      {b.isMainBranch && (
                        <span className="text-[9px] px-1 py-0 rounded bg-primary/10 text-primary font-semibold">
                          Main
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Code: {b.code} {b.city ? `• ${b.city}` : ""}
                    </div>
                  </div>
                  {isSelected && <Check className="h-3.5 w-3.5 text-primary ml-2 shrink-0" />}
                </DropdownMenuItem>
              );
            })}

          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Financial Year Selector */}
      {financialYears.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full justify-between px-2 text-[11px] font-normal text-muted-foreground bg-background/50 border-border/70"
            >
              <div className="flex items-center gap-1.5 truncate">
                <Calendar className="h-3 w-3 shrink-0" />
                <span>FY: {activeFinancialYear?.name || "Select Year"}</span>
              </div>
              <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Financial Years</DropdownMenuLabel>
            {financialYears.map((fy) => {
              const isCurrent = fy.id === activeFinancialYear?.id;
              return (
                <DropdownMenuItem
                  key={fy.id}
                  onClick={() => switchFinancialYear(fy.id)}
                  className="flex items-center justify-between text-xs"
                >
                  <span>{fy.name}</span>
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

