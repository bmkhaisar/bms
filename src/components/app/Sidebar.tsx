import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, Truck, Package, Tags, FileText, Receipt, HandCoins,
  ShoppingCart, BookOpen, BarChart3, Settings, HardDriveDownload, Info, Building2, Layers,
  Wifi, WifiOff, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import logo from "@/assets/bms-logo.png.asset.json";
import { CompanySwitcher } from "@/modules/company/components/CompanySwitcher";
import { useEffect, useState } from "react";
import { outboxManager } from "@/modules/sync/outboxManager";
import type { NetworkStatus } from "@/modules/sync/types";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: "OVERVIEW",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: "MASTERS",
    items: [
      { to: "/parties", label: "Party Master", icon: Users },
      { to: "/products", label: "Products & Stock", icon: Package },
      { to: "/categories", label: "Category Master", icon: Tags },
      { to: "/ledger", label: "Ledger & Vouchers", icon: BookOpen },
      { to: "/masters", label: "Quote & Doc Masters", icon: Layers },
    ],
  },
  {
    title: "SALES",
    items: [
      { to: "/quotations", label: "Quotations", icon: FileText },
      { to: "/invoices", label: "Invoices", icon: Receipt },
      { to: "/receipts", label: "Receipts & Inflows", icon: HandCoins },
    ],
  },
  {
    title: "PURCHASE",
    items: [
      { to: "/purchases", label: "Purchases", icon: ShoppingCart },
      { to: "/suppliers", label: "Suppliers & Payables", icon: Truck },
    ],
  },
  {
    title: "FINANCIALS",
    items: [
      { to: "/reports", label: "Reports & GST", icon: BarChart3 },
    ],
  },
  {
    title: "CONFIGURATION",
    items: [
      { to: "/settings", label: "Company Settings", icon: Building2 },
      { to: "/backup", label: "Backup & Sync", icon: HardDriveDownload },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const loc = useLocation();
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("online");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    return outboxManager.subscribeStatus((status, count) => {
      setNetworkStatus(status);
      setPendingCount(count);
    });
  }, []);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground select-none">
      {/* Brand Header */}
      <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3.5">
        <img src={logo.url} alt="BMS logo" className="h-9 w-9 rounded-xl object-contain shadow-xs border border-border/60 bg-card p-0.5" />
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight text-foreground">BMS NEXT</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Business ERP</div>
        </div>
      </div>

      {/* Multi-Company Switcher */}
      <div className="p-2.5 border-b border-border/70 bg-secondary/30">
        <CompanySwitcher />
      </div>

      {/* Grouped Navigation Links */}
      <nav className="flex-1 overflow-y-auto scrollbar-hidden p-2 space-y-3">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-0.5">
            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/75">
              {group.title}
            </div>
            {group.items.map((n) => {
              const active = n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to as unknown as "/"}
                  onClick={onNavigate}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150 active:scale-[0.98]",
                    active
                      ? "bg-accent text-accent-foreground font-semibold shadow-2xs"
                      : "text-sidebar-foreground/75 hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-mint" : "text-muted-foreground group-hover:text-foreground")} />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Realtime / Offline Sync Status Footer */}
      <div className="border-t border-border/70 p-3 text-[11px] text-muted-foreground space-y-1 bg-secondary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-medium">
            {networkStatus === "online" && (
              <>
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-foreground/90">All changes synced</span>
              </>
            )}
            {networkStatus === "syncing" && (
              <>
                <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
                <span className="text-amber-600 dark:text-amber-400">Syncing ({pendingCount})</span>
              </>
            )}
            {networkStatus === "offline" && (
              <>
                <WifiOff className="h-3 w-3 text-rose-500" />
                <span className="text-rose-600 dark:text-rose-400">Working offline</span>
              </>
            )}
          </div>
          {pendingCount > 0 && networkStatus === "offline" && (
            <span className="text-[10px] bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded font-mono font-medium">
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground/70">Continuous Cloud Sync · Offline Safe</div>
      </div>
    </aside>
  );
}
