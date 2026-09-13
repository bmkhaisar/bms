import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, Layers } from "lucide-react";
import type { QuotationSection, SectionRow, TechSpecTemplate } from "@/lib/db";
import { uid } from "@/lib/db";

interface TechnicalSpecificationsEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  sections: QuotationSection[];
  onChange: (sections: QuotationSection[]) => void;
  templates?: TechSpecTemplate[];
  onApplyTemplate?: (templateId: string) => void;
}

export function TechnicalSpecificationsEditor({
  enabled,
  onEnabledChange,
  sections,
  onChange,
  templates = [],
  onApplyTemplate,
}: TechnicalSpecificationsEditorProps) {
  function addSection() {
    const newSection: QuotationSection = {
      id: uid(),
      type: "SPEC_TABLE",
      title: "New Specification Section",
      order: sections.length + 1,
      rows: [
        {
          id: uid(),
          label: "",
          value: "",
          order: 1,
        },
      ],
    };
    onChange([...sections, newSection]);
  }

  function updateSection(secIndex: number, patch: Partial<QuotationSection>) {
    const next = [...sections];
    next[secIndex] = { ...next[secIndex], ...patch };
    onChange(next);
  }

  function deleteSection(secIndex: number) {
    onChange(sections.filter((_, i) => i !== secIndex));
  }

  function duplicateSection(secIndex: number) {
    const orig = sections[secIndex];
    const copy: QuotationSection = {
      ...orig,
      id: uid(),
      title: `${orig.title} (Copy)`,
      order: sections.length + 1,
      rows: (orig.rows || []).map((r) => ({ ...r, id: uid() })),
    };
    const next = [...sections];
    next.splice(secIndex + 1, 0, copy);
    onChange(next);
  }

  function moveSection(secIndex: number, direction: "up" | "down") {
    const target = direction === "up" ? secIndex - 1 : secIndex + 1;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    const temp = next[secIndex];
    next[secIndex] = next[target];
    next[target] = temp;
    onChange(next);
  }

  // Row operations inside a section
  function addRow(secIndex: number) {
    const sec = sections[secIndex];
    const newRow: SectionRow = {
      id: uid(),
      label: "",
      value: "",
      order: (sec.rows || []).length + 1,
    };
    updateSection(secIndex, { rows: [...(sec.rows || []), newRow] });
  }

  function updateRow(secIndex: number, rowIndex: number, patch: Partial<SectionRow>) {
    const sec = sections[secIndex];
    const nextRows = [...(sec.rows || [])];
    nextRows[rowIndex] = { ...nextRows[rowIndex], ...patch };
    updateSection(secIndex, { rows: nextRows });
  }

  function deleteRow(secIndex: number, rowIndex: number) {
    const sec = sections[secIndex];
    const nextRows = (sec.rows || []).filter((_, i) => i !== rowIndex);
    updateSection(secIndex, { rows: nextRows });
  }

  return (
    <Card className="p-4 space-y-4 border-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-slate-900">Technical / Fabrication Specifications</span>
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 font-medium">
              Quotation Only
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Detailed engineering, materials, and fabrication specs organized into titled tables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="include-tech-specs" className="text-xs font-medium text-slate-700">
            Include in Quotation
          </Label>
          <Switch
            id="include-tech-specs"
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {templates.length > 0 && onApplyTemplate && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-600">Template:</span>
                <Select onValueChange={onApplyTemplate}>
                  <SelectTrigger className="w-56 h-8 text-xs">
                    <SelectValue placeholder="Load Technical Template" />
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

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSection}
              className="h-8 text-xs gap-1.5 border-primary text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" /> Add Specification Table
            </Button>
          </div>

          {sections.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-lg bg-slate-50 text-xs text-slate-500">
              No technical specification sections added. Click <strong>+ Add Specification Table</strong> or select a template above.
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((sec, secIdx) => (
                <div
                  key={sec.id || secIdx}
                  className="p-3.5 border rounded-lg bg-white shadow-xs space-y-3"
                >
                  {/* Section Title Bar */}
                  <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded border border-slate-200">
                    <div className="flex items-center gap-2 flex-1">
                      <Layers className="h-4 w-4 text-primary shrink-0" />
                      <Input
                        placeholder="Section Title (e.g. Fabrication Specifications)"
                        value={sec.title}
                        onChange={(e) => updateSection(secIdx, { title: e.target.value })}
                        className="h-8 text-xs font-bold flex-1"
                      />
                      <Input
                        placeholder="Subtitle (optional, e.g. Frame Material)"
                        value={sec.subtitle || ""}
                        onChange={(e) => updateSection(secIdx, { subtitle: e.target.value })}
                        className="h-8 text-xs w-48"
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={secIdx === 0}
                        onClick={() => moveSection(secIdx, "up")}
                      >
                        <ArrowUp className="h-3.5 w-3.5 text-slate-500" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={secIdx === sections.length - 1}
                        onClick={() => moveSection(secIdx, "down")}
                      >
                        <ArrowDown className="h-3.5 w-3.5 text-slate-500" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => duplicateSection(secIdx)}
                        title="Duplicate Section"
                      >
                        <Copy className="h-3.5 w-3.5 text-slate-500" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteSection(secIdx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Rows inside Section */}
                  <div className="space-y-2 pl-2">
                    {(sec.rows || []).map((row, rIdx) => (
                      <div key={row.id || rIdx} className="flex items-start gap-2 text-xs">
                        <Input
                          placeholder="Label (e.g. Roof Frame)"
                          value={row.label}
                          onChange={(e) => updateRow(secIdx, rIdx, { label: e.target.value })}
                          className="h-8 text-xs font-semibold w-1/3"
                        />
                        <Textarea
                          rows={1}
                          placeholder="Specification detail (e.g. Made of MS having thickness 2.5mm...)"
                          value={row.value}
                          onChange={(e) => updateRow(secIdx, rIdx, { value: e.target.value })}
                          className="text-xs flex-1 min-h-[32px] py-1.5"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-red-500 hover:text-red-700 shrink-0"
                          onClick={() => deleteRow(secIdx, rIdx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addRow(secIdx)}
                      className="h-7 text-xs gap-1 text-primary hover:bg-primary/10 mt-1"
                    >
                      <Plus className="h-3 w-3" /> Add Specification Row
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
