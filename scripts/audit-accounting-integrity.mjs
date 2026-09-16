#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const scalar = (value) => String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2");
const privateKey = scalar(process.env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, "\n");

try {
  const { default: admin } = await import("firebase-admin");
  const app = admin.apps[0] || admin.initializeApp({
    credential: admin.credential.cert({
      projectId: scalar(process.env.FIREBASE_ADMIN_PROJECT_ID),
      clientEmail: scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      privateKey,
    }),
    databaseURL: scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL),
  });

  const db = app.database();
  const compSnap = await db.ref("companies").once("value");
  const companies = compSnap.val() || {};
  console.log("Found companies:", Object.keys(companies));

  for (const companyId of Object.keys(companies)) {
    console.log(`\n================ COMPANY: ${companyId} (${companies[companyId]?.name}) ================`);
    
    // Vouchers
    const vouchersSnap = await db.ref(`companyData/${companyId}/vouchers`).once("value");
    const vouchers = vouchersSnap.val() || {};
    const voucherList = Object.values(vouchers);
    console.log(`Total vouchers: ${voucherList.length}`);

    let totDr = 0;
    let totCr = 0;
    let postedCount = 0;
    const unbalancedVouchers = [];

    for (const v of voucherList) {
      if (v.status !== "posted" && v.status !== "reversed") continue;
      postedCount++;
      let vDr = 0;
      let vCr = 0;
      for (const line of v.lines || []) {
        vDr += line.debit || 0;
        vCr += line.credit || 0;
      }
      totDr += vDr;
      totCr += vCr;
      if (vDr !== vCr) {
        unbalancedVouchers.push({ id: v.id, number: v.voucherNumber, vDr, vCr });
      }
    }

    console.log(`Posted/Reversed vouchers: ${postedCount}`);
    console.log(`Day Book Total Debit:  ₹${(totDr / 100).toFixed(2)} (${totDr} paise)`);
    console.log(`Day Book Total Credit: ₹${(totCr / 100).toFixed(2)} (${totCr} paise)`);
    console.log(`Day Book Balanced: ${totDr === totCr}`);
    if (unbalancedVouchers.length > 0) {
      console.log("UNBALANCED VOUCHERS FOUND:", unbalancedVouchers);
    }

    // Ledgers
    const ledgersSnap = await db.ref(`companyData/${companyId}/ledgers`).once("value");
    const ledgers = ledgersSnap.val() || {};
    const ledgerList = Object.values(ledgers);
    console.log(`Total ledgers: ${ledgerList.length}`);

    const ledgerMovements = {};
    for (const l of ledgerList) {
      ledgerMovements[l.id] = {
        name: l.name,
        partyType: l.partyType,
        partyId: l.partyId,
        groupId: l.groupId,
        groupNature: l.groupNature,
        currentBalance: l.currentBalance,
        openingBalance: l.openingBalance || 0,
        openingType: l.openingBalanceType || "dr",
        dr: 0,
        cr: 0,
      };
    }

    for (const v of voucherList) {
      if (v.status !== "posted") continue;
      for (const line of v.lines || []) {
        if (!ledgerMovements[line.ledgerId]) {
          ledgerMovements[line.ledgerId] = {
            name: `Unknown (${line.ledgerId})`,
            dr: 0,
            cr: 0,
            openingBalance: 0,
            openingType: "dr",
          };
        }
        ledgerMovements[line.ledgerId].dr += line.debit || 0;
        ledgerMovements[line.ledgerId].cr += line.credit || 0;
      }
    }

    console.log("\n--- LEDGER SUMMARY ---");
    let tbDr = 0;
    let tbCr = 0;
    for (const [lId, m] of Object.entries(ledgerMovements)) {
      const openSigned = (m.openingBalance || 0) * (m.openingType === "dr" ? 1 : -1);
      const signedClosing = openSigned + m.dr - m.cr;
      let cDr = 0;
      let cCr = 0;
      if (signedClosing > 0) {
        cDr = signedClosing;
        tbDr += cDr;
      } else if (signedClosing < 0) {
        cCr = Math.abs(signedClosing);
        tbCr += cCr;
      }
      if (m.dr > 0 || m.cr > 0 || m.openingBalance > 0 || m.currentBalance !== 0) {
        console.log(`Ledger: "${m.name}" (${lId}) | Group: ${m.groupId} | Open: ₹${(openSigned/100).toFixed(2)} | Dr: ₹${(m.dr/100).toFixed(2)} | Cr: ₹${(m.cr/100).toFixed(2)} | SignedClosing: ₹${(signedClosing/100).toFixed(2)} | StoredCurrentBal: ₹${((m.currentBalance||0)/100).toFixed(2)}`);
      }
    }

    console.log(`\nTrial Balance using signedClosing formula:`);
    console.log(`TB Total Debit:  ₹${(tbDr / 100).toFixed(2)} (${tbDr} paise)`);
    console.log(`TB Total Credit: ₹${(tbCr / 100).toFixed(2)} (${tbCr} paise)`);
    console.log(`TB Balanced: ${tbDr === tbCr}`);

    // Check what happens if using stored currentBalance (as TrialBalanceView was doing!)
    let oldTbDr = 0;
    let oldTbCr = 0;
    for (const l of ledgerList) {
      const curBal = l.currentBalance || 0;
      if (curBal > 0) oldTbDr += curBal;
      else if (curBal < 0) oldTbCr += Math.abs(curBal);
    }
    console.log(`\nTrial Balance using stored l.currentBalance:`);
    console.log(`Old TB Debit:  ₹${(oldTbDr / 100).toFixed(2)} (${oldTbDr} paise)`);
    console.log(`Old TB Credit: ₹${(oldTbCr / 100).toFixed(2)} (${oldTbCr} paise)`);
    console.log(`Old TB Diff:   ₹${(Math.abs(oldTbDr - oldTbCr) / 100).toFixed(2)}`);

    // Invoices
    const invSnap = await db.ref(`companyData/${companyId}/invoices`).once("value");
    const invoices = invSnap.val() || {};
    console.log(`\nTotal invoices: ${Object.keys(invoices).length}`);
    let grossBilled = 0;
    let netSales = 0;
    let totalRoundOff = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    for (const [invId, inv] of Object.entries(invoices)) {
      console.log(`\nInvoice ${inv.invoiceNumber || inv.id}: status=${inv.status}, total=${inv.grandTotal}, balance=${inv.balance}, customerId=${inv.customerId}, customerName=${inv.customerName}, subtotal=${inv.subtotal}, roundOff=${inv.roundOff}, date=${inv.date}`);
      console.log(`  Items:`, JSON.stringify(inv.items?.map(i => ({ name: i.name, qty: i.quantity, rate: i.rate, amount: i.amount, productId: i.productId }))));
      if (inv.status === "posted") {
        grossBilled += inv.grandTotal || 0;
        netSales += (inv.subtotal || 0) - (inv.discountTotal || 0);
        totalRoundOff += inv.roundOff || 0;
        totalCgst += inv.taxSummary?.cgst || inv.cgstTotal || 0;
        totalSgst += inv.taxSummary?.sgst || inv.sgstTotal || 0;
        totalIgst += inv.taxSummary?.igst || inv.igstTotal || 0;
      }
    }
    console.log(`\nPosted Invoices Net Sales: ₹${netSales.toFixed(2)}`);
    console.log(`Posted Invoices Round-Off: ₹${totalRoundOff.toFixed(2)}`);
    console.log(`Posted Invoices CGST: ₹${totalCgst.toFixed(2)}, SGST: ₹${totalSgst.toFixed(2)}, IGST: ₹${totalIgst.toFixed(2)}, Output GST: ₹${(totalCgst + totalSgst + totalIgst).toFixed(2)}`);
    console.log(`Posted Invoices Gross Billed: ₹${grossBilled.toFixed(2)}`);

    // Receipts
    const recSnap = await db.ref(`companyData/${companyId}/receipts`).once("value");
    const receipts = recSnap.val() || {};
    console.log(`\nTotal receipts: ${Object.keys(receipts).length}`);
    let totalReceived = 0;
    for (const [recId, rec] of Object.entries(receipts)) {
      console.log(`\nReceipt ${rec.receiptNumber || rec.id}: status=${rec.status}, amount=${rec.amount}, customerId=${rec.customerId}, date=${rec.date}, customerName=${rec.customerName}`);
      console.log(`  Allocations:`, JSON.stringify(rec.allocations || rec.allocatedInvoices || []));
      console.log(`  Raw keys:`, Object.keys(rec));
      if (rec.status === "posted") {
        totalReceived += rec.amount || 0;
      }
    }
    console.log(`Posted Receipts Total: ₹${totalReceived.toFixed(2)}`);

    // Vouchers detail
    console.log(`\nVOUCHERS DETAIL:`);
    for (const v of voucherList) {
      console.log(`\nVoucher ${v.voucherNumber} (${v.id}) [${v.status}] date=${v.date} type=${v.voucherType} ref=${v.reference}`);
      for (const line of v.lines || []) {
        console.log(`  Line: ledgerId=${line.ledgerId} partyId=${line.partyId} debit=₹${(line.debit/100).toFixed(2)} credit=₹${(line.credit/100).toFixed(2)} desc=${line.description}`);
      }
    }

    // Products detail for COGS
    const prodSnap = await db.ref(`companyData/${companyId}/products`).once("value");
    const products = prodSnap.val() || {};
    console.log(`\nProducts detail:`);
    for (const [pId, p] of Object.entries(products)) {
      console.log(`  Product ${p.name} (${pId}): purchasePrice=${p.purchasePrice}, defaultPurchaseRatePaise=${p.defaultPurchaseRatePaise}, currentStock=${p.currentStock}`);
    }

    // Customer credits
    const custCreditsSnap = await db.ref(`companyData/${companyId}/partyCredits`).once("value");
    const partyCredits = custCreditsSnap.val() || {};
    console.log(`\nParty Credits:`, JSON.stringify(partyCredits, null, 2));
  }

  process.exit(0);
} catch (err) {
  console.error("Audit error:", err);
  process.exit(1);
}
