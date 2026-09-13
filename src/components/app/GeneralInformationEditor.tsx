import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ArrowUp, ArrowDown, List, AlignLeft, Type } from "lucide-react";
import type { SectionRow, ValueType, GeneralInfoTemplate } from "@/lib/db";
import { uid } from "@/lib/db";

interface GeneralInformationEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  rows: SectionRow[];
  onChange: (rows: SectionRow[]) => void;
  templates?: GeneralInfoTemplate[];
  onApplyTemplate?: (templateId: string) => void;
  selectedTemplateId?: string;
}

export function GeneralInformationEditor({
  enabled,
  onEnabledChange,
  rows,
  onChange,
  templates = [],
  onApplyTemplate,
  selectedTemplateId,
}: GeneralInformationEditorProps) {
  function addRow() {
    const newRow: SectionRow = {
      id: uid(),
      label: "",
      valueType: "TEXT",
      value: "",
      order: rows.length + 1,
    };
    onChange([...rows, newRow]);
  }

  function updateRow(index: number, patch: Partial<SectionRow>) {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function deleteRow(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next);
  }

  function moveRow(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    const next = [...rows];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    onChange(next);
  }

  return (
    <Card className="p-4 space-y-4 border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900">General Information</span>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-medium">
              Quotation Only
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Client site specifications, configuration details, and delivery requirements. Excluded from invoices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="include-gen-info" className="text-xs font-medium text-slate-700">
            Include in Quotation
          </Label>
          <Switch
            id="include-gen-info"
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-3">
          {/* Template Selector & Add Button */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {templates.length > 0 && onApplyTemplate && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-600">Template:</span>
                  <Select
                    value={selectedTemplateId || ""}
                    onValueChange={onApplyTemplate}
                  >
                    <SelectTrigger className="w-52 h-8 text-xs">
                      <SelectValue placeholder="Load Specification Template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              className="h-8 text-xs gap-1.5 border-primary text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" /> Add Row
            </Button>
          </div>

          {/* Rows List */}
          {rows.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-lg bg-slate-50 text-xs text-slate-500">
              No general information rows added. Click <strong>+ Add Row</strong> or select a template above.
            </div>
          ) : (
            <div className="space-y-2.5">
              {rows.map((row, idx) => (
                <div
                  key={row.id || idx}
                  className="p-3 border rounded-lg bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        placeholder="Label (e.g. Configuration of Cabins)"
                        value={row.label}
                        onChange={(e) => updateRow(idx, { label: e.target.value })}
                        className="h-8 text-xs font-semibold max-w-sm"
                      />
                      <Select
                        value={row.valueType || "TEXT"}
                        onValueChange={(val) =>
                          updateRow(idx, { valueType: val as ValueType })
                        }
                      >
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TEXT" className="text-xs flex items-center gap-1.5">
                            <span className="flex items-center gap-1">
                              <Type className="h-3 w-3" /> Plain Text
                            </span>
                          </SelectItem>
                          <SelectItem value="MULTILINE" className="text-xs">
                            <span className="flex items-center gap-1">
                              <AlignLeft className="h-3 w-3" /> Multiline
                            </span>
                          </SelectItem>
                          <SelectItem value="BULLET_LIST" className="text-xs">
                            <span className="flex items-center gap-1">
                              <List className="h-3 w-3" /> Bullet List
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={idx === 0}
                        onClick={() => moveRow(idx, "up")}
                      >
                        <ArrowUp className="h-3.5 w-3.5 text-slate-500" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={idx === rows.length - 1}
                        onClick={() => moveRow(idx, "down")}
                      >
                        <ArrowDown className="h-3.5 w-3.5 text-slate-500" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteRow(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Value Input depending on type */}
                  {row.valueType === "BULLET_LIST" ? (
                    <Textarea
                      rows={3}
                      placeholder={"Enter bullet points (one item per line)\n• Cabin 40'L x 10'W x 8.5'H\n• Cabin 20'L x 10'W x 8.5'H"}
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      className="text-xs leading-relaxed"
                    />
                  ) : row.valueType === "MULTILINE" ? (
                    <Textarea
                      rows={2}
                      placeholder="Enter detailed description or conditions…"
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      className="text-xs"
                    />
                  ) : (
                    <Input
                      placeholder="Value (e.g. INCLUDED, No Advance Sample)"
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      className="h-8 text-xs"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
