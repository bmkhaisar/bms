export type ShareDocumentKind = "quotation" | "invoice" | "receipt";

export interface SharePartyInfo {
  partyId: string;
  partyCode?: string;
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  country?: string;
}

export interface ShareCompanyInfo {
  id?: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  logo?: string;
  defaultShareCcEmail?: string;
}

export interface ShareDocumentData {
  kind: ShareDocumentKind;
  documentId: string;
  documentNumber: string;
  date: number;
  dueDate?: number;
  totalAmount: number;
  amountReceived?: number;
  balanceOutstanding?: number;
  currencySymbol?: string;
  company: ShareCompanyInfo;
  party: SharePartyInfo;
  receiptDetails?: {
    receiptVoucherNumber: string;
    allocationType?: string; // AGAINST_REF | ADVANCE | ON_ACCOUNT
    invoiceNumber?: string;
    invoiceDate?: number;
    amountAllocated?: number;
    customerCreditCreated?: number;
  };
  generatePdfBlob: () => Promise<Blob>;
}

export interface ShareSessionState {
  useAlternateEmail: boolean;
  alternateEmail: string;
  useAlternatePhone: boolean;
  alternatePhone: string;
  pdfDownloaded: boolean;
  isGeneratingPdf: boolean;
}

export interface PaymentDueInsight {
  invoiceTotal: number;
  totalReceived: number;
  balance: number;
  latestReceiptNumber?: string;
  latestReceiptDate?: number;
  dueDate: number;
  creditDays: number;
  isPaid: boolean;
  isOverdue: boolean;
  daysRemaining: number;
  daysOverdue: number;
  paidOnDate?: number;
  statusVariant: "paid" | "neutral" | "due_soon" | "overdue";
}
