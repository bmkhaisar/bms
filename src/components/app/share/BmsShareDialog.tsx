import { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Mail,
  MessageCircle,
  Share2,
  Download,
  Copy,
  Check,
  AlertCircle,
  Info,
  Loader2,
  FileText,
  ExternalLink,
  Phone,
  User,
  Building,
} from "lucide-react";
import type { ShareDocumentData, SharePartyInfo } from "@/modules/documents/sharing/bmsShareTypes";
import {
  generateEmailSubject,
  generateEmailBody,
  generateReminderEmailSubject,
  generateReminderEmailBody,
  generateWhatsAppMessage,
  generateReminderWhatsAppMessage,
  buildGmailComposeUrl,
  buildMailtoUrl,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
  isPhoneAmbiguous,
} from "@/modules/documents/sharing/bmsShareMessageService";
import { resolvePartyContact } from "@/modules/documents/sharing/partyContactResolver";

export type ShareDialogMode = "share" | "reminder";

interface BmsShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ShareDocumentData | null;
  mode?: ShareDialogMode; // Defaults to "share"
}

export function BmsShareDialog({
  open,
  onOpenChange,
  document: doc,
  mode = "share",
}: BmsShareDialogProps) {
  // Ephemeral session-only state per PRD § 30 (discarded on dialog close)
  const [resolvedParty, setResolvedParty] = useState<SharePartyInfo | null>(null);
  const [loadingParty, setLoadingParty] = useState(false);

  // Email channel session state
  const [emailMode, setEmailMode] = useState<"confirmed" | "custom">("confirmed");
  const [customEmail, setCustomEmail] = useState("");

  // WhatsApp channel session state
  const [phoneMode, setPhoneMode] = useState<"confirmed" | "custom">("confirmed");
  const [customPhone, setCustomPhone] = useState("");

  // PDF preparation for Native Web Share (Correction 4) & download tracking
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfDownloaded, setPdfDownloaded] = useState(false);
  const [preparingPdf, setPreparingPdf] = useState(false);
  const [activeChannel, setActiveChannel] = useState<"none" | "email" | "whatsapp">("none");
  const [copiedMessage, setCopiedMessage] = useState(false);

  // Reset all ephemeral session state whenever dialog opens/closes
  useEffect(() => {
    if (!open || !doc) {
      setResolvedParty(null);
      setEmailMode("confirmed");
      setCustomEmail("");
      setPhoneMode("confirmed");
      setCustomPhone("");
      setPdfBlob(null);
      setPdfFile(null);
      setPdfDownloaded(false);
      setPreparingPdf(false);
      setActiveChannel("none");
      setCopiedMessage(false);
      return;
    }

    // Resolve canonical contact from Party Master by partyId (PRD § 3 & Correction 3)
    let isMounted = true;
    setLoadingParty(true);
    resolvePartyContact(doc.party.partyId, doc.party)
      .then((partyInfo: SharePartyInfo) => {
        if (isMounted) {
          setResolvedParty(partyInfo);
          setEmailMode(partyInfo.email ? "confirmed" : "custom");
          setPhoneMode(partyInfo.phone ? "confirmed" : "custom");
        }
      })
      .finally(() => {
        if (isMounted) setLoadingParty(false);
      });

    // Pre-generate canonical PDF Blob on open so Native Share is synchronous on click (Correction 4)
    if (mode === "share") {
      setPreparingPdf(true);
      doc
        .generatePdfBlob()
        .then((blob: Blob) => {
          if (!isMounted) return;
          setPdfBlob(blob);
          const cleanDocNum = doc.documentNumber.replace(/[/\\?%*:|"<>]/g, "-");
          const file = new File([blob], `${cleanDocNum}.pdf`, { type: "application/pdf" });
          setPdfFile(file);
        })
        .catch((err: unknown) => {
          console.error("Failed to prepare PDF blob for share session:", err);
        })
        .finally(() => {
          if (isMounted) setPreparingPdf(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [open, doc, mode]);

  if (!doc) return null;

  // Active recipient email
  const effectiveEmail =
    emailMode === "confirmed" && resolvedParty?.email
      ? resolvedParty.email
      : customEmail.trim();

  // Active recipient phone
  const effectivePhone =
    phoneMode === "confirmed" && resolvedParty?.phone
      ? resolvedParty.phone
      : customPhone.trim();

  // Generated messages
  const emailSubject =
    mode === "reminder" ? generateReminderEmailSubject(doc) : generateEmailSubject(doc);
  const emailBody =
    mode === "reminder" ? generateReminderEmailBody(doc) : generateEmailBody(doc);
  const whatsAppMessage =
    mode === "reminder"
      ? generateReminderWhatsAppMessage(doc)
      : generateWhatsAppMessage(doc);

  const defaultCc = doc.company.defaultShareCcEmail?.trim() || "";

  // Web Share API support detection
  const isWebShareSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    Boolean(pdfFile && navigator.canShare({ files: [pdfFile] }));

  // Handlers
  const handleDownloadPdf = async () => {
    try {
      let blob = pdfBlob;
      if (!blob) {
        setPreparingPdf(true);
        blob = await doc.generatePdfBlob();
        setPdfBlob(blob);
      }
      if (!blob) throw new Error("Could not create PDF blob.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const cleanDocNum = doc.documentNumber.replace(/[/\\?%*:|"<>]/g, "-");
      a.href = url;
      a.download = `${cleanDocNum}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setPdfDownloaded(true);
      toast.success(`Downloaded ${cleanDocNum}.pdf`);
    } catch (err) {
      console.error("Download failed:", err);
      toast.error("Failed to download PDF");
    } finally {
      setPreparingPdf(false);
    }
  };

  const handleNativeShare = async () => {
    if (!pdfFile || !navigator.share) {
      toast.error("Native file sharing is not supported on this device");
      return;
    }
    try {
      await navigator.share({
        files: [pdfFile],
        title: emailSubject,
        text: whatsAppMessage,
      });
      // User shared or dismissed sheet
      toast.info("Native share completed");
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Native share error:", err);
        toast.error("Could not complete native share. Please use Email or WhatsApp.");
      }
    }
  };

  const handleOpenGmail = () => {
    if (!effectiveEmail) {
      toast.error("Please provide a recipient email address");
      return;
    }
    const url = buildGmailComposeUrl({
      to: effectiveEmail,
      cc: defaultCc,
      subject: emailSubject,
      body: emailBody,
    });
    window.open(url, "_blank");
    // Strictly follow PRD § 34 (never claim "sent")
    toast.info("Gmail opened with your message prepared.");
  };

  const handleOpenMailto = () => {
    if (!effectiveEmail) {
      toast.error("Please provide a recipient email address");
      return;
    }
    const url = buildMailtoUrl({
      to: effectiveEmail,
      cc: defaultCc,
      subject: emailSubject,
      body: emailBody,
    });
    window.location.href = url;
    toast.info("Email client opened with your message prepared.");
  };

  const handleOpenWhatsApp = () => {
    if (!effectivePhone) {
      toast.error("Please provide a recipient phone number");
      return;
    }
    const url = buildWhatsAppUrl({
      phone: effectivePhone,
      country: resolvedParty?.country,
      message: whatsAppMessage,
    });
    window.open(url, "_blank");
    // Strictly follow PRD § 34 (never claim "sent")
    toast.info("WhatsApp opened with your message prepared.");
  };

  const handleCopyMessage = () => {
    const textToCopy = activeChannel === "email" ? `${emailSubject}\n\n${emailBody}` : whatsAppMessage;
    navigator.clipboard.writeText(textToCopy);
    setCopiedMessage(true);
    toast.success("Message copied to clipboard");
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const documentTypeLabel =
    doc.kind === "quotation"
      ? "Quotation"
      : doc.kind === "invoice"
      ? "Invoice"
      : "Receipt Voucher";

  const partyCodeDisplay = resolvedParty?.partyCode || doc.party.partyCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92dvh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-2xl">
        {/* Header */}
        <DialogHeader className="border-b shrink-0 px-6 py-4 bg-background/95">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                {mode === "reminder" ? <Mail className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  {mode === "reminder"
                    ? `Send Payment Reminder — ${doc.documentNumber}`
                    : `Share ${documentTypeLabel} — ${doc.documentNumber}`}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {mode === "reminder"
                    ? "Prepare a polite, professional payment reminder for manual review."
                    : "Native sharing, Gmail web compose, WhatsApp click-to-chat & PDF export."}
                </DialogDescription>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {doc.documentNumber}
            </Badge>
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-4 text-xs">
          {/* Customer Contact Resolution Card (PRD § 3) */}
          <div className="rounded-xl border bg-muted/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-muted-foreground font-semibold text-[11px] uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-primary" /> Customer Contact (Party Master)
              </span>
              {loadingParty && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-normal">
                  <Loader2 className="h-3 w-3 animate-spin" /> Resolving…
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground text-[10px]">Customer</div>
                <div className="font-semibold text-foreground">{resolvedParty?.name || doc.party.name}</div>
                {partyCodeDisplay && (
                  <div className="font-mono text-[10px] text-muted-foreground">{partyCodeDisplay}</div>
                )}
              </div>

              <div>
                <div className="text-muted-foreground text-[10px]">Company</div>
                <div className="font-medium text-foreground">
                  {resolvedParty?.companyName || doc.party.companyName || "—"}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground text-[10px]">Email</div>
                <div className="font-medium text-foreground truncate">
                  {resolvedParty?.email || <span className="text-muted-foreground italic">No email saved</span>}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground text-[10px]">Phone</div>
                <div className="font-mono text-foreground">
                  {resolvedParty?.phone || <span className="text-muted-foreground italic">No phone saved</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Primary Channel Selectors */}
          <div className="space-y-2">
            <div className="text-muted-foreground font-semibold text-[11px] uppercase tracking-wider">
              Select Sharing Channel
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Email Option */}
              <button
                type="button"
                onClick={() => setActiveChannel("email")}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                  activeChannel === "email"
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/70 hover:bg-muted/40"
                }`}
              >
                <div className="h-8 w-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">Email</div>
                  <div className="text-[10px] text-muted-foreground">Gmail / Default Mail</div>
                </div>
              </button>

              {/* WhatsApp Option */}
              <button
                type="button"
                onClick={() => setActiveChannel("whatsapp")}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                  activeChannel === "whatsapp"
                    ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                    : "border-border/70 hover:bg-muted/40"
                }`}
              >
                <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">WhatsApp</div>
                  <div className="text-[10px] text-muted-foreground">wa.me click-to-chat</div>
                </div>
              </button>
            </div>
          </div>

          {/* Only in Share Mode: Native Share & Download buttons */}
          {mode === "share" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* Native Share button (Correction 4: user-gesture triggered with pre-generated file) */}
              {isWebShareSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleNativeShare}
                  disabled={preparingPdf || !pdfFile}
                  className="gap-1.5 h-8 text-xs font-semibold"
                >
                  {preparingPdf ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5 text-primary" />
                  )}
                  Share PDF (Native)
                </Button>
              )}

              {/* Download PDF button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={preparingPdf}
                className="gap-1.5 h-8 text-xs"
              >
                {preparingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                )}
                {pdfDownloaded ? "PDF Ready (Download Again)" : "Download PDF"}
              </Button>
            </div>
          )}

          {/* EMAIL CHANNEL VIEW */}
          {activeChannel === "email" && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-blue-600" /> Email Configuration
                </span>
                <span className="text-[10px] text-muted-foreground">Manual Compose</span>
              </div>

              {/* Email Contact Choice (PRD § 4 & 5) */}
              {resolvedParty?.email ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Email found in Party Master:</span>
                    <Badge variant="secondary" className="font-normal font-mono text-[10px]">
                      {resolvedParty.email}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={emailMode === "confirmed" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setEmailMode("confirmed")}
                    >
                      Use This Email
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={emailMode === "custom" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setEmailMode("custom")}
                    >
                      Use Different Email
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                  No email address is saved for this customer in Party Master.
                </div>
              )}

              {/* Temporary Email Input */}
              {(emailMode === "custom" || !resolvedParty?.email) && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs">Temporary Recipient Email</Label>
                  <Input
                    type="email"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    placeholder="customer@example.com"
                    className="h-8 text-xs bg-background"
                  />
                  <div className="text-[10px] text-amber-600 dark:text-amber-400">
                    This email will be used only for this message. It will not be saved to Party Master. To save it permanently, update the customer in Party Master.
                  </div>
                </div>
              )}

              {/* CC Notice */}
              {defaultCc && (
                <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>Default CC (Company):</span>
                  <span className="font-mono text-foreground">{defaultCc}</span>
                </div>
              )}

              {/* Email Content Preview */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Subject</Label>
                <div className="font-semibold text-foreground text-xs p-2 rounded-lg bg-background border truncate">
                  {emailSubject}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Message Preview</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={handleCopyMessage}
                  >
                    {copiedMessage ? <Check className="h-3 w-3 text-mint" /> : <Copy className="h-3 w-3" />}
                    Copy Message
                  </Button>
                </div>
                <pre className="text-[11px] font-sans bg-background border rounded-lg p-3 whitespace-pre-wrap max-h-36 overflow-y-auto text-muted-foreground leading-relaxed">
                  {emailBody}
                </pre>
              </div>

              {/* PRD § 6: Two-step PDF attachment limitation alert */}
              {mode === "share" && (
                <div className="rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-100/40 dark:bg-blue-950/40 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-foreground">
                        {pdfDownloaded ? "PDF Ready" : "Two-Step Send Experience"}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Please attach the downloaded PDF to the email before sending. BMS has prepared the recipient, subject and message for you.
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!pdfDownloaded && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleDownloadPdf}
                        disabled={preparingPdf}
                        className="h-8 text-xs gap-1.5 bg-background"
                      >
                        <Download className="h-3.5 w-3.5 text-blue-600" />
                        Step 1: Download PDF
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={handleOpenGmail}
                      className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {pdfDownloaded ? "Open Gmail" : "Step 2: Open Gmail"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleOpenMailto}
                      className="h-8 text-xs text-muted-foreground"
                    >
                      Default Email App (mailto)
                    </Button>
                  </div>
                </div>
              )}

              {mode === "reminder" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={handleOpenGmail}
                    className="h-8 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Gmail
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleOpenMailto}
                    className="h-8 text-xs"
                  >
                    Default Email App
                  </Button>
                </div>
              )}

              {/* PRD § 13: Sender Behavior notice */}
              <div className="text-[10px] text-muted-foreground italic">
                Email will be sent using the account selected in your mail application.
              </div>
            </div>
          )}

          {/* WHATSAPP CHANNEL VIEW */}
          {activeChannel === "whatsapp" && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> WhatsApp Configuration
                </span>
                <span className="text-[10px] text-muted-foreground">Click-to-Chat</span>
              </div>

              {/* Phone Contact Choice (PRD § 14 & 15) */}
              {resolvedParty?.phone ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Phone found in Party Master:</span>
                    <Badge variant="secondary" className="font-normal font-mono text-[10px]">
                      {resolvedParty.phone}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={phoneMode === "confirmed" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setPhoneMode("confirmed")}
                    >
                      Use This Number
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={phoneMode === "custom" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setPhoneMode("custom")}
                    >
                      Use Different Number
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                  No phone number is saved for this customer in Party Master.
                </div>
              )}

              {/* Temporary Phone Input */}
              {(phoneMode === "custom" || !resolvedParty?.phone) && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-xs">Temporary WhatsApp Number</Label>
                  <Input
                    type="tel"
                    value={customPhone}
                    onChange={(e) => setCustomPhone(e.target.value)}
                    placeholder="+91 9876543210"
                    className="h-8 text-xs bg-background"
                  />
                  <div className="text-[10px] text-amber-600 dark:text-amber-400">
                    This number will be used only for this share and will not be saved to Party Master.
                  </div>
                </div>
              )}

              {/* WhatsApp Normalized Number Preview (PRD § 14 & Correction 5) */}
              {effectivePhone && (
                <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>Normalized WhatsApp Number:</span>
                  <span className="font-mono font-semibold text-foreground">
                    +{normalizeWhatsAppPhone(effectivePhone, resolvedParty?.country)}
                  </span>
                </div>
              )}

              {/* WhatsApp Message Preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Message Preview</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={handleCopyMessage}
                  >
                    {copiedMessage ? <Check className="h-3 w-3 text-mint" /> : <Copy className="h-3 w-3" />}
                    Copy Message
                  </Button>
                </div>
                <pre className="text-[11px] font-sans bg-background border rounded-lg p-3 whitespace-pre-wrap max-h-36 overflow-y-auto text-muted-foreground leading-relaxed">
                  {whatsAppMessage}
                </pre>
              </div>

              {/* PRD § 16: WhatsApp + PDF Limitation */}
              {mode === "share" && (
                <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-100/40 dark:bg-emerald-950/40 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <Info className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-foreground">Attach Downloaded PDF</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Please attach the downloaded PDF before sending. WhatsApp links prefill text only.
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!pdfDownloaded && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleDownloadPdf}
                        disabled={preparingPdf}
                        className="h-8 text-xs gap-1.5 bg-background"
                      >
                        <Download className="h-3.5 w-3.5 text-blue-600" />
                        1. Download PDF
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={handleOpenWhatsApp}
                      className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {pdfDownloaded ? "Open WhatsApp" : "2. Open WhatsApp"}
                    </Button>
                  </div>
                </div>
              )}

              {mode === "reminder" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={handleOpenWhatsApp}
                    className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open WhatsApp
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="p-3 border-t bg-muted/20 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>

          <div className="flex items-center gap-2">
            {mode === "share" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={preparingPdf}
                className="text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
