/**
 * Firebase Realtime Database implementation of ISalesReturnRepository (PRD §§ 20-28, 41, 42)
 * 
 * Enforces:
 * 1. Original posted invoice remains strictly immutable.
 * 2. Return quantities cannot exceed sold quantities (including cumulative partial returns).
 * 3. Double-entry balanced accounting voucher (Dr: Sales Return, Dr: Output GST, Cr: Customer/AR).
 * 4. Automatic customer credit generation if invoice was paid, or AR reduction if unpaid.
 * 5. Branch-aware authoritative inventory movements for restocked items.
 * 6. Statutory GST preservation using frozen original invoice line snapshots.
 * 7. Branch authorization check (caller must have SALES_RETURN_CREATE / SALES_RETURN_POST).
 */

import { getFirebaseAdmin } from "../firebaseAdmin";
import { executePostVoucher } from "../accounting/postingEngine";
import { executeReverseVoucher } from "../accounting/reversalEngine";
import { allocateLegalDocumentNumber } from "../accounting/numberingEngine";
import type {
  ISalesReturnRepository,
  PostSalesReturnInput,
  SalesReturnResult,
  ReverseSalesReturnInput,
  ReverseSalesReturnResult,
} from "./types";
import type { SalesReturn, CreditNote, SalesReturnItem, Invoice, LineItem } from "@/lib/db";
import { hasBranchPermission } from "@/modules/auth/permissions";
import { assertNoUndefinedValues } from "../firebasePayloadInvariant";

export class FirebaseSalesReturnRepository implements ISalesReturnRepository {
  async postSalesReturn(input: PostSalesReturnInput): Promise<SalesReturnResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const db = adminApp.database();
    const { companyId, branchId, callerUid, originalInvoiceId, returnType, items, notes } = input;

