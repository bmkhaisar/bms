import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, Download, Printer, Pencil, FileCheck, X, Building2, Calendar, MapPin, ShieldCheck } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { db, type Quotation, type Customer, type CompanySettings, type QuotationTemplate } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useLive } from "@/lib/useLive";
import { downloadQuotationPDF, printQuotationPDF } from "@/lib/quotationExport";
import { formatAddressLines } from "./AddressDrawer";

interface QuotationQuickPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotation: Quotation | null;
  onEdit?: (q: Quotation) => void;
  onConvert?: (q: Quotation) => void;
}

export function QuotationQuickPreviewModal({
  open,
  onOpenChange,
  quotation,
  onEdit,
  onConvert,
}: QuotationQuickPreviewModalProps) {
  const { activeCompany } = useActiveCompany();
  const customers = useLive<Customer>(() => db().customers.toArray());
  const companySettingsList = useLive<CompanySettings>(() => db().companySettings.toArray());
  const companySettings = companySettingsList[0];

  if (!quotation) return null;

  const comp = quotation.companySnapshot || activeCompany || companySettings;
  const cust = quotation.customerSnapshot || customers.find((c) => c.id === quotation.customerId);
  const companyLogo = comp?.logoUrl || (comp as any)?.logo;

  const subtotal = quotation.subtotal || 0;
  const discountTotal = quotation.discountTotal || 0;
  const gstTotal = quotation.gstTotal || 0;
  const roundOff = quotation.roundOff || 0;
  const grandTotal = quotation.grandTotal || 0;
  const extraCharges = quotation.extraCharges || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b bg-muted/20 flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-primary" />
            Quotation Preview — {quotation.number}
            <Badge variant="outline" className="ml-2 uppercase text-[10px]">
              {quotation.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable Document Body matching PDF */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs bg-white text-slate-900">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start justify-between gap-4 border-b pb-4">
            <div className="flex items-center gap-3">
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={comp?.name || "Company Logo"}
                  className="h-14 w-14 object-contain rounded border p-1"
                />
              ) : (
                <div className="h-14 w-14 rounded bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xl">
                  {comp?.name ? comp.name.slice(0, 2).toUpperCase() : "BH"}
                </div>
              )}
              <div>
                <h1 className="text-base font-bold text-slate-950">{comp?.name || "Your Company"}</h1>
                <div className="text-[11px] text-slate-600 max-w-sm">
                  {[comp?.address, comp?.city, [comp?.state, comp?.pincode].filter(Boolean).join(" - "), comp?.country].filter(Boolean).join(", ")}
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap gap-x-3">
                  {comp?.gstin && <span><strong>GSTIN:</strong> {comp.gstin}</span>}
                  {comp?.phone && <span><strong>Phone:</strong> {comp.phone}</span>}
                  {comp?.email && <span><strong>Email:</strong> {comp.email}</span>}
                </div>
              </div>
            </div>

            <div className="text-right sm:self-start space-y-1">
              <div className="text-lg font-black tracking-tight text-primary uppercase">QUOTATION</div>
              <div className="text-xs font-mono font-bold">{quotation.number}</div>
              <div className="text-[11px] text-slate-600">Date: {formatDate(quotation.date)}</div>
              {quotation.validity && (
                <div className="text-[11px] text-emerald-700 font-semibold">
                  Valid Until: {formatDate(quotation.validity)}
                </div>
              )}
            </div>
          </div>

          {/* Customer & Billing Address Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-1">Customer Details</div>
              <div className="font-bold text-slate-900">{cust?.name || "Valued Customer"}</div>
              {cust?.company && <div className="text-slate-600">{cust.company}</div>}
              {cust?.gstin && <div className="font-mono text-[11px] text-slate-700">GSTIN: {cust.gstin}</div>}
              {cust?.mobile && <div className="text-slate-600">Mobile: {cust.mobile}</div>}
              {cust?.email && <div className="text-slate-600">Email: {cust.email}</div>}
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider mb-1">Billing & Shipping Address</div>
              {quotation.billingAddressSnapshot ? (
                <div className="text-slate-700 whitespace-pre-line leading-relaxed">
                  {formatAddressLines(quotation.billingAddressSnapshot)}
                </div>
              ) : (
                <div className="text-slate-700">
                  {[cust?.billingAddress || cust?.address, cust?.city, [cust?.state, cust?.pincode].filter(Boolean).join(" - "), cust?.country || "India"].filter(Boolean).join(", ") || "Same as customer address"}
                </div>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="border rounded-lg overflow-hidden">
            <Table className="text-xs">
              <TableHeader className="bg-slate-100">
                <TableRow>
                  <TableHead className="w-8 text-center text-slate-700">#</TableHead>
                  <TableHead className="text-slate-700">Item & Description</TableHead>
                  <TableHead className="text-center text-slate-700">Measurements</TableHead>
                  <TableHead className="text-right text-slate-700">Qty / Unit</TableHead>
                  <TableHead className="text-right text-slate-700">Rate</TableHead>
                  <TableHead className="text-right text-slate-700">Discount</TableHead>
                  <TableHead className="text-right text-slate-700">Tax</TableHead>
                  <TableHead className="text-right text-slate-700 font-bold">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotation.items.map((item, idx) => (
                  <TableRow key={idx} className="border-b border-slate-100">
                    <TableCell className="text-center text-slate-500 py-2">{idx + 1}</TableCell>
                    <TableCell className="py-2">
                      <div className="font-semibold text-slate-900">{item.name}</div>
                      {item.description && <div className="text-[10px] text-slate-500 line-clamp-1">{item.description}</div>}
                      {item.hsn && <div className="text-[10px] font-mono text-slate-400">HSN: {item.hsn}</div>}
                    </TableCell>
                    <TableCell className="text-center py-2">
                      {item.measurementSummary || (item.measurements && item.measurements.length > 0 ? (
                        <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.measurements.map((m) => `${m.width}×${m.height} (${m.pieces} pcs)`).join(", ")}
                        </span>
                      ) : (
                        "—"
                      ))}
                    </TableCell>
                    <TableCell className="text-right py-2 font-mono">
                      {item.quantity} {item.unit || "Nos"}
                    </TableCell>
                    <TableCell className="text-right py-2 font-mono">{formatMoney(item.rate)}</TableCell>
                    <TableCell className="text-right py-2 font-mono">
                      {item.discountPct > 0 ? `${item.discountPct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right py-2 font-mono">
                      {item.gstRate > 0 ? `${item.gstRate}%` : "0%"}
                    </TableCell>
                    <TableCell className="text-right py-2 font-mono font-semibold text-slate-900">
                      {formatMoney(item.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Charges & Totals Summary */}
          <div className="flex flex-col sm:flex-row justify-between gap-6 pt-2">
            <div className="flex-1 space-y-3">
              {extraCharges.length > 0 && (
                <div className="p-2.5 rounded border bg-slate-50 space-y-1">
                  <div className="font-semibold text-[11px] text-slate-700">Additional Charges</div>
                  {extraCharges.map((chg, cIdx) => (
                    <div key={cIdx} className="flex justify-between text-[11px] text-slate-600">
                      <span>{chg.label}</span>
                      <span className="font-mono">{formatMoney(chg.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {quotation.notes && (
                <div className="p-2.5 rounded border bg-slate-50 space-y-1">
                  <div className="font-semibold text-[11px] text-slate-700">Notes & Commercial Terms</div>
                  <div className="text-[11px] text-slate-600 whitespace-pre-line">{quotation.notes}</div>
                </div>
              )}
            </div>

            <div className="w-full sm:w-72 space-y-1.5 p-3 rounded-lg border bg-slate-50 text-slate-800">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Subtotal:</span>
                <span className="font-mono">{formatMoney(subtotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-xs text-red-600">
                  <span>Discount:</span>
                  <span className="font-mono">-{formatMoney(discountTotal)}</span>
                </div>
              )}
              {gstTotal > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">GST Output:</span>
                  <span className="font-mono">{formatMoney(gstTotal)}</span>
                </div>
              )}
              {roundOff !== 0 && (
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Round Off:</span>
                  <span className="font-mono">{formatMoney(roundOff)}</span>
                </div>
              )}
              <div className="border-t pt-1.5 mt-1 flex justify-between text-sm font-bold text-slate-950">
                <span>Grand Total:</span>
                <span className="font-mono text-primary text-base">{formatMoney(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Signatory & Bank Details */}
          <div className="flex flex-col sm:flex-row items-end justify-between gap-4 pt-4 border-t">
            <div className="text-[11px] text-slate-500">
              {comp?.bankName && (
                <div>
                  <strong>Bank:</strong> {comp.bankName} &bull; <strong>A/C:</strong> {comp.bankAccount} &bull; <strong>IFSC:</strong> {comp.bankIfsc}
                </div>
              )}
              <div className="mt-1">Computer generated quotation. Subject to confirmation.</div>
            </div>

            <div className="text-right space-y-1">
              <div className="text-[11px] font-semibold text-slate-700">For {comp?.name || "Company"}</div>
              {comp?.signature && (
                <img src={comp.signature} alt="Signature" className="h-10 ml-auto object-contain" />
              )}
              <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-300">
                {comp?.authorizedSignatory || "Authorized Signatory"}
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <DialogFooter className="p-3 border-t bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  onOpenChange(false);
                  onEdit(quotation);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}

            {onConvert && quotation.status !== "converted" && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 text-primary"
                onClick={() => {
                  onOpenChange(false);
                  onConvert(quotation);
                }}
              >
                <FileCheck className="h-3.5 w-3.5" /> Convert to Invoice
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (comp) {
                  downloadQuotationPDF(quotation, comp as any, cust as any);
                }
              }}
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
