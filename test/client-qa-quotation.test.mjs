import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportQuotationPDF } from "../src/lib/quotationExport.ts";

test("Generate Full KH Portable Cabins Production QA Quotation PDF", async () => {
  const company = {
    legalName: "KH Portable Cabins Private Limited",
    name: "KH Portable Cabins",
    address: "Plot No. 42, Industrial Area, Phase II\nNear Gottipura, Hoskote Taluk, Atturu",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "562114",
    phone: "+91 9876543210",
    email: "info@khportablecabins.com",
    gstin: "29ABCDE1234F1Z5",
    pan: "ABCDE1234F",
    bankName: "HDFC Bank",
    bankAccountName: "KH Portable Cabins Private Limited",
    bankAccountNo: "50200088991122",
    bankIfsc: "HDFC0001234",
    bankBranch: "Hoskote Branch",
    upiId: "khcabins@hdfcbank",
    authorizedSignatory: "K. H. Khaisar",
    designation: "Managing Director",
  };

  const customer = {
    id: "cust-infra-01",
    name: "Apex Infrastructure Solutions LLP",
    tradingName: "Apex Infra",
    address: "Prestige Meridian, 8th Floor, MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    phone: "+91 80 22334455",
    gstin: "29XYZAB5678C1Z2",
  };

  const sampleQuotation = {
    id: "qt-kh-sample-01",
    number: "QT-2026-0842",
    date: Date.now(),
    validity: Date.now() + 30 * 24 * 60 * 60 * 1000,
    preparedBy: "Maaz (Sales Engineering)",
    siteLocation: "Apex Tech Park, Hoskote Site Yard",
    customerId: customer.id,
    customerSnapshot: customer,
    companySnapshot: company,
    billToPartyId: customer.id,
    billToSnapshot: {
      partyName: customer.name,
      tradingName: customer.tradingName,
      addressLine1: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      gstin: customer.gstin,
      phone: customer.phone,
    },
    sameAsBilling: false,
    shipToPartyId: customer.id,
    shippingAddress: "Plot 104-B, Hoskote Industrial Area, Near Attibele Ring Road, Bengaluru Rural",
    shippingAddressSnapshot: {
      partyName: "Apex Infrastructure — Site Office #2",
      addressLine1: "Plot 104-B, Hoskote Industrial Area",
      city: "Hoskote",
      state: "Karnataka",
      pincode: "562114",
      phone: "+91 9988776655",
      contactPerson: "Mr. Suresh (Site Engineer)",
    },
    items: [
      {
        productId: "p1",
        name: "Standard Portable Office Cabin 40' x 10' x 8.5'",
        description: "Heavy duty MS steel framed portable office cabin complete with thermal insulation, cement board flooring, vinyl tile finish, modular electrical distribution, LED panel lights, and powder-coated aluminium windows.",
        quantity: 1,
        unit: "nos",
        rate: 285000,
        discountPct: 0,
        gstRate: 18,
        lineTotal: 285000,
      },
      {
        productId: "p2",
        name: "Executive Security Guard Cabin 8' x 8' x 8.5'",
        description: "Compact security cabin with all-around 360-degree glass visibility, sliding service counter, insulated roof, and pre-wired switchboard with utility fan mounting.",
        quantity: 2,
        unit: "nos",
        rate: 55000,
        discountPct: 0,
        gstRate: 18,
        lineTotal: 110000,
      },
    ],
    subtotal: 395000,
    discountTotal: 15000,
    extraCharges: [
      { label: "Hydraulic Crane Offloading & Positioning at Site", amount: 12000, isTaxable: true },
      { label: "Freight & Highway Toll Charges (Factory to Site)", amount: 18000, isTaxable: true },
    ],
    extraChargesTotal: 30000,
    gstCalculationMode: "overall",
    overallGstRate: 18,
    // (395000 - 15000 + 30000) = 410,000 * 18% = 73,800
    gstTotal: 73800,
    cgstTotal: 36900,
    sgstTotal: 36900,
    roundOff: 0,
    grandTotal: 483800,
    includeGeneralInfo: true,
    includeTechSpecs: true,
    includeTerms: true,
    includeBankDetails: true,
    generalInformationSnapshot: [
      {
        type: "GENERAL_INFO",
        title: "Commercial & Site General Information",
        rows: [
          {
            label: "Configuration of Cabins",
            valueType: "BULLET_LIST",
            value: "• Unit 1: 40'L x 10'W x 8.5'H — Executive Office with Partition\n• Unit 2 & 3: 8'L x 8'W x 8.5'H — Security Checkpost Cabins",
          },
          {
            label: "Transportation / Freight Charges",
            valueType: "TEXT",
            value: "INCLUDED (To Hoskote Site Yard)",
          },
          {
            label: "Foundation for Cabin",
            valueType: "MULTILINE",
            value: "Levelled plain cement concrete (PCC) pads or uniform hard-standing ground to be prepared by the buyer prior to delivery.",
          },
          {
            label: "Unloading & Installation",
            valueType: "TEXT",
            value: "Hydraulic crane unloading and positioning included in scope of supply.",
          },
          {
            label: "Power & Utility Connections",
            valueType: "MULTILINE",
            value: "External DG/Mains line connection up to cabin junction box in buyer's scope. All internal wiring and sockets pre-tested.",
          },
        ],
      },
    ],
    technicalSpecificationSnapshot: [
      {
        type: "SPEC_TABLE",
        title: "Fabrication Specifications",
        subtitle: "Frame & Structural Steel",
        rows: [
          { label: "Base Frame", value: "ISMC 100 x 50mm C-Channels with cross stiffeners at 600mm c/c" },
          { label: "Roof Frame", value: "Made of 50 x 50 x 2.5mm square hollow sections with camber slope" },
          { label: "Side Panel Frame", value: "Tapered 40 x 40 x 2mm tubular steel framework" },
          { label: "Corrosion Protection", value: "Two coats of red oxide zinc chromate epoxy primer + two coats polyurethane finish" },
        ],
      },
      {
        type: "SPEC_TABLE",
        title: "Panel & Insulation Material",
        subtitle: "Wall & Ceiling Envelope",
        rows: [
          { label: "Exterior Cladding", value: "Specially corrugated 1.2mm thick CRCA sheets waterproof seam welded" },
          { label: "Thermal Insulation", value: "50mm thick high-density rockwool / glasswool (min 48 kg/m³ density)" },
          { label: "Internal Panelling", value: "9mm pre-laminated MDF decorative particle board in approved off-white shade" },
          { label: "Flooring Base", value: "18mm marine grade calibrated ply topped with 1.5mm anti-static heavy duty vinyl sheet" },
        ],
      },
      {
        type: "SPEC_TABLE",
        title: "Electrical Specifications",
        subtitle: "Wiring, Distribution & Fixtures",
        rows: [
          { label: "Internal Wiring", value: "Concealed heavy-duty FR grade multi-strand copper wire (Finolex/Polycab) inside PVC conduits" },
          { label: "Lighting", value: "2x2 36W LED panel lights with glare-free diffusers (Philips/Wipro)" },
          { label: "Distribution Board", value: "4-way SPN DB with 40A DP MCB master isolator + 10A/20A individual circuit MCBs" },
          { label: "Power Outlets", value: "Anchor Roma modular 6A & 16A shuttered sockets with separate AC power point" },
        ],
      },
    ],
    termsSnapshot: [
      "1. 50% advance payment along with confirmed Purchase Order.",
      "2. 40% payment against proforma invoice and inspection prior to factory dispatch.",
      "3. 10% balance payment immediately upon safe delivery and installation at site.",
      "4. Delivery Schedule: 15 to 20 working days from the date of receipt of confirmed PO and advance payment.",
      "5. GST @ 18% as charged above is statutory. Any revision by the Government prior to invoice date will apply on buyer's account.",
      "6. Transit insurance from factory gate to unloading site is covered under vendor's open marine policy.",
      "7. Site clearance, road access, and right of way for 40-foot articulated trailer must be ensured by buyer.",
      "8. Power and water connections for testing and commissioning shall be provided free of cost by the client.",
      "9. Warranty: 12 months comprehensive structural warranty against manufacturing defects from the date of handover.",
      "10. Force Majeure: Vendor shall not be held responsible for delays arising from natural calamities, road blockades, or government restrictions.",
      "11. Validity of this quotation is 30 calendar days from the date of issue.",
      "12. All disputes are subject to the exclusive legal jurisdiction of Bengaluru courts only.",
    ],
    bankDetailsSnapshot: {
      accountName: "KH Portable Cabins Private Limited",
      accountNo: "50200088991122",
      bankName: "HDFC Bank",
      ifsc: "HDFC0001234",
      branch: "Hoskote Branch, Bengaluru",
      accountType: "Current Account",
      upi: "khcabins@hdfcbank",
    },
    signatorySnapshot: {
      authorizedSignatory: "K. H. Khaisar",
      designation: "Managing Director",
      showSignature: true,
      showStamp: true,
      showSignatoryName: true,
      showDesignation: true,
      showSignatureDate: true,
    },
  };

  const blob = await exportQuotationPDF(sampleQuotation, company, customer);
  assert.ok(blob, "PDF Blob should be generated");
  assert.ok(blob.size > 10000, `PDF size should be substantial (got ${blob.size} bytes)`);

  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const outDir = path.resolve("test", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "KH_Portable_Cabins_Production_QA_Quotation.pdf");
  fs.writeFileSync(outPath, buffer);
  console.log(`Generated QA PDF: ${outPath} (${buffer.length} bytes)`);

  // Verify PDF header magic bytes "%PDF-"
  const magic = buffer.subarray(0, 5).toString("ascii");
  assert.equal(magic, "%PDF-", "Generated file must be a valid PDF document");
});
