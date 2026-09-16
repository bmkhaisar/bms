import { useNavigate } from "@tanstack/react-router";
import { LogOut, Moon, Sun, Menu, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { GlobalSearch } from "./GlobalSearch";

export function Topbar({ title }: { title: string }) {
  const nav = useNavigate();
  const [dark, setDark] = useState(false);
  const [openLogout, setOpenLogout] = useState(false);
  const [openSearch, setOpenSearch] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("bms_theme") === "dark";
    setDark(t);
    document.documentElement.classList.toggle("dark", t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { user, isPlatformAdmin, signOut } = useAuth();

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("bms_theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  async function handleLogout() {
    await signOut();
    nav({ to: "/login" });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-border/70 bg-card/85 px-3.5 backdrop-blur-md sm:px-6 no-print">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0 border-r border-border/70">
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <h1 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpenSearch(true)} className="gap-2">
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] sm:inline">⌘K</kbd>
        </Button>
        {isPlatformAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => nav({ to: "/system-admin" as any })}
            className="gap-1.5 text-xs border-border/80 text-foreground hover:bg-secondary/60"
            title="Platform System Administration"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-mint" />
            <span className="hidden sm:inline">System Admin</span>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setOpenLogout(true)} aria-label="Logout">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <ConfirmDialog
        open={openLogout}
        onOpenChange={setOpenLogout}
        title="Log out?"
        description="You'll need to sign in again to access your data."
        confirmText="Log out"
        onConfirm={handleLogout}
      />
      <GlobalSearch open={openSearch} onOpenChange={setOpenSearch} />
    </header>
  );
}