    // 1. Authorize user membership & branch permission
    const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!memSnap.exists()) {
      return { success: false, error: "Caller is not a member of this organization", code: "FORBIDDEN" };
    }

    const membership = memSnap.val();
    if (membership.status !== "active") {
      return { success: false, error: "Membership is not active", code: "FORBIDDEN" };
    }

    const canCreateReturn = hasBranchPermission(membership, branchId, "SALES_RETURN_CREATE");
    const canPostReturn = hasBranchPermission(membership, branchId, "SALES_RETURN_POST");

    if (!canCreateReturn || !canPostReturn) {
      return {
        success: false,
        error: "Forbidden: You do not have permission to create and post sales returns for this branch.",
        code: "FORBIDDEN",
      };
    }

    // 2. Fetch original invoice & verify it exists and is posted
    const invSnap = await db.ref(`companyData/${companyId}/invoices/${originalInvoiceId}`).once("value");
    if (!invSnap.exists()) {
      return { success: false, error: "Original invoice not found", code: "NOT_FOUND" };
    }

    const invoice: Invoice = invSnap.val();
    if (invoice.status === "draft" || invoice.postingStatus === "draft") {
      return {
        success: false,
        error: "Cannot create sales return against a draft invoice. Only posted invoices accept returns.",
        code: "INVALID_STATE",
      };
    }

    if (invoice.status === "cancelled" || invoice.status === "voided" || invoice.postingStatus === "reversed") {
      return {
        success: false,
        error: "Cannot create sales return against a cancelled or voided invoice.",
        code: "INVALID_STATE",
      };
    }

    // 3. Check cumulative returns on this invoice (Hardening Item 20)
    const previouslyReturnedQtyByItem: Record<string, number> = {};
    const trackerSnap = await db.ref(`companyData/${companyId}/invoices/${originalInvoiceId}/returnedQuantities`).once("value");
    if (trackerSnap.exists()) {
      const trackerMap = trackerSnap.val() || {};
      for (const [k, v] of Object.entries(trackerMap)) {
        previouslyReturnedQtyByItem[k] = Number(v) || 0;
      }
    } else {
      const priorReturns = await this.getReturnsForInvoice(companyId, originalInvoiceId);
      for (const ret of priorReturns) {
        if (ret.status === "cancelled" || ret.status === "reversed" || ret.postingStatus === "reversed") continue;
        for (const it of ret.items || []) {
          previouslyReturnedQtyByItem[it.invoiceItemId] =
            (previouslyReturnedQtyByItem[it.invoiceItemId] || 0) + (it.returnQuantity || 0);
        }
      }
    }

    // 4. Validate return quantities and build return line items
    const originalItemsMap = new Map<string, LineItem>();
    (invoice.items || []).forEach((it, idx) => {
      const itemId = it.id || (it as any).productId || `item_${idx}`;
      originalItemsMap.set(itemId, it);
    });

    if (!items || items.length === 0) {
      return { success: false, error: "At least one item must be returned", code: "INVALID_INPUT" };
    }

    let returnTaxablePaise = 0;
    let returnCgstPaise = 0;
    let returnSgstPaise = 0;
    let returnIgstPaise = 0;
    let returnSubtotalPaise = 0;
    let returnDiscountPaise = 0;

    const returnLineItems: SalesReturnItem[] = [];

    for (const reqItem of items) {
      const orig = originalItemsMap.get(reqItem.invoiceItemId);
      if (!orig) {
        return {
          success: false,
          error: `Item '${reqItem.invoiceItemId}' does not exist on the original invoice`,
          code: "INVALID_INPUT",
        };
      }

      const prevReturned = previouslyReturnedQtyByItem[reqItem.invoiceItemId] || 0;
      const remainingReturnable = Math.max(0, orig.quantity - prevReturned);

      if (reqItem.returnQuantity <= 0) {
        return {
          success: false,
          error: `Return quantity for item '${orig.name}' must be greater than zero`,
          code: "INVALID_INPUT",
        };
      }

      if (reqItem.returnQuantity > remainingReturnable) {
        return {
          success: false,
          error: `Return quantity (${reqItem.returnQuantity}) exceeds remaining returnable quantity (${remainingReturnable}) for item '${orig.name}'`,
          code: "QTY_EXCEEDED",
        };
      }

      // Preserve exact rate, discount, and tax treatment from frozen line snapshots
      const rate = orig.rate;
      const ratePaise = orig.ratePaise !== undefined ? orig.ratePaise : Math.round(rate * 100);
      const discountPct = orig.discountPct || 0;
      const gstRate = orig.gstRate || 0;
      const isInterState = Boolean((orig as any).isInterState || (invoice as any).isIgst);

      const itemGrossPaise = Math.round(reqItem.returnQuantity * rate * 100);
      const itemDiscountPaise = Math.round(itemGrossPaise * (discountPct / 100));
      const itemTaxablePaise = itemGrossPaise - itemDiscountPaise;

      let itemCgstPaise = 0;
      let itemSgstPaise = 0;
      let itemIgstPaise = 0;

      if (isInterState) {
        itemIgstPaise = Math.round(itemTaxablePaise * (gstRate / 100));
      } else {
        itemCgstPaise = Math.round(itemTaxablePaise * (gstRate / 200));
        itemSgstPaise = Math.round(itemTaxablePaise * (gstRate / 200));
      }

      const itemTotalPaise = itemTaxablePaise + itemCgstPaise + itemSgstPaise + itemIgstPaise;

      returnSubtotalPaise += itemGrossPaise;
      returnDiscountPaise += itemDiscountPaise;
      returnTaxablePaise += itemTaxablePaise;
      returnCgstPaise += itemCgstPaise;
      returnSgstPaise += itemSgstPaise;
      returnIgstPaise += itemIgstPaise;

      returnLineItems.push({
        id: `sri_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        invoiceItemId: reqItem.invoiceItemId,
        productId: orig.productId || "",
        productName: orig.name || "Item",
        sku: orig.sku || "",
        hsn: orig.hsn || "",
        uomId: orig.uomId,
        uomLabel: orig.uomLabel || orig.unit || "NOS",
        invoicedQuantity: orig.quantity,
        previouslyReturnedQuantity: prevReturned,
        returnQuantity: reqItem.returnQuantity,
        rate,
        ratePaise,
        discountPct,
        gstRate,
        isInterState,
        taxableAmount: itemTaxablePaise / 100,
        taxablePaise: itemTaxablePaise,
        cgstAmount: itemCgstPaise / 100,
        cgstPaise: itemCgstPaise,
        sgstAmount: itemSgstPaise / 100,
        sgstPaise: itemSgstPaise,
        igstAmount: itemIgstPaise / 100,
        igstPaise: itemIgstPaise,
        totalAmount: itemTotalPaise / 100,
        totalPaise: itemTotalPaise,
        reason: reqItem.reason,
        reasonNotes: reqItem.reasonNotes,
        restockAction: reqItem.restockAction,
      });
    }

    const returnTaxPaise = returnCgstPaise + returnSgstPaise + returnIgstPaise;
    const returnGrandTotalPaise = returnTaxablePaise + returnTaxPaise;

    const returnSubtotal = returnSubtotalPaise / 100;
    const returnDiscount = returnDiscountPaise / 100;
    const returnTaxable = returnTaxablePaise / 100;
    const returnCgst = returnCgstPaise / 100;
    const returnSgst = returnSgstPaise / 100;
    const returnIgst = returnIgstPaise / 100;
    const returnTaxTotal = returnTaxPaise / 100;
    const returnGrandTotal = returnGrandTotalPaise / 100;

    const now = Date.now();
    const returnDate = input.date || now;

    // 5. Scoped Atomic Document Numbers for Credit Note and Sales Return (Hardening Task 6)
    const branchSnap = await db.ref(`companyData/${companyId}/branches/${branchId}`).once("value");
    const branchData = branchSnap.exists() ? branchSnap.val() : null;

    const d = new Date(returnDate);
    const yyyy = d.getFullYear();
    const fyString = `${yyyy}-${String(yyyy + 1).slice(-2)}`;
    const financialYearId = invoice.financialYearId || `fy_${yyyy}`;

    const [cnRes, srRes] = await Promise.all([
      allocateLegalDocumentNumber(db, {
        companyId,
        financialYearId,
        docType: "credit_note",
        branchId,
        branchCode: branchData?.code,
        gstin: branchData?.gstin,
        fyName: fyString,
        customPrefix: branchData?.creditNotePrefix || "CN",
      }),
      allocateLegalDocumentNumber(db, {
        companyId,
        financialYearId,
        docType: "sales_return",
        branchId,
        branchCode: branchData?.code,
        gstin: branchData?.gstin,
        fyName: fyString,
        customPrefix: branchData?.salesReturnPrefix || "SR",
      }),
    ]);

    const creditNoteNumber = cnRes.documentNumber;
    const salesReturnNumber = srRes.documentNumber;

    const salesReturnId = `sr_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const creditNoteId = `cn_${now}_${Math.random().toString(36).substring(2, 7)}`;

    // 6. Double-Entry Accounting
    // Debit: Sales Return / Revenue Reversal Dr (returnTaxablePaise)
    // Debit: Output GST Reversal / Adjustment Dr (returnTaxPaise)
    // Credit: Customer / Accounts Receivable Cr (returnGrandTotalPaise)
    const salesReturnLedgerId = `led_${companyId}_sales_return`;
    const fallbackSalesLedgerId = `led_${companyId}_sales`;
    const gstLedgerId = `led_${companyId}_output_gst`;

    // Customer ledger
    const customerLedgerSnap = await db
      .ref(`companyData/${companyId}/ledgers`)
      .orderByChild("partyId")
      .equalTo(invoice.customerId)
      .once("value");

    let customerLedgerId = `led_${companyId}_debtor_${invoice.customerId}`;
    if (customerLedgerSnap.exists()) {
      const match = Object.keys(customerLedgerSnap.val())[0];
      if (match) customerLedgerId = match;
    }

    // Check if sales_return ledger exists, else use standard sales ledger
    const srLedgerSnap = await db.ref(`companyData/${companyId}/ledgers/${salesReturnLedgerId}`).once("value");
    const targetRevenueLedgerId = srLedgerSnap.exists() ? salesReturnLedgerId : fallbackSalesLedgerId;

    const voucherLines: Array<{ ledgerId: string; debit: number; credit: number; partyId?: string; description?: string }> = [
      {
        ledgerId: targetRevenueLedgerId,
        debit: returnTaxablePaise,
        credit: 0,
        description: `Sales Return revenue reversal for ${salesReturnNumber}`,
      },
    ];

    if (returnTaxPaise > 0) {
      voucherLines.push({
        ledgerId: gstLedgerId,
        debit: returnTaxPaise,
        credit: 0,
        description: `Output GST reversal for Credit Note ${creditNoteNumber}`,
      });
    }

    voucherLines.push({
      ledgerId: customerLedgerId,
      debit: 0,
      credit: returnGrandTotalPaise,
      partyId: invoice.customerId,
      description: `Credit Note ${creditNoteNumber} against Invoice ${invoice.number}`,
    });

    const clientMutationId = input.clientMutationId || `mut-sr-${salesReturnId}`;

    const voucherRes = await executePostVoucher({
      idToken: input.idToken,
      companyId,
      branchId,
      financialYearId: invoice.financialYearId || `fy_${yyyy}`,
      voucherType: "journal",
      date: new Date(returnDate).toISOString().slice(0, 10),
      narration: `Credit Note ${creditNoteNumber} posted against Sales Invoice ${invoice.number} (${returnType} RETURN)`,
      clientMutationId,
      lines: voucherLines,
    });

    if (!voucherRes.success || !voucherRes.voucher) {
      return {
        success: false,
        error: voucherRes.error || "Failed to post double-entry voucher for credit note",
        code: "ACCOUNTING_ERROR",
      };
    }

    const voucherId = voucherRes.voucher.id;

    // 7. Calculate Customer Financial Impact (AR Reduction vs Customer Credit Generation)
    const currentInvoiceBalancePaise = Math.round((invoice.balance ?? invoice.grandTotal) * 100);
    let outstandingReducedPaise = 0;
    let customerCreditGeneratedPaise = 0;

    if (currentInvoiceBalancePaise > 0) {
      if (returnGrandTotalPaise <= currentInvoiceBalancePaise) {
        outstandingReducedPaise = returnGrandTotalPaise;
      } else {
        outstandingReducedPaise = currentInvoiceBalancePaise;
        customerCreditGeneratedPaise = returnGrandTotalPaise - currentInvoiceBalancePaise;
      }
    } else {
      // Invoice was already paid in full -> 100% of return value becomes available customer credit
      customerCreditGeneratedPaise = returnGrandTotalPaise;
    }

    // 8. Assemble SalesReturn & CreditNote domain records
    const salesReturnRecord: SalesReturn = {
      id: salesReturnId,
      number: salesReturnNumber,
      creditNoteNumber,
      creditNoteId,
      date: returnDate,
      companyId,
      branchId,
      branchSnapshot: branchData,
      financialYearId: invoice.financialYearId,
      customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot,
      originalInvoiceId,
      originalInvoiceNumber: invoice.number,
      originalInvoiceDate: invoice.date,
      returnType,
      items: returnLineItems,
      subtotal: returnSubtotal,
      discountTotal: returnDiscount,
      taxableAmount: returnTaxable,
      cgstTotal: returnCgst,
      sgstTotal: returnSgst,
      igstTotal: returnIgst,
      gstTotal: returnTaxTotal,
      roundOff: 0,
      grandTotal: returnGrandTotal,
      notes: notes || `Returned against invoice ${invoice.number}`,
      status: "posted",
      postingStatus: "posted",
      voucherId,
      customerCreditGeneratedPaise,
      customerCreditAllocatedPaise: 0,
      outstandingReducedPaise,
      companySnapshot: invoice.companySnapshot,
      signatorySnapshot: invoice.signatorySnapshot,
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
    };

    const creditNoteRecord: CreditNote = {
      id: creditNoteId,
      number: creditNoteNumber,
      salesReturnId,
      originalInvoiceId,
      originalInvoiceNumber: invoice.number,
      originalInvoiceDate: invoice.date,
      date: returnDate,
      companyId,
      branchId,
      branchSnapshot: branchData,
      financialYearId: invoice.financialYearId,
      customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot,
      items: returnLineItems,
      subtotal: returnSubtotal,
      discountTotal: returnDiscount,
      taxableAmount: returnTaxable,
      cgstTotal: returnCgst,
      sgstTotal: returnSgst,
      igstTotal: returnIgst,
      gstTotal: returnTaxTotal,
      roundOff: 0,
      grandTotal: returnGrandTotal,
      reason: returnLineItems[0]?.reason || "Other",
      notes: notes || "",
      voucherId,
      status: "posted",
      postingStatus: "posted",
      companySnapshot: invoice.companySnapshot,
      signatorySnapshot: invoice.signatorySnapshot,
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
    };

    // 9. Prepare atomic multi-path update in RTDB
    const updates: Record<string, unknown> = {};

    updates[`companyData/${companyId}/salesReturns/${salesReturnId}`] = salesReturnRecord;
    updates[`companyData/${companyId}/creditNotes/${creditNoteId}`] = creditNoteRecord;

    // Update original invoice balance
    const newInvoiceBalance = Math.max(0, currentInvoiceBalancePaise - outstandingReducedPaise) / 100;
    updates[`companyData/${companyId}/invoices/${originalInvoiceId}/balance`] = newInvoiceBalance;
    if (newInvoiceBalance === 0 && invoice.status !== "paid") {
      updates[`companyData/${companyId}/invoices/${originalInvoiceId}/status`] = "paid";
    }

    // 9a. Persist cumulative returned quantities on original invoice for concurrency tracking (Hardening Item 20)
    for (const reqItem of items) {
      const prev = previouslyReturnedQtyByItem[reqItem.invoiceItemId] || 0;
      updates[`companyData/${companyId}/invoices/${originalInvoiceId}/returnedQuantities/${reqItem.invoiceItemId}`] = prev + reqItem.returnQuantity;
    }

    // 9b. Persist Customer Credit record if return generated excess credit over AR (Hardening Task 4)
    if (customerCreditGeneratedPaise > 0) {
      updates[`companyData/${companyId}/customerCredits/${creditNoteId}`] = {
        id: creditNoteId,
        creditNoteId,
        creditNoteNumber,
        salesReturnId,
        originalInvoiceId,
        originalInvoiceNumber: invoice.number,
        customerId: invoice.customerId,
        companyId,
        branchId,
        amountPaise: customerCreditGeneratedPaise,
        amountRupees: customerCreditGeneratedPaise / 100,
        allocatedPaise: 0,
        remainingPaise: customerCreditGeneratedPaise,
        status: "available",
        createdAt: now,
        createdBy: callerUid,
        notes: `Customer credit from Credit Note ${creditNoteNumber} against Invoice ${invoice.number}`,
      };
    }

    // 10. Record stock movements for returned goods
    for (const it of returnLineItems) {
      if (it.restockAction === "RESTOCK_SALEABLE" || it.restockAction === "RESTOCK_DAMAGED") {
        const movementId = `sm_${now}_${Math.random().toString(36).substring(2, 6)}`;
        const movement = {
          id: movementId,
          companyId,
          branchId,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku || "",
          type: "SALES_RETURN",
          quantity: it.returnQuantity,
          direction: 1, // Positive inventory addition
          unit: it.uomLabel || "NOS",
          date: returnDate,
          timestamp: now,
          documentId: salesReturnId,
          documentNumber: salesReturnNumber,
          reference: `Credit Note ${creditNoteNumber} against Inv ${invoice.number}`,
          salesReturnId,
          creditNoteId,
          originalInvoiceId,
          restockLocation: it.restockAction === "RESTOCK_DAMAGED" ? "QUARANTINE" : "MAIN_STOCK",
          createdBy: callerUid,
        };
        updates[`companyData/${companyId}/stockMovements/${movementId}`] = movement;
      }
    }

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "sales_return",
      entityId: salesReturnId,
      action: "SALES_RETURN_CREATED",
      performedBy: callerUid,
      timestamp: now,
      details: {
        salesReturnNumber,
        creditNoteNumber,
        originalInvoiceNumber: invoice.number,
        grandTotal: returnGrandTotal,
        customerCreditGenerated: customerCreditGeneratedPaise / 100,
        outstandingReduced: outstandingReducedPaise / 100,
      },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      salesReturn: salesReturnRecord,
      creditNote: creditNoteRecord,
      voucherId,
      salesReturnId,
      creditNoteNumber,
    };
  }

  async reverseSalesReturn(input: ReverseSalesReturnInput): Promise<ReverseSalesReturnResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const { companyId, salesReturnId, callerUid, idToken, reason } = input;
    const db = adminApp.database();

    // 1. Fetch Sales Return
    const srSnap = await db.ref(`companyData/${companyId}/salesReturns/${salesReturnId}`).once("value");
    if (!srSnap.exists()) {
      return { success: false, error: "Sales return not found", code: "NOT_FOUND" };
    }

    const sr: SalesReturn = srSnap.val();
    if (sr.status === "reversed" || sr.postingStatus === "reversed") {
      return { success: false, error: "Sales return is already reversed", code: "ALREADY_REVERSED" };
    }

    // 2. Verify authorization
    const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!memSnap.exists()) {
      return { success: false, error: "Forbidden: Caller is not a member of this company", code: "FORBIDDEN" };
    }

    const membership = memSnap.val();
    const canReverse = hasBranchPermission(membership, sr.branchId, "SALES_RETURN_POST");
    if (!canReverse) {
      return {
        success: false,
        error: "Forbidden: You do not have permission to reverse sales returns for this branch.",
        code: "FORBIDDEN",
      };
    }

    // 3. Reverse the double-entry voucher
    let reversalVoucherId: string | undefined;
    if (sr.voucherId) {
      const vRes = await executeReverseVoucher({
        idToken,
        companyId,
        voucherId: sr.voucherId,
        reversalReason: reason || `Reversal of Sales Return ${sr.number}`,
        clientMutationId: `mut-rev-sr-${salesReturnId}`,
      });

      if (!vRes.success) {
        return {
          success: false,
          error: vRes.error || "Failed to reverse accounting voucher for this sales return",
          code: "ACCOUNTING_ERROR",
        };
      }
      reversalVoucherId = vRes.reversalVoucherId;
    }

    // 4. Fetch and restore original invoice balance
    const now = Date.now();
    const updates: Record<string, unknown> = {};

    let restoredInvoiceBalance = 0;
    if (sr.originalInvoiceId) {
      const invSnap = await db.ref(`companyData/${companyId}/invoices/${sr.originalInvoiceId}`).once("value");
      if (invSnap.exists()) {
        const inv: Invoice = invSnap.val();
        const currentBalPaise = Math.round((inv.balance ?? 0) * 100);
        const restoredBalPaise = currentBalPaise + (sr.outstandingReducedPaise || 0);
        restoredInvoiceBalance = restoredBalPaise / 100;

        updates[`companyData/${companyId}/invoices/${sr.originalInvoiceId}/balance`] = restoredInvoiceBalance;
        if (restoredInvoiceBalance > 0 && inv.status === "paid") {
          updates[`companyData/${companyId}/invoices/${sr.originalInvoiceId}/status`] = "partial";
        }
      }
    }

    // 5. Customer Credit Dependency Check (Hardening Item 19)
    // Block reversal if generated customer credit has already been allocated to other invoices
    if (sr.creditNoteId && (sr.customerCreditGeneratedPaise || 0) > 0) {
      const ccSnap = await db.ref(`companyData/${companyId}/customerCredits/${sr.creditNoteId}`).once("value");
      if (ccSnap.exists()) {
        const cc = ccSnap.val();
        const allocatedPaise = cc.allocatedPaise || 0;
        const remainingPaise = cc.remainingPaise !== undefined ? cc.remainingPaise : cc.amountPaise;
        if (allocatedPaise > 0 || remainingPaise < (cc.amountPaise || 0)) {
          const appliedRs = (allocatedPaise > 0 ? allocatedPaise : ((cc.amountPaise || 0) - remainingPaise)) / 100;
          return {
            success: false,
            error: `This Credit Note generated customer credit that has already been applied to another invoice (₹${appliedRs.toFixed(2)} applied). Reverse those allocations first.`,
            code: "CREDIT_DEPENDENCY_BLOCK",
          };
        }
      }
      updates[`companyData/${companyId}/customerCredits/${sr.creditNoteId}/status`] = "reversed";
      updates[`companyData/${companyId}/customerCredits/${sr.creditNoteId}/remainingPaise`] = 0;
      updates[`companyData/${companyId}/customerCredits/${sr.creditNoteId}/reversedAt`] = now;
      updates[`companyData/${companyId}/customerCredits/${sr.creditNoteId}/reversedBy`] = callerUid;
    }

    // 5b. Restore returnable quantities in atomic invoice return tracker (Hardening Item 20, 21)
    if (sr.originalInvoiceId && sr.items) {
      for (const it of sr.items) {
        updates[`companyData/${companyId}/invoices/${sr.originalInvoiceId}/returnedQuantities/${it.invoiceItemId}`] = 0;
      }
    }

    // 6. Reverse stock movements for returned goods
    for (const it of sr.items || []) {
      if (it.restockAction === "RESTOCK_SALEABLE" || it.restockAction === "RESTOCK_DAMAGED") {
        const movementId = `sm_${now}_rev_${Math.random().toString(36).substring(2, 6)}`;
        updates[`companyData/${companyId}/stockMovements/${movementId}`] = {
          id: movementId,
          companyId,
          branchId: sr.branchId,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku || "",
          type: "SALES_RETURN_REVERSAL",
          quantity: it.returnQuantity,
          direction: -1, // Remove goods previously added to stock
          unit: it.uomLabel || "NOS",
          date: now,
          timestamp: now,
          documentId: salesReturnId,
          documentNumber: sr.number,
          reference: `Reversal of Credit Note ${sr.creditNoteNumber}`,
          salesReturnId,
          creditNoteId: sr.creditNoteId,
          originalInvoiceId: sr.originalInvoiceId,
          createdBy: callerUid,
        };
      }
    }

    // 7. Mark SalesReturn and CreditNote as reversed
    updates[`companyData/${companyId}/salesReturns/${salesReturnId}/status`] = "reversed";
    updates[`companyData/${companyId}/salesReturns/${salesReturnId}/postingStatus`] = "reversed";
    updates[`companyData/${companyId}/salesReturns/${salesReturnId}/reversalVoucherId`] = reversalVoucherId || null;
    updates[`companyData/${companyId}/salesReturns/${salesReturnId}/reversedAt`] = now;
    updates[`companyData/${companyId}/salesReturns/${salesReturnId}/reversedBy`] = callerUid;

    if (sr.creditNoteId) {
      updates[`companyData/${companyId}/creditNotes/${sr.creditNoteId}/status`] = "reversed";
      updates[`companyData/${companyId}/creditNotes/${sr.creditNoteId}/postingStatus`] = "reversed";
      updates[`companyData/${companyId}/creditNotes/${sr.creditNoteId}/reversalVoucherId`] = reversalVoucherId || null;
      updates[`companyData/${companyId}/creditNotes/${sr.creditNoteId}/reversedAt`] = now;
      updates[`companyData/${companyId}/creditNotes/${sr.creditNoteId}/reversedBy`] = callerUid;
    }

    // 8. Audit log
    const auditId = `audit_${now}_rev_sr_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "sales_return",
      entityId: salesReturnId,
      action: "SALES_RETURN_REVERSED",
      performedBy: callerUid,
      timestamp: now,
      details: {
        salesReturnNumber: sr.number,
        creditNoteNumber: sr.creditNoteNumber,
        originalInvoiceNumber: sr.originalInvoiceNumber,
        reversalVoucherId,
        restoredInvoiceBalance,
        cancelledCustomerCredit: (sr.customerCreditGeneratedPaise || 0) / 100,
        reason,
      },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      salesReturnId,
      reversalVoucherId,
      restoredInvoiceBalance,
    };
  }

  async getSalesReturn(companyId: string, salesReturnId: string): Promise<SalesReturn | null> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;
    const snap = await adminApp.database().ref(`companyData/${companyId}/salesReturns/${salesReturnId}`).once("value");
    if (!snap.exists()) return null;
    return snap.val();
  }

  async listSalesReturns(companyId: string, branchId?: string, callerUid?: string): Promise<SalesReturn[]> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return [];
    const db = adminApp.database();

    // Verify caller membership and branch boundaries if callerUid provided
    let allowedBranchIds: string[] | null = null;
    let isOwner = false;
    if (callerUid) {
      const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
      if (!memSnap.exists()) return [];
      const membership = memSnap.val();
      if (membership.status !== "active") return [];
      const role = (membership.organizationRole || membership.role || "").toLowerCase();
      isOwner = role === "owner";
      if (!isOwner) {
        allowedBranchIds = membership.branchIds || (membership.branchAccess || []).map((ba: any) => ba.branchId);
        if (branchId && branchId !== "all" && !allowedBranchIds?.includes(branchId)) {
          // Cross-branch read attempt: return empty authorized result
          return [];
        }
      }
    }

    const snap = await db.ref(`companyData/${companyId}/salesReturns`).once("value");
    if (!snap.exists()) return [];

    const raw = snap.val();
    const list: SalesReturn[] = Object.values(raw);

    if (branchId && branchId !== "all") {
      return list.filter((r) => r.branchId === branchId);
    }

    if (!isOwner && allowedBranchIds) {
      const allowedSet = new Set(allowedBranchIds);
      return list.filter((r) => !r.branchId || allowedSet.has(r.branchId));
    }

    return list;
  }

  async getReturnsForInvoice(companyId: string, originalInvoiceId: string): Promise<SalesReturn[]> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return [];
    const snap = await adminApp
      .database()
      .ref(`companyData/${companyId}/salesReturns`)
      .orderByChild("originalInvoiceId")
      .equalTo(originalInvoiceId)
      .once("value");

    if (!snap.exists()) return [];
    return Object.values(snap.val());
  }
}
