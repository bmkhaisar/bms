import { formatDate } from "../../../lib/format.ts";
import type { ShareDocumentData } from "./bmsShareTypes";

/**
 * Strips formatting symbols and formats phone number for WhatsApp wa.me link.
 * Uses canonical Party country and avoids blind prepending of +91.
 */
export function normalizeWhatsAppPhone(rawPhone?: string, country?: string): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.replace(/[^\d+]/g, "");

  // If already in international format starting with +
  if (cleaned.startsWith("+")) {
    return cleaned.slice(1);
  }

  // If starts with 00 (international prefix notation)
  if (cleaned.startsWith("00")) {
    return cleaned.slice(2);
  }

  const digitsOnly = cleaned;
  const isIndia =
    !country ||
    country.toLowerCase() === "india" ||
    country.toLowerCase() === "in" ||
    country.toLowerCase() === "ind";

  // Standard 10-digit Indian local mobile
  if (isIndia && /^\d{10}$/.test(digitsOnly)) {
    return `91${digitsOnly}`;
  }

  // 11-digit starting with 0 in India (STD trunk prefix)
  if (isIndia && /^0\d{10}$/.test(digitsOnly)) {
    return `91${digitsOnly.slice(1)}`;
  }

  // If already starts with 91 followed by 10 digits
  if (isIndia && /^91\d{10}$/.test(digitsOnly)) {
    return digitsOnly;
  }

  // For non-Indian or ambiguous destinations, retain raw digits as entered
  return digitsOnly;
}

/**
 * Checks if a phone number might need user confirmation before opening WhatsApp
 * (e.g. 10 digits without an explicit country code when country is non-Indian or unspecified).
 */
export function isPhoneAmbiguous(rawPhone?: string, country?: string): boolean {
  if (!rawPhone) return false;
  const digitsOnly = rawPhone.replace(/[^\d]/g, "");
  const isIndia =
    !country ||
    country.toLowerCase() === "india" ||
    country.toLowerCase() === "in";

  if (!isIndia && digitsOnly.length < 11) {
    return true;
  }
  return false;
}

/**
 * Format currency amount with Rs. or symbol, avoiding floating point drift.
 */
