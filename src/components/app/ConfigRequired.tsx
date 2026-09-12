import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export function ConfigRequired({
  title = "Configuration Required",
  description = "Privileged server operations require Firebase Admin credentials. Please set the required environment variables in your server configuration.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-4">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-lg text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
      <div className="mt-4 rounded-xl bg-muted/60 p-3.5 font-mono text-[11px] text-left text-muted-foreground max-w-md w-full border border-border/50 space-y-1">
        <div className="text-[10px] uppercase font-semibold text-muted-foreground/70 mb-1">Required Server Variables:</div>
        <div>FIREBASE_ADMIN_PROJECT_ID</div>
        <div>FIREBASE_ADMIN_CLIENT_EMAIL</div>
        <div>FIREBASE_ADMIN_PRIVATE_KEY</div>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button variant="default" size="sm" onClick={onRetry} className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="text-xs">
          <Link to="/system-admin">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to System Admin
          </Link>
        </Button>
      </div>
    </div>
  );
}
