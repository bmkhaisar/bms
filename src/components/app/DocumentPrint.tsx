import type { CompanySettings, Invoice, Quotation, Purchase, Receipt, Customer, Supplier } from "@/lib/db";
import { formatDate, formatMoney, numberToWordsIndian } from "@/lib/format";
import { SignatoryBlock } from "@/components/app/SignatoryBlock";

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

  return (
    <div id="print-doc" className="mx-auto max-w-[210mm] bg-white p-6 text-[12px] text-black print:p-0">
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div className="flex items-start gap-3">
          {company.logo && <img src={company.logo} alt="Logo" className="h-16 w-16 object-contain" />}
          <div>
            <div className="text-xl font-bold">{company.name}</div>
            {company.address && <div className="whitespace-pre-line text-[11px]">{company.address}</div>}
            {company.mobile && <div className="text-[11px]">Mob: {company.mobile}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block border border-black px-3 py-1 text-sm font-bold tracking-wider">{title}</div>
          <div className="mt-2 text-[11px]">
            <div><b>No.</b> <span className="font-mono">{(doc as Invoice).number}</span></div>
            <div><b>Date:</b> {formatDate((doc as Invoice).date)}</div>
            {isInv && (doc as Invoice).dueDate && <div><b>Due:</b> {formatDate((doc as Invoice).dueDate)}</div>}
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
          {isInv && (doc as Invoice).shippingAddress && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Ship To</div>
              <div className="whitespace-pre-line">{(doc as Invoice).shippingAddress}</div>
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
              {company.bankName && (
                <div className="mt-3 rounded border p-2">
                  <div className="font-semibold">Bank Details</div>
                  <div>Bank: {company.bankName}</div>
                  <div>A/C: <span className="font-mono">{company.bankAccount}</span></div>
                  <div>IFSC: <span className="font-mono">{company.bankIfsc}</span> {company.bankBranch && `· ${company.bankBranch}`}</div>
                  {company.upiId && <div>UPI: <span className="font-mono">{company.upiId}</span></div>}
                </div>
              )}
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

      <footer className="mt-6 grid grid-cols-2 gap-4 border-t pt-3 text-[10px]">
        <div>
          {company.terms && (<><div className="font-semibold">Terms & Conditions</div><div className="whitespace-pre-line">{company.terms}</div></>)}
          {company.declaration && (<div className="mt-2"><span className="font-semibold">Declaration: </span>{company.declaration}</div>)}
        </div>
        <div className="flex justify-end">
          <SignatoryBlock
            company={company as any}
            signatoryOverride={(doc as any).signatoryOverride}
            signatorySnapshot={(doc as any).signatorySnapshot}
            documentDate={(doc as any).date}
          />
        </div>
      </footer>
    </div>
  );
}

function TotalRow({ label, v }: { label: string; v: string }) {
  return <tr><td className="text-gray-600">{label}</td><td className="text-right font-mono">{v}</td></tr>;
}