function formatShareAmount(amount?: number, symbol = "₹"): string {
  if (amount === undefined || amount === null || isNaN(amount)) return `${symbol}0.00`;
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds email subject according to PRD § 7.
 */
export function generateEmailSubject(doc: ShareDocumentData): string {
  const compName = doc.company.legalName || doc.company.name || "Business Entity";
  switch (doc.kind) {
    case "quotation":
      return `Quotation ${doc.documentNumber} — ${compName}`;
    case "invoice":
      return `Invoice ${doc.documentNumber} — ${compName}`;
    case "receipt":
      return `Receipt ${doc.documentNumber} — ${compName}`;
  }
}

/**
 * Builds reminder email subject according to PRD § 25.
 */
export function generateReminderEmailSubject(doc: ShareDocumentData): string {
  return `Payment Reminder — ${doc.documentNumber}`;
}

/**
 * Builds email body according to PRD §§ 8, 9, 10, 11 and Correction 6.
 * Strictly avoids claiming that PDF is attached, as mailto/web compose cannot verify attachments.
 */
export function generateEmailBody(doc: ShareDocumentData): string {
  const customerName = doc.party.name || "Customer";
  const compName = doc.company.legalName || doc.company.name || "Business Entity";
  const formattedDate = formatDate(doc.date);
  const formattedAmount = formatShareAmount(doc.totalAmount, doc.currencySymbol || "₹");

  const footer = `Regards,\n${compName}\n\nThis message was prepared using BMS NEXT.`;

  if (doc.kind === "quotation") {
    return [
      `Hello ${customerName},`,
      ``,
      `Please find Quotation ${doc.documentNumber} from ${compName} for your review.`,
      ``,
      `Quotation Date: ${formattedDate}`,
      `Quotation Amount: ${formattedAmount}`,
      ``,
      `Please review Quotation ${doc.documentNumber} and contact us if you require any clarification.`,
      ``,
      footer,
    ].join("\n");
  }

  if (doc.kind === "invoice") {
    const hasPartial =
      doc.amountReceived !== undefined &&
      doc.amountReceived > 0 &&
      doc.balanceOutstanding !== undefined;

    const lines = [
      `Hello ${customerName},`,
      ``,
      `Please find Invoice ${doc.documentNumber} from ${compName} for your reference.`,
      ``,
      `Invoice Date: ${formattedDate}`,
      `Invoice Amount: ${formattedAmount}`,
    ];

    if (hasPartial) {
      lines.push(`Amount Received: ${formatShareAmount(doc.amountReceived, doc.currencySymbol || "₹")}`);
      lines.push(`Balance Outstanding: ${formatShareAmount(doc.balanceOutstanding, doc.currencySymbol || "₹")}`);
    }

    lines.push(``);
    lines.push(footer);

    return lines.join("\n");
  }

  // Receipt Voucher
  if (doc.kind === "receipt") {
    const isAgainstInvoice = Boolean(
      doc.receiptDetails?.invoiceNumber || (doc.receiptDetails?.allocationType && doc.receiptDetails.allocationType !== "ADVANCE" && doc.receiptDetails.allocationType !== "ON_ACCOUNT")
    );
    const invoiceNum = doc.receiptDetails?.invoiceNumber;
    const receivedAmount = doc.receiptDetails?.amountAllocated ?? doc.totalAmount;
    const formattedReceived = formatShareAmount(receivedAmount, doc.currencySymbol || "₹");

    if (isAgainstInvoice && invoiceNum) {
      return [
        `Hello ${customerName},`,
        ``,
        `We acknowledge receipt of ${formattedReceived} against Invoice ${invoiceNum}.`,
        ``,
        `Receipt Number: ${doc.documentNumber}`,
        `Receipt Date: ${formattedDate}`,
        `Amount Received: ${formattedReceived}`,
        ``,
        `Please retain this acknowledgement for your records.`,
        ``,
        footer,
      ].join("\n");
    }

    const allocationLabel =
      doc.receiptDetails?.allocationType === "ADVANCE"
        ? "customer advance payment"
        : "on account payment";

    return [
      `Hello ${customerName},`,
      ``,
      `We acknowledge receipt of ${formattedReceived} as ${allocationLabel}.`,
      ``,
      `Receipt Number: ${doc.documentNumber}`,
      `Receipt Date: ${formattedDate}`,
      `Amount Received: ${formattedReceived}`,
      ``,
      `Please retain this acknowledgement for your records.`,
      ``,
      footer,
    ].join("\n");
  }

  return "";
}

/**
 * Builds payment reminder email body according to PRD § 25.
 * Strictly avoids internal overdue or remaining days wording.
 */
export function generateReminderEmailBody(doc: ShareDocumentData): string {
  const customerName = doc.party.name || "Customer";
  const compName = doc.company.legalName || doc.company.name || "Business Entity";
  const symbol = doc.currencySymbol || "₹";

  const totalStr = formatShareAmount(doc.totalAmount, symbol);
  const receivedStr = formatShareAmount(doc.amountReceived ?? 0, symbol);
  const balanceStr = formatShareAmount(doc.balanceOutstanding ?? doc.totalAmount, symbol);

  return [
    `Hello ${customerName},`,
    ``,
    `This is a friendly reminder regarding the outstanding balance for Invoice ${doc.documentNumber} from ${compName}.`,
    ``,
    `Invoice Amount: ${totalStr}`,
    `Amount Received: ${receivedStr}`,
    `Balance Outstanding: ${balanceStr}`,
    ``,
    `Please disregard this message if payment has already been completed.`,
    ``,
    `Regards,`,
    `${compName}`,
    ``,
    `This message was prepared using BMS NEXT.`,
  ].join("\n");
}

/**
 * Builds WhatsApp message according to PRD §§ 18, 19, 20.
 */
export function generateWhatsAppMessage(doc: ShareDocumentData): string {
  const customerName = doc.party.name || "Customer";
  const compName = doc.company.legalName || doc.company.name || "Business Entity";
  const formattedAmount = formatShareAmount(doc.totalAmount, doc.currencySymbol || "₹");

  if (doc.kind === "quotation") {
    return [
      `Hello ${customerName},`,
      ``,
      `Please find Quotation ${doc.documentNumber} from ${compName} for your review.`,
      ``,
      `Quotation Amount: ${formattedAmount}`,
      ``,
      `Thank you.`,
    ].join("\n");
  }

  if (doc.kind === "invoice") {
    const hasPartial =
      doc.amountReceived !== undefined &&
      doc.amountReceived > 0 &&
      doc.balanceOutstanding !== undefined;

    const lines = [
      `Hello ${customerName},`,
      ``,
      `Please find Invoice ${doc.documentNumber} from ${compName}.`,
      ``,
      `Invoice Amount: ${formattedAmount}`,
    ];

    if (hasPartial) {
      lines.push(`Amount Received: ${formatShareAmount(doc.amountReceived, doc.currencySymbol || "₹")}`);
      lines.push(`Balance Outstanding: ${formatShareAmount(doc.balanceOutstanding, doc.currencySymbol || "₹")}`);
    }

    lines.push(``);
    lines.push(`Thank you.`);

    return lines.join("\n");
  }

  if (doc.kind === "receipt") {
    const isAgainstInvoice = Boolean(
      doc.receiptDetails?.invoiceNumber || (doc.receiptDetails?.allocationType && doc.receiptDetails.allocationType !== "ADVANCE" && doc.receiptDetails.allocationType !== "ON_ACCOUNT")
    );
    const invoiceNum = doc.receiptDetails?.invoiceNumber;
    const receivedAmount = doc.receiptDetails?.amountAllocated ?? doc.totalAmount;
    const formattedReceived = formatShareAmount(receivedAmount, doc.currencySymbol || "₹");

    if (isAgainstInvoice && invoiceNum) {
      return [
        `Hello ${customerName},`,
        ``,
        `We acknowledge receipt of ${formattedReceived} against Invoice ${invoiceNum}.`,
        ``,
        `Receipt: ${doc.documentNumber}`,
        ``,
        `Thank you,`,
        `${compName}`,
      ].join("\n");
    }

    return [
      `Hello ${customerName},`,
      ``,
      `We acknowledge receipt of ${formattedReceived} as advance payment.`,
      ``,
      `Receipt: ${doc.documentNumber}`,
      ``,
      `Thank you,`,
      `${compName}`,
    ].join("\n");
  }

  return "";
}

/**
 * Builds payment reminder WhatsApp message according to PRD § 26.
 * Strictly avoids internal overdue or remaining days wording.
 */
export function generateReminderWhatsAppMessage(doc: ShareDocumentData): string {
  const customerName = doc.party.name || "Customer";
  const compName = doc.company.legalName || doc.company.name || "Business Entity";
  const symbol = doc.currencySymbol || "₹";
  const balanceStr = formatShareAmount(doc.balanceOutstanding ?? doc.totalAmount, symbol);

  return [
    `Hello ${customerName},`,
    ``,
    `This is a friendly payment reminder regarding Invoice ${doc.documentNumber} from ${compName}.`,
    ``,
    `Balance Outstanding: ${balanceStr}`,
    ``,
    `Please disregard this message if payment has already been completed.`,
    ``,
    `Thank you.`,
  ].join("\n");
}

/**
 * Builds Gmail compose URL.
 */
export function buildGmailComposeUrl(params: {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}): string {
  const query = new URLSearchParams();
  query.set("view", "cm");
  query.set("fs", "1");
  query.set("to", params.to);
  if (params.cc?.trim()) {
    query.set("cc", params.cc.trim());
  }
  query.set("su", params.subject);
  query.set("body", params.body);

  return `https://mail.google.com/mail/?${query.toString()}`;
}

/**
 * Builds standard mailto URL for default system email clients.
 */
export function buildMailtoUrl(params: {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}): string {
  const query = new URLSearchParams();
  if (params.cc?.trim()) {
    query.set("cc", params.cc.trim());
  }
  query.set("subject", params.subject);
  query.set("body", params.body);

  return `mailto:${encodeURIComponent(params.to)}?${query.toString()}`;
}

/**
 * Builds WhatsApp Click-to-Chat / wa.me URL.
 */
export function buildWhatsAppUrl(params: {
  phone: string;
  country?: string;
  message: string;
}): string {
  const normalized = normalizeWhatsAppPhone(params.phone, params.country);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(params.message)}`;
}
