import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ArrowUp, ArrowDown, List, AlignLeft, Type, RefreshCw, Pencil } from "lucide-react";
import type { SectionRow, ValueType, GeneralInfoTemplate } from "@/lib/db";
import { uid } from "@/lib/db";
import { isCabinConfigurationRow } from "@/lib/cabinConfiguration";
import { InlineMarkdown } from "@/lib/MarkdownRenderer";

interface GeneralInformationEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  rows: SectionRow[];
  onChange: (rows: SectionRow[]) => void;
  templates?: GeneralInfoTemplate[];
  onApplyTemplate?: (templateId: string) => void;
  selectedTemplateId?: string;
  derivedCabinConfig?: string;
  isCabinConfigCustom?: boolean;
  onResetCabinConfig?: () => void;
  onCabinConfigCustomChange?: (custom: boolean) => void;
}

export function GeneralInformationEditor({
  enabled,
  onEnabledChange,
  rows,
  onChange,
  templates = [],
  onApplyTemplate,
  selectedTemplateId,
  derivedCabinConfig,
  isCabinConfigCustom,
  onResetCabinConfig,
  onCabinConfigCustomChange,
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
    <Card className="p-4 space-y-4 border-border/80 bg-card shadow-soft">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">General Information</span>
            <span className="text-xs bg-sky-500/10 text-sky-700 dark:text-sky-300 px-2.5 py-0.5 rounded-full border border-sky-500/20 font-medium">
              Quotation Only
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Client site specifications, configuration details, and delivery requirements. Excluded from invoices.
          </p>
        </div>
        <div className="flex items-center gap-2.5 bg-muted/40 px-3 py-1.5 rounded-lg border border-border/70 shrink-0">
          <div className="text-right">
            <Label htmlFor="include-gen-info" className="text-xs font-semibold text-foreground cursor-pointer block">
              {enabled ? "Included in Quotation" : "Excluded from Quotation"}
            </Label>
            <p className="text-[10px] text-muted-foreground">
              {enabled ? "Visible in document & PDF" : "Hidden from document & PDF"}
            </p>
          </div>
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
                  <span className="text-xs text-muted-foreground">Template:</span>
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
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add Row
            </Button>
          </div>

          {/* Rows List */}
          {rows.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-border/80 rounded-xl bg-secondary/20 text-xs text-muted-foreground">
              No general information rows added. Click <strong>+ Add Row</strong> or select a template above.
            </div>
          ) : (
            <div className="space-y-2.5">
              {rows.map((row, idx) => (
                <div
                  key={row.id || idx}
                  className="p-3 border border-border/70 rounded-xl bg-secondary/25 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        placeholder="Label (e.g. Configuration of Cabins)"
                        value={row.label}
                        onChange={(e) => updateRow(idx, { label: e.target.value })}
                        className="h-8 text-xs font-semibold max-w-sm bg-card"
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
                        <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={idx === rows.length - 1}
                        onClick={() => moveRow(idx, "down")}
                      >
                        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive/80"
                        onClick={() => deleteRow(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Cabin Configuration Auto vs Custom Controls */}
                  {isCabinConfigurationRow(row.label) && (
                    <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-background/60 border border-border/50">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            isCabinConfigCustom
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                              : "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
                          }`}
                        >
                          {isCabinConfigCustom ? "Custom document configuration" : "Auto-generated from item sizes"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {isCabinConfigCustom ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary/80"
                            onClick={onResetCabinConfig}
                          >
                            <RefreshCw className="h-3 w-3" /> Reset from Item Sizes
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => onCabinConfigCustomChange?.(true)}
                          >
                            <Pencil className="h-3 w-3" /> Edit Configuration
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Value Input depending on type */}
                  {row.valueType === "BULLET_LIST" ? (
                    <Textarea
                      rows={3}
                      placeholder={"Enter bullet points (one item per line)\n• Cabin 40'L x 10'W x 8.5'H\n• Cabin 20'L x 10'W x 8.5'H"}
                      value={isCabinConfigurationRow(row.label) && !isCabinConfigCustom && derivedCabinConfig ? derivedCabinConfig : row.value}
                      onChange={(e) => {
                        if (isCabinConfigurationRow(row.label)) {
                          onCabinConfigCustomChange?.(true);
                        }
                        updateRow(idx, { value: e.target.value });
                      }}
                      className="text-xs leading-relaxed bg-card font-mono"
                    />
                  ) : row.valueType === "MULTILINE" ? (
                    <Textarea
                      rows={2}
                      placeholder="Enter detailed description or conditions…"
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      className="text-xs bg-card"
                    />
                  ) : (
                    <Input
                      placeholder="Value (e.g. INCLUDED, No Advance Sample)"
                      value={row.value}
                      onChange={(e) => updateRow(idx, { value: e.target.value })}
                      className="h-8 text-xs bg-card"
                    />
                  )}

                  {row.value && (row.value.includes("**") || row.value.includes("*")) && (
                    <div className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-background/60 rounded border border-border/40">
                      <span className="text-[10px] uppercase font-semibold text-primary/70 mr-1.5">Formatted:</span>
                      <InlineMarkdown text={row.value} />
                    </div>
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
