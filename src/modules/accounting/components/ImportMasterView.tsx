import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, uid, type Party, type Product } from "@/lib/db";
import type { Ledger, AccountGroup, ManageLedgerInput } from "../types";
import { rupeesToPaise } from "../constants";

type ImportType = "accounts" | "products" | "parties";

interface ImportMasterViewProps {
  accountGroups?: AccountGroup[];
  onCreateLedger?: (input: Omit<ManageLedgerInput, "idToken" | "companyId">) => Promise<{ success: boolean; error?: string }>;
  onImportSuccess?: () => void;
}

export function ImportMasterView({
  accountGroups = [],
  onCreateLedger,
  onImportSuccess,
}: ImportMasterViewProps) {
  const [importType, setImportType] = useState<ImportType>("accounts");
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [validationErrors, setValidationErrors] = useState<{ row: number; error: string }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Download Sample Templates
  const downloadSampleTemplate = () => {
    let headers: string[] = [];
    let sampleData: any[] = [];
    let sheetName = "";

    if (importType === "accounts") {
      sheetName = "Accounts Master Template";
      sampleData = [
        {
          "Account Name": "HDFC Bank Ltd Current",
          "Account Code": "BANK-01",
          "Parent Group": "Bank Accounts",
          "Opening Balance": 50000,
          "Dr or Cr": "DR",
          "GSTIN": "27AAAAA0000A1Z5",
          "PAN": "AAAAA0000A",
          "Classification": "bank",
        },
        {
          "Account Name": "Office Rent Expense",
          "Account Code": "EXP-01",
          "Parent Group": "Indirect Expenses",
          "Opening Balance": 0,
          "Dr or Cr": "DR",
          "GSTIN": "",
          "PAN": "",
          "Classification": "general",
        },
        {
          "Account Name": "Acme Tools & Hardware",
          "Account Code": "SUP-01",
          "Parent Group": "Sundry Creditors",
          "Opening Balance": 15000,
          "Dr or Cr": "CR",
          "GSTIN": "27BBBBB1111B1Z2",
          "PAN": "BBBBB1111B",
          "Classification": "supplier",
        },
      ];
    } else if (importType === "products") {
      sheetName = "Products Master Template";
      sampleData = [
        {
          "Product Name": "Mild Steel Angle 50x50x6",
          "SKU": "MSA-50",
          "HSN": "7216",
          "Unit": "KG",
          "Purchase Price": 65,
          "Selling Price": 78,
          "Opening Stock": 500,
          "Reorder Level": 100,
          "GST Rate": 18,
        },
        {
          "Product Name": "Galvanized Hex Bolt M12x50",
          "SKU": "BOLT-M12",
          "HSN": "7318",
          "Unit": "PCS",
          "Purchase Price": 12,
          "Selling Price": 18,
          "Opening Stock": 1200,
          "Reorder Level": 250,
          "GST Rate": 18,
        },
      ];
    } else if (importType === "parties") {
      sheetName = "Parties Master Template";
      sampleData = [
        {
          "Party Name": "Apex Engineering Works",
          "Party Type": "CUSTOMER",
          "Mobile": "9876543210",
          "Email": "info@apexeng.example",
          "GSTIN": "27AABCA1234A1Z5",
          "Address": "Plot 42, MIDC Industrial Area",
          "City": "Mumbai",
          "State": "Maharashtra",
          "Pincode": "400093",
          "Opening Balance": 25000,
        },
        {
          "Party Name": "National Steel Suppliers",
          "Party Type": "SUPPLIER",
          "Mobile": "9820012345",
          "Email": "sales@nationalsteel.example",
          "GSTIN": "27XYZAB9876C1Z9",
          "Address": "Loha Bhavan, Carnac Bunder",
          "City": "Mumbai",
          "State": "Maharashtra",
          "Pincode": "400009",
          "Opening Balance": 0,
        },
      ];
    }

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${sheetName.replace(/\s+/g, "_")}.xlsx`);
    toast.success(`Sample template for ${importType} downloaded`);
  };

  // Handle File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(ws);

        if (!rawJson || rawJson.length === 0) {
          toast.error("The uploaded file contains no data rows.");
          return;
        }

        validateAndSetRows(rawJson);
      } catch (err: any) {
        toast.error(`Failed to read file: ${err?.message || "Invalid Excel/CSV format"}`);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Validate Rows based on Import Type
  const validateAndSetRows = (rows: any[]) => {
    const errors: { row: number; error: string }[] = [];
    const validated: any[] = [];

    rows.forEach((r, idx) => {
      const rowNum = idx + 2; // Excel row numbering
      if (importType === "accounts") {
        const name = r["Account Name"] || r["name"] || r["Account"];
        if (!name) {
          errors.push({ row: rowNum, error: "Missing Account Name" });
        }
        validated.push({
          row: rowNum,
          name: String(name || "").trim(),
          code: String(r["Account Code"] || r["code"] || "").trim(),
          parentGroup: String(r["Parent Group"] || r["group"] || "Bank Accounts").trim(),
          openingBalance: parseFloat(r["Opening Balance"] || 0) || 0,
          drOrCr: String(r["Dr or Cr"] || "DR").trim().toLowerCase() === "cr" ? "cr" : "dr",
          gstin: String(r["GSTIN"] || r["gstin"] || "").trim().toUpperCase(),
          pan: String(r["PAN"] || r["pan"] || "").trim().toUpperCase(),
          classification: String(r["Classification"] || "general").trim().toLowerCase(),
          isValid: Boolean(name),
        });
      } else if (importType === "products") {
        const name = r["Product Name"] || r["name"] || r["Product"];
        if (!name) {
          errors.push({ row: rowNum, error: "Missing Product Name" });
        }
        validated.push({
          row: rowNum,
          name: String(name || "").trim(),
          sku: String(r["SKU"] || r["sku"] || "").trim(),
          hsn: String(r["HSN"] || r["hsn"] || "").trim(),
          unit: String(r["Unit"] || r["unit"] || "PCS").trim().toUpperCase(),
          purchasePrice: parseFloat(r["Purchase Price"] || 0) || 0,
          sellingPrice: parseFloat(r["Selling Price"] || 0) || 0,
          openingStock: parseFloat(r["Opening Stock"] || 0) || 0,
          reorderLevel: parseFloat(r["Reorder Level"] || 0) || 0,
          gstRate: parseFloat(r["GST Rate"] || 18) || 18,
          isValid: Boolean(name),
        });
      } else if (importType === "parties") {
        const name = r["Party Name"] || r["name"] || r["Party"];
        if (!name) {
          errors.push({ row: rowNum, error: "Missing Party Name" });
        }
        validated.push({
          row: rowNum,
          name: String(name || "").trim(),
          partyType: String(r["Party Type"] || "CUSTOMER").trim().toUpperCase(),
          mobile: String(r["Mobile"] || r["mobile"] || "").trim(),
          email: String(r["Email"] || r["email"] || "").trim(),
          gstin: String(r["GSTIN"] || r["gstin"] || "").trim().toUpperCase(),
          address: String(r["Address"] || r["address"] || "").trim(),
          city: String(r["City"] || r["city"] || "").trim(),
          state: String(r["State"] || r["state"] || "").trim(),
          pincode: String(r["Pincode"] || r["pincode"] || "").trim(),
          openingBalance: parseFloat(r["Opening Balance"] || 0) || 0,
          isValid: Boolean(name),
        });
      }
    });

    setParsedRows(validated);
    setValidationErrors(errors);

    if (errors.length === 0) {
      toast.success(`${validated.length} rows parsed and verified successfully`);
    } else {
      toast.warning(`${validated.length} rows parsed with ${errors.length} issues`);
    }
  };

  // Perform Actual Import into Dexie & System
  const executeImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      toast.error("No valid rows to import.");
      return;
    }

    setIsProcessing(true);
    let successCount = 0;

    try {
      if (importType === "accounts") {
        // Resolve parent group IDs
        for (const row of validRows) {
          const matchedGroup = accountGroups.find(
            (g) => g.name.toLowerCase() === row.parentGroup.toLowerCase() || g.id === row.parentGroup
          ) || accountGroups[0];

          if (onCreateLedger) {
            const res = await onCreateLedger({
              name: row.name,
              code: row.code || undefined,
              groupId: matchedGroup ? matchedGroup.id : "grp_bank",
              openingBalance: rupeesToPaise(row.openingBalance),
              openingBalanceType: row.drOrCr,
              gstin: row.gstin || undefined,
              pan: row.pan || undefined,
              partyType: row.classification,
              active: true,
            });

            if (res.success) successCount++;
          } else {
            const opPaise = rupeesToPaise(row.openingBalance);
            await db().ledgers.put({
              id: uid(),
              companyId: matchedGroup?.companyId || "default",
              name: row.name,
              code: row.code || undefined,
              groupId: matchedGroup ? matchedGroup.id : "grp_bank",
              groupNature: matchedGroup ? matchedGroup.nature : "asset",
              openingBalance: opPaise,
              openingBalanceType: row.drOrCr,
              currentBalance: row.drOrCr === "dr" ? opPaise : -opPaise,
              currency: "INR",
              gstin: row.gstin || undefined,
              pan: row.pan || undefined,
              partyType: row.classification,
              active: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            successCount++;
          }
        }
      } else if (importType === "products") {
        const productEntities: Product[] = validRows.map((row) => ({
          id: uid(),
          name: row.name,
          sku: row.sku || undefined,
          hsn: row.hsn || undefined,
          unit: row.unit || "PCS",
          purchasePrice: row.purchasePrice,
          sellingPrice: row.sellingPrice,
          openingStock: row.openingStock,
          currentStock: row.openingStock,
          reorderLevel: row.reorderLevel,
          gstRate: row.gstRate,
          createdAt: Date.now(),
          active: true,
        }));

        await db().products.bulkPut(productEntities);
        successCount = productEntities.length;
      } else if (importType === "parties") {
        const partyEntities: Party[] = validRows.map((row) => ({
          id: uid(),
          name: row.name,
          partyType: row.partyType as any,
          mobile: row.mobile || undefined,
          email: row.email || undefined,
          gstin: row.gstin || undefined,
          address: row.address || undefined,
          city: row.city || undefined,
          state: row.state || undefined,
          pincode: row.pincode || undefined,
          openingBalance: row.openingBalance,
          createdAt: Date.now(),
          active: true,
        }));

        await db().parties.bulkPut(partyEntities);
        successCount = partyEntities.length;
      }

      toast.success(`Successfully imported ${successCount} records!`);
      // Reset state
      setParsedRows([]);
      setValidationErrors([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      toast.error(`Import failed: ${err?.message || "Database write error"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const validCount = parsedRows.filter((r) => r.isValid).length;

  return (
    <div className="space-y-4">
      {/* Configuration Header Card */}
      <Card className="p-4 card-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Bulk Import Master
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload spreadsheets (.xlsx or .csv) to rapidly ingest Accounts, Products, and Parties into local & cloud databases.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Select value={importType} onValueChange={(v: ImportType) => { setImportType(v); setParsedRows([]); setFileName(""); }}>
              <SelectTrigger className="w-44 text-xs h-9">
                <SelectValue placeholder="Import Target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="accounts" className="text-xs">Accounts Master</SelectItem>
                <SelectItem value="products" className="text-xs">Products & Inventory</SelectItem>
                <SelectItem value="parties" className="text-xs">Parties (Customers & Vendors)</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={downloadSampleTemplate} className="gap-1.5 text-xs h-9">
              <Download className="h-3.5 w-3.5" />
              <span>Sample Template</span>
            </Button>
          </div>
        </div>

        {/* Upload Zone */}
        <div className="mt-4 border-2 border-dashed border-border/80 rounded-xl p-6 text-center hover:bg-secondary/20 transition-colors">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
            id="master-file-upload"
          />
          <label htmlFor="master-file-upload" className="cursor-pointer flex flex-col items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-sm font-semibold text-foreground">
              {fileName ? fileName : `Click to upload ${importType.toUpperCase()} spreadsheet`}
            </div>
            <div className="text-xs text-muted-foreground">
              Supports Microsoft Excel (.xlsx, .xls) and UTF-8 CSV
            </div>
          </label>
        </div>
      </Card>

      {/* Preview Table & Actions */}
      {parsedRows.length > 0 && (
        <Card className="p-4 card-soft space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> {validCount} Valid Records
              </Badge>
              {validationErrors.length > 0 && (
                <Badge variant="secondary" className="gap-1 bg-rose-500/10 text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" /> {validationErrors.length} Issues
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setParsedRows([]); setFileName(""); }}
                className="gap-1 text-xs h-8"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button
                size="sm"
                onClick={executeImport}
                disabled={isProcessing || validCount === 0}
                className="gap-1.5 text-xs h-8 bg-primary text-primary-foreground font-semibold"
              >
                <span>{isProcessing ? "Importing Records..." : `Import ${validCount} Records`}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[420px] scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Primary Name</TableHead>
                  {importType === "accounts" && (
                    <>
                      <TableHead>Code</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead className="text-right">Opening Bal</TableHead>
                      <TableHead>Dr/Cr</TableHead>
                      <TableHead>GSTIN</TableHead>
                    </>
                  )}
                  {importType === "products" && (
                    <>
                      <TableHead>SKU</TableHead>
                      <TableHead>HSN</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Purchase Price</TableHead>
                      <TableHead className="text-right">Selling Price</TableHead>
                      <TableHead className="text-right">Opening Stock</TableHead>
                      <TableHead>GST %</TableHead>
                    </>
                  )}
                  {importType === "parties" && (
                    <>
                      <TableHead>Type</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>State</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">Validation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.map((r, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono text-muted-foreground">{r.row}</TableCell>
                    <TableCell className="font-semibold text-foreground">{r.name || "—"}</TableCell>

                    {importType === "accounts" && (
                      <>
                        <TableCell className="font-mono text-muted-foreground">{r.code || "—"}</TableCell>
                        <TableCell>{r.parentGroup}</TableCell>
                        <TableCell className="text-right font-mono">₹{r.openingBalance}</TableCell>
                        <TableCell className="uppercase font-semibold">{r.drOrCr}</TableCell>
                        <TableCell className="font-mono">{r.gstin || "—"}</TableCell>
                      </>
                    )}

                    {importType === "products" && (
                      <>
                        <TableCell className="font-mono">{r.sku || "—"}</TableCell>
                        <TableCell className="font-mono">{r.hsn || "—"}</TableCell>
                        <TableCell>{r.unit}</TableCell>
                        <TableCell className="text-right font-mono">₹{r.purchasePrice}</TableCell>
                        <TableCell className="text-right font-mono">₹{r.sellingPrice}</TableCell>
                        <TableCell className="text-right font-mono">{r.openingStock}</TableCell>
                        <TableCell>{r.gstRate}%</TableCell>
                      </>
                    )}

                    {importType === "parties" && (
                      <>
                        <TableCell><Badge variant="outline">{r.partyType}</Badge></TableCell>
                        <TableCell className="font-mono">{r.mobile || "—"}</TableCell>
                        <TableCell className="font-mono">{r.gstin || "—"}</TableCell>
                        <TableCell>{r.city || "—"}</TableCell>
                        <TableCell>{r.state || "—"}</TableCell>
                      </>
                    )}

                    <TableCell className="text-right">
                      {r.isValid ? (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 text-[10px]">
                          Ready
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          Missing required field
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
