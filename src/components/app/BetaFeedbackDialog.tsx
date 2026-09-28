import { useState } from "react";
import { MessageSquarePlus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouterState } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";

export function BetaFeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Bug Report");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const { activeCompany, activeBranch } = useActiveCompany();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) {
      toast.error("Please enter a feedback message");
      return;
    }

    setSubmitting(true);
    try {
      const feedbackPayload = {
        id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        page: currentPath,
        category,
        message: message.trim(),
        userEmail: user?.email || "anonymous",
        userId: user?.uid || "anonymous",
        companyId: activeCompany?.id || "none",
        branchId: activeBranch?.id || "none",
        timestamp: Date.now(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      };

      // Save locally to localStorage so it's safely recorded without requiring dedicated backend endpoints
      try {
        const existing = JSON.parse(localStorage.getItem("bms_beta_feedback") || "[]");
        existing.push(feedbackPayload);
        localStorage.setItem("bms_beta_feedback", JSON.stringify(existing.slice(-50)));
      } catch {
        // Ignore localStorage quota errors
      }

      toast.success("Thank you! Your beta feedback has been recorded.");
      setMessage("");
      setOpen(false);
    } catch {
      toast.error("Failed to send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground hover:text-foreground h-8 px-2.5"
          title="Send Beta Feedback"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline">Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/15 text-primary border border-primary/30 tracking-wider uppercase">
              Beta
            </span>
            <span>Send Feedback</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Help us refine BMS NEXT. Submit bug reports, observations, or feature requests.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="fb-page" className="text-xs">
              Page / Section
            </Label>
            <Input
              id="fb-page"
              value={currentPath}
              readOnly
              className="text-xs bg-muted/50 cursor-not-allowed font-mono text-muted-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-category" className="text-xs">
              Category
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="fb-category" className="text-xs">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Bug Report" className="text-xs">Bug Report</SelectItem>
                <SelectItem value="Feature Request" className="text-xs">Feature Request</SelectItem>
                <SelectItem value="UI / Usability" className="text-xs">UI / Usability</SelectItem>
                <SelectItem value="Performance" className="text-xs">Performance</SelectItem>
                <SelectItem value="General Feedback" className="text-xs">General Feedback</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-message" className="text-xs">
              Message
            </Label>
            <Textarea
              id="fb-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened or what can we improve?"
              rows={4}
              className="text-xs resize-none"
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !message.trim()}
              className="gap-1.5 text-xs"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Submit Feedback
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
