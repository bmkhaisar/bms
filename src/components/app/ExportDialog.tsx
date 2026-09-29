import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  FileSpreadsheet,
  FileText,
  FileType,
  Code,
  Download,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import type { ExportColumnDefinition, ExportFormat } from "@/modules/export/exportTypes";
import { executeExport } from "@/modules/export/exportService";

export interface ExportDialogProps<T = any> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  filename: string;
  columns: ExportColumnDefinition<T>[];
  filteredData: T[];
  allScopeData?: T[];
  defaultFormat?: ExportFormat;
  scopeSummary?: string;
  includeTotals?: boolean;
  allowJson?: boolean;
}

export function ExportDialog<T>({
  open,
  onOpenChange,
  title,
  filename,
  columns,
  filteredData,
  allScopeData,
  defaultFormat = "excel",
  scopeSummary,
  includeTotals = true,
  allowJson = false,
}: ExportDialogProps<T>) {
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [datasetChoice, setDatasetChoice] = useState<"filtered" | "all">("filtered");
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>(() =>
    columns.filter((c) => !c.hiddenByDefault).map((c) => c.key)
  );
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const effectiveData = datasetChoice === "all" && allScopeData ? allScopeData : filteredData;

  function toggleColumn(key: string) {
    setSelectedColumnKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function selectAllColumns() {
    setSelectedColumnKeys(columns.map((c) => c.key));
  }

  function deselectAllColumns() {
    setSelectedColumnKeys([]);
  }

  function handleExport() {
    if (selectedColumnKeys.length === 0) {
      toast.error("Please select at least one column to export.");
      return;
    }
    if (effectiveData.length === 0) {
      toast.warning("No records to export.");
      return;
    }

    setIsExporting(true);
    try {
      executeExport({
        filename,
        sheetName: filename.slice(0, 30),
        title,
        scopeSummary,
        columns,
        data: effectiveData,
        format,
        includeTotals,
        selectedColumnKeys,
      });

      toast.success(
        `Successfully exported ${effectiveData.length} ${effectiveData.length === 1 ? "record" : "records"} as ${format.toUpperCase()}`
      );
      onOpenChange(false);
    } catch (err: any) {
      console.error("[Export error]:", err);
      toast.error(`Export failed: ${err?.message || "Internal error"}`);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Download className="h-4 w-4 text-primary" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {scopeSummary ? scopeSummary : "Choose export format and dataset options."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {/* 1. Format Selection */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground">File Format</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFormat("excel")}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                  format === "excel"
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-border/80 bg-card hover:bg-secondary/40 text-foreground"
                }`}
              >
                <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs">Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                  format === "csv"
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-border/80 bg-card hover:bg-secondary/40 text-foreground"
                }`}
              >
                <FileType className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                <span className="text-xs">CSV (.csv)</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("pdf")}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                  format === "pdf"
                    ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                    : "border-border/80 bg-card hover:bg-secondary/40 text-foreground"
                }`}
              >
                <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                <span className="text-xs">PDF (.pdf)</span>
              </button>

              {allowJson && (
                <button
                  type="button"
                  onClick={() => setFormat("json")}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                    format === "json"
                      ? "border-primary bg-primary/10 text-primary font-semibold shadow-2xs"
                      : "border-border/80 bg-card hover:bg-secondary/40 text-foreground"
                  }`}
                >
                  <Code className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs">JSON (.json)</span>
                </button>
              )}
            </div>
          </div>

          {/* 2. Dataset Scope Selection */}
          {allScopeData && allScopeData.length !== filteredData.length && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Records to Include</Label>
              <RadioGroup
                value={datasetChoice}
                onValueChange={(val: "filtered" | "all") => setDatasetChoice(val)}
                className="space-y-1.5"
              >
                <div className="flex items-center space-x-2 rounded-lg border border-border/70 p-2 hover:bg-secondary/20">
                  <RadioGroupItem value="filtered" id="dataset-filtered" />
                  <Label htmlFor="dataset-filtered" className="cursor-pointer text-xs flex-1">
                    <span className="font-medium text-foreground">Currently Filtered Results</span>
                    <span className="ml-1 text-muted-foreground">({filteredData.length} records)</span>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-lg border border-border/70 p-2 hover:bg-secondary/20">
                  <RadioGroupItem value="all" id="dataset-all" />
                  <Label htmlFor="dataset-all" className="cursor-pointer text-xs flex-1">
                    <span className="font-medium text-foreground">All Matching Records in Current Scope</span>
                    <span className="ml-1 text-muted-foreground">({allScopeData.length} records)</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* 3. Column Selection Toggle */}
          <div className="space-y-2 border-t border-border/60 pt-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowColumnConfig(!showColumnConfig)}
                className="flex items-center gap-1.5 font-semibold text-foreground hover:text-primary transition-colors text-xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Customize Columns</span>
                <span className="text-muted-foreground text-[10px]">
                  ({selectedColumnKeys.length}/{columns.length})
                </span>
              </button>

              {showColumnConfig && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllColumns}
                    className="text-[10px] text-primary hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground text-[10px]">•</span>
                  <button
                    type="button"
                    onClick={deselectAllColumns}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>

            {showColumnConfig && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/70 bg-card p-2.5 space-y-1.5 scrollbar-thin">
                <div className="grid grid-cols-2 gap-2">
                  {columns.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 cursor-pointer rounded px-1.5 py-1 hover:bg-secondary/40 text-xs"
                    >
                      <Checkbox
                        checked={selectedColumnKeys.includes(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                      />
                      <span className="truncate text-foreground/90">{col.header}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting || selectedColumnKeys.length === 0}
            className="gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export ({effectiveData.length})</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
