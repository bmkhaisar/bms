import type { CompanySettings, Invoice, Quotation, Purchase, Receipt, Customer, Supplier } from "@/lib/db";
import { formatDate, formatMoney, numberToWordsIndian } from "@/lib/format";
import { SignatoryBlock } from "@/components/app/SignatoryBlock";
import { formatCompanyAddress } from "@/lib/companyAddress";

export type DocumentKind = "invoice" | "quotation" | "purchase" | "receipt";

interface Props {
  company: CompanySettings;
  kind: DocumentKind;
  doc: Invoice | Quotation | Purchase | Receipt;
  party?: Customer | Supplier;
}

export function DocumentPrint({ company, kind, doc, party }: Props) {
  const title = kind === "invoice" ? "TAX INVOICE" : kind === "quotation" ? "QUOTATION" : kind === "purchase" ? "PURCHASE BILL" : "RECEIPT";
  const isReceipt = kind === "receipt";
  const isInv = kind === "invoice";
  const anyDoc = doc as Invoice; // for shared field access with fallback
  const items = "items" in doc ? doc.items : [];
  const grandTotal = (doc as Invoice).grandTotal ?? (doc as Receipt).amount;
  const compAddr = formatCompanyAddress(company);

  return (
    <div id="print-doc" className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black print:p-0">
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div className="flex items-start gap-3">
          {company.logo && <img src={company.logo} alt="Logo" className="h-16 w-16 object-contain" />}
          <div>
            <div className="text-xl font-bold">{compAddr.companyName}</div>
            {compAddr.addressLines.map((line, i) => (
              <div key={i} className="text-[11px] text-gray-700">{line}</div>
            ))}
            {compAddr.cityStatePincode && <div className="text-[11px] text-gray-700">{compAddr.cityStatePincode}</div>}
            {compAddr.contactLine && <div className="text-[11px] text-gray-600">{compAddr.contactLine}</div>}
            {compAddr.gstin && <div className="text-[11px] font-semibold text-gray-900">GSTIN: {compAddr.gstin}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block border border-black px-3 py-1 text-sm font-bold tracking-wider">{title}</div>
          <div className="mt-2 text-[11px]">
            {kind === "purchase" ? (
              <>
                <div><b>BMS Purchase No:</b> <span className="font-mono">{(doc as Purchase).number}</span></div>
                {(doc as Purchase).supplierInvoiceNumber && (
                  <div><b>Supplier Invoice No:</b> <span className="font-mono font-bold">{(doc as Purchase).supplierInvoiceNumber}</span></div>
                )}
                {(doc as Purchase).supplierInvoiceDate && (
                  <div><b>Supplier Inv Date:</b> {formatDate((doc as Purchase).supplierInvoiceDate!)}</div>
                )}
                <div><b>Purchase Date:</b> {formatDate((doc as Purchase).date)}</div>
              </>
            ) : (
              <>
                <div><b>No.</b> <span className="font-mono">{(doc as Invoice).number}</span></div>
                <div><b>Date:</b> {formatDate((doc as Invoice).date)}</div>
                {isInv && (doc as Invoice).dueDate && <div><b>Due:</b> {formatDate((doc as Invoice).dueDate)}</div>}
              </>
            )}
          </div>
        </div>
      </header>

      {party && (
        <section className="mt-3 grid grid-cols-2 gap-4 border-b pb-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{kind === "purchase" ? "Supplier" : "Bill To"}</div>
            <div className="font-semibold">{party.name}</div>
            {(party as Customer).company && <div>{(party as Customer).company}</div>}
            {party.address && <div className="whitespace-pre-line">{party.address}</div>}
            {party.mobile && <div>Mob: {party.mobile}</div>}
            {party.gstin && <div>GSTIN: <span className="font-mono">{party.gstin}</span></div>}
          </div>
          {(kind === "invoice" || kind === "quotation") && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Ship To (Consignee)</div>
              {(doc as any).shipToPartySnapshot?.name ? (
                <div className="font-semibold">{(doc as any).shipToPartySnapshot.name}</div>
              ) : null}
              {(() => {
                const shipAddr = (doc as any).shippingAddressSnapshot?.address || (doc as any).shippingAddress || (doc as any).shipToPartySnapshot?.address;
                const city = (doc as any).shippingAddressSnapshot?.city || (doc as any).shipToPartySnapshot?.city;
                const state = (doc as any).shippingAddressSnapshot?.state || (doc as any).shipToPartySnapshot?.state;
                const pincode = (doc as any).shippingAddressSnapshot?.pincode || (doc as any).shipToPartySnapshot?.pincode;
                const phone = (doc as any).shippingAddressSnapshot?.phone || (doc as any).shipToPartySnapshot?.phone;
                const gstin = (doc as any).shipToPartySnapshot?.gstin;
                
                if (!shipAddr && !city && !state && !phone && !gstin) {
                  return <div className="italic text-gray-500">Same as Billing Address</div>;
                }
                return (
                  <div className="space-y-0.5">
                    {shipAddr && <div className="whitespace-pre-line">{shipAddr}</div>}
                    {(city || state || pincode) && (
                      <div>{[city, state, pincode].filter(Boolean).join(", ")}</div>
                    )}
                    {phone && <div>Mob: {phone}</div>}
                    {gstin && <div>GSTIN: <span className="font-mono">{gstin}</span></div>}
                  </div>
                );
              })()}
            </div>
          )}
        </section>
      )}

      {isReceipt ? (
        <section className="mt-4">
          <div className="rounded border p-4">
            <div className="text-[11px] text-gray-500">Received with thanks</div>
            <div className="mt-1 text-lg font-bold">{formatMoney((doc as Receipt).amount, company.currencySymbol)}</div>
            <div className="mt-1 italic">{numberToWordsIndian((doc as Receipt).amount)}</div>
            <div className="mt-2 text-[11px]">Mode: <b>{(doc as Receipt).mode.toUpperCase()}</b>{(doc as Receipt).reference ? ` · Ref: ${(doc as Receipt).reference}` : ""}</div>
            {(doc as Receipt).notes && <div className="mt-1 text-[11px]">Notes: {(doc as Receipt).notes}</div>}
          </div>
        </section>
      ) : (
        <>
          <table className="mt-3 w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-1 text-left">#</th>
                <th className="border border-black px-1 py-1 text-left">Item</th>
                <th className="border border-black px-1 py-1">HSN</th>
                <th className="border border-black px-1 py-1 text-right">Qty</th>
                <th className="border border-black px-1 py-1 text-right">Rate</th>
                <th className="border border-black px-1 py-1 text-right">Disc%</th>
                <th className="border border-black px-1 py-1 text-right">Taxable</th>
                <th className="border border-black px-1 py-1 text-right">GST%</th>
                <th className="border border-black px-1 py-1 text-right">GST</th>
                <th className="border border-black px-1 py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="border border-black px-1 py-1">{i + 1}</td>
                  <td className="border border-black px-1 py-1">{it.name}</td>
                  <td className="border border-black px-1 py-1 text-center font-mono">{it.hsn}</td>
                  <td className="border border-black px-1 py-1 text-right">{it.quantity} {it.unit}</td>
                  <td className="border border-black px-1 py-1 text-right font-mono">{formatMoney(it.rate, "")}</td>
                  <td className="border border-black px-1 py-1 text-right">{it.discountPct}%</td>
                  <td className="border border-black px-1 py-1 text-right font-mono">{formatMoney(it.taxable, "")}</td>
                  <td className="border border-black px-1 py-1 text-right">{it.gstRate}%</td>
                  <td className="border border-black px-1 py-1 text-right font-mono">{formatMoney(it.gstAmount, "")}</td>
                  <td className="border border-black px-1 py-1 text-right font-mono">{formatMoney(it.total, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className="mt-3 grid grid-cols-2 gap-4">
            <div className="text-[11px]">
              <div className="font-semibold">Amount in words</div>
              <div className="italic">{numberToWordsIndian(grandTotal)}</div>
            </div>
            <div>
              <table className="w-full text-[11px]">
                <tbody>
                  <TotalRow label="Subtotal" v={formatMoney(anyDoc.subtotal, company.currencySymbol)} />
                  <TotalRow label="Discount" v={"- " + formatMoney(anyDoc.discountTotal, company.currencySymbol)} />
                  {isInv && (doc as Invoice).isIgst ? (
                    <TotalRow label={`IGST`} v={formatMoney((doc as Invoice).igstTotal, company.currencySymbol)} />
                  ) : isInv ? (
                    <>
                      <TotalRow label="CGST" v={formatMoney((doc as Invoice).cgstTotal, company.currencySymbol)} />
                      <TotalRow label="SGST" v={formatMoney((doc as Invoice).sgstTotal, company.currencySymbol)} />
                    </>
                  ) : (
                    <TotalRow label="GST" v={formatMoney(anyDoc.gstTotal, company.currencySymbol)} />
                  )}
                  <TotalRow label="Round Off" v={formatMoney(anyDoc.roundOff, company.currencySymbol)} />
                  <tr><td className="pt-1 font-bold">Grand Total</td><td className="pt-1 text-right font-mono font-bold">{formatMoney(grandTotal, company.currencySymbol)}</td></tr>
                  {isInv && (
                    <>
                      <TotalRow label="Paid" v={formatMoney((doc as Invoice).amountPaid, company.currencySymbol)} />
                      <TotalRow label="Balance" v={formatMoney((doc as Invoice).balance, company.currencySymbol)} />
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Document Section Order: Terms & Conditions -> Bank Settlement -> Signatory */}
      <footer className="mt-6 space-y-3 border-t pt-3 text-[10px]">
        {/* 1. Terms & Conditions */}
        {((doc as any).terms || company.terms || (company as any).invoiceTermsMarkdown) && (
          <div className="rounded border border-gray-200 p-2 bg-gray-50/50">
            <div className="font-semibold text-gray-900 mb-1">Terms & Conditions</div>
            <div className="text-gray-700 whitespace-pre-line text-[11px]">
              {(doc as any).terms || (company as any).invoiceTermsMarkdown || company.terms}
            </div>
          </div>
        )}

        {/* 2. Bank Settlement Details */}
        {(company.bankName || (doc as any).bankSnapshot || (doc as any).bankDetailsSnapshot) && (
          <div className="rounded border border-gray-200 p-2">
            <div className="font-semibold text-gray-900 mb-1">Payment / Bank Settlement Details</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-700">
              <div>
                <span className="text-gray-500">Account Holder:</span>{" "}
                <span className="font-medium">
                  {(doc as any).bankDetailsSnapshot?.accountHolderName || (doc as any).bankSnapshot?.accountHolderName || (doc as any).bankDetailsSnapshot?.accountName || (doc as any).bankSnapshot?.accountName || (company as any).accountHolderName || company.bankAccountHolderName || compAddr.companyName}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Bank Name:</span>{" "}
                <span className="font-medium">
                  {(doc as any).bankDetailsSnapshot?.bankName || (doc as any).bankSnapshot?.bankName || company.bankName}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Account Number:</span>{" "}
                <span className="font-mono font-medium">
                  {(doc as any).bankDetailsSnapshot?.accountNo || (doc as any).bankSnapshot?.accountNo || company.bankAccount}
                </span>
              </div>
              <div>
                <span className="text-gray-500">IFSC Code:</span>{" "}
                <span className="font-mono font-medium">
                  {(doc as any).bankDetailsSnapshot?.ifscCode || (doc as any).bankSnapshot?.ifscCode || company.bankIfsc}
                </span>
              </div>
              {company.upiId && (
                <div>
                  <span className="text-gray-500">UPI ID:</span>{" "}
                  <span className="font-mono font-medium">{company.upiId}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 items-end pt-1">
          <div>
            {company.declaration && (<div><span className="font-semibold">Declaration: </span>{company.declaration}</div>)}
          </div>
          <div className="flex justify-end">
            <SignatoryBlock
              company={company as any}
              signatoryOverride={(doc as any).signatoryOverride}
              signatorySnapshot={(doc as any).signatorySnapshot}
              documentDate={(doc as any).date}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}

function TotalRow({ label, v }: { label: string; v: string }) {
  return <tr><td className="text-gray-600">{label}</td><td className="text-right font-mono">{v}</td></tr>;
}
