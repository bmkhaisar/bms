import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Smartphone, Monitor } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    // Check if running in standalone PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    // Check dismissal cooldown (dismiss for 7 days)
    const dismissedAt = localStorage.getItem("bms_pwa_dismissed_at");
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 7 * 24 * 60 * 60 * 1000) {
      setIsDismissed(true);
    } else {
      setIsDismissed(false);
    }

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsDismissed(false);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSHelp(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem("bms_pwa_dismissed_at", Date.now().toString());
  };

  if (isInstalled || isDismissed) {
    return null;
  }

  // Show only if native prompt is available OR if on iOS safari
  if (!deferredPrompt && !isIOS) {
    return null;
  }

  return (
    <div className="relative mx-auto mb-4 flex items-center justify-between rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-3 sm:p-4 text-xs shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
          <Download className="h-5 w-5 animate-bounce" />
        </div>
        <div>
          <div className="font-semibold text-foreground flex items-center gap-1.5">
            Install BMS NEXT for Desktop & Mobile
            <span className="rounded bg-primary/20 px-1.5 py-0.2 text-[10px] font-mono text-primary uppercase font-bold">
              PWA
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Lightning fast access, offline caching, native window mode, and zero browser tab clutter.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showIOSHelp ? (
          <div className="text-right text-[11px] text-primary font-medium">
            Tap <span className="font-bold">Share</span> and select <span className="font-bold">"Add to Home Screen"</span>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={handleInstallClick}
            className="gap-1.5 shadow-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            Install App
          </Button>
        )}
        <button
          onClick={handleDismiss}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
