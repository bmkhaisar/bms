import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Calculator } from "lucide-react";
import type { MeasurementEntry, PricingBasis } from "@/lib/db";
import { round2 } from "@/lib/calc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pricingBasis: PricingBasis;
  unit: string;
  initialMeasurements?: MeasurementEntry[];
  onApply: (params: {
    quantity: number;
    measurements: MeasurementEntry[];
    measurementSummary: string;
  }) => void;
}

export function MeasurementDialog({
  open,
  onOpenChange,
  pricingBasis,
  unit,
  initialMeasurements,
  onApply,
}: Props) {
  const [rows, setRows] = useState<MeasurementEntry[]>(() => {
    if (initialMeasurements && initialMeasurements.length > 0) {
      return [...initialMeasurements];
    }
    return [{ width: 10, height: 8, pieces: 1, unit }];
  });

  useEffect(() => {
    if (open) {
      if (initialMeasurements && initialMeasurements.length > 0) {
        setRows([...initialMeasurements]);
      } else {
        setRows([{ width: 10, height: 8, pieces: 1, unit }]);
      }
    }
  }, [open, initialMeasurements, unit]);

  function addRow() {
    setRows((prev) => [...prev, { width: 0, height: 0, pieces: 1, unit }]);
  }

  function removeRow(idx: number) {
    if (rows.length === 1) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<MeasurementEntry>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  // Calculate totals deterministically
  const totalArea = rows.reduce((sum, r) => {
    if (pricingBasis === "per_area") {
      return sum + (Number(r.width) || 0) * (Number(r.height) || 0) * (Number(r.pieces) || 1);
    } else if (pricingBasis === "per_length") {
      return sum + (Number(r.width) || Number(r.height) || 0) * (Number(r.pieces) || 1);
    } else {
      return sum + (Number(r.width) || 0) * (Number(r.pieces) || 1);
    }
  }, 0);

  const roundedQty = round2(totalArea);

  let summaryText = "";
  if (pricingBasis === "per_area") {
    if (rows.length === 1) {
      summaryText = `${rows[0].width} ft × ${rows[0].height} ft × ${rows[0].pieces} Nos = ${roundedQty} ${unit || "Sq Ft"}`;
    } else {
      summaryText = `${rows.length} measurement sections = ${roundedQty} ${unit || "Sq Ft"}`;
    }
  } else if (pricingBasis === "per_length") {
    summaryText = `Length = ${roundedQty} ${unit || "Ft"}`;
  } else {
    summaryText = `Total = ${roundedQty} ${unit}`;
  }

  function handleSave() {
    onApply({
      quantity: roundedQty,
      measurements: rows,
      measurementSummary: summaryText,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Calculator className="h-5 w-5" />
            <DialogTitle className="text-base font-bold">
              {pricingBasis === "per_area" ? "Area Measurement Calculator" : "Measurement Calculator"}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 text-xs">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-2 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{pricingBasis === "per_length" ? "Length (Ft)" : "Width (Ft)"}</TableHead>
                  {pricingBasis === "per_area" && <TableHead className="w-24">Height (Ft)</TableHead>}
                  <TableHead className="w-20">Pieces</TableHead>
                  <TableHead className="text-right">Section Total</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const sectionQty =
                    pricingBasis === "per_area"
                      ? (Number(row.width) || 0) * (Number(row.height) || 0) * (Number(row.pieces) || 1)
                      : (Number(row.width) || Number(row.height) || 0) * (Number(row.pieces) || 1);
                  return (
                    <TableRow key={idx}>
                      <TableCell className="p-1.5">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-xs font-mono"
                          value={row.width || ""}
                          onChange={(e) => updateRow(idx, { width: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      {pricingBasis === "per_area" && (
                        <TableCell className="p-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 text-xs font-mono"
                            value={row.height || ""}
                            onChange={(e) => updateRow(idx, { height: Number(e.target.value) || 0 })}
                          />
                        </TableCell>
                      )}
                      <TableCell className="p-1.5">
                        <Input
                          type="number"
                          step="1"
                          min="1"
                          className="h-8 text-xs font-mono"
                          value={row.pieces || 1}
                          onChange={(e) => updateRow(idx, { pieces: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </TableCell>
                      <TableCell className="p-1.5 text-right font-mono font-semibold">
                        {round2(sectionQty)} {unit || (pricingBasis === "per_area" ? "Sq Ft" : "Ft")}
                      </TableCell>
                      <TableCell className="p-1.5 text-center">
                        {rows.length > 1 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeRow(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={addRow} className="gap-1 text-xs h-8">
              <Plus className="h-3.5 w-3.5" /> Add Section
            </Button>
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Calculated Quantity</div>
              <div className="font-mono text-base font-bold text-primary">
                {roundedQty} {unit || (pricingBasis === "per_area" ? "Sq Ft" : "Ft")}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Apply to Line Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
